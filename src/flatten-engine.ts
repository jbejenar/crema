/**
 * crema — Streaming Postgres → NDJSON flatten engine.
 *
 * The generic cursor machine extracted from flat-white's flatten.ts:293-403.
 * Domain projects inject: the flatten SQL (`query`), a `compose` row→document
 * mapper, a `schema` validator (anything with Zod-style `safeParse`), and an
 * already-resolved `schemaVersion` string. crema only substitutes the
 * `__SCHEMA_VERSION__` placeholder — it does NOT know any version *format*
 * (that stays in each domain layer).
 *
 * Memory-safe: cursor-based streaming keeps RSS under 500MB regardless of
 * dataset size. A single reserved connection guarantees temp tables created by
 * `prepSql` survive into the cursor query (the E1.24 fix).
 */

import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import postgres from "postgres";
import { ProgressLogger } from "./progress.js";

/**
 * Postgres client config used by streamFlatten().
 *
 * Exported so a unit test can assert the E1.24 `max_lifetime: null` fix doesn't
 * regress. postgres@3 defaults to a randomized 30-60min max_lifetime, which can
 * recycle a connection mid-flatten and silently invalidate temp tables created
 * by prepSql.
 *   - max: 1 — flatten is single-threaded; pool size of 1 minimizes overhead.
 *   - max_lifetime: null — disables connection recycling (E1.24).
 *   - transform.undefined: null — leave SQL column names snake_case for compose().
 */
export const FLATTEN_POSTGRES_CONFIG = {
  max: 1,
  max_lifetime: null,
  transform: {
    undefined: null,
  },
} as const;

/** Minimal Zod-compatible validator: anything with a `safeParse`. */
export interface SafeParser<TDoc> {
  safeParse(
    doc: unknown,
  ): { success: true; data: TDoc } | { success: false; error: { message: string } };
}

export interface StreamFlattenOptions<TDoc> {
  /** Postgres connection URL. */
  connectionString: string;
  /** Flatten SQL (may contain `__SCHEMA_VERSION__` placeholders). */
  query: string;
  /** Map a flat SQL row to a domain document. */
  compose: (row: Record<string, unknown>) => TDoc;
  /** Validator with Zod-style `safeParse` (rejected rows are skipped + counted). */
  schema: SafeParser<TDoc>;
  /** Output NDJSON file path. */
  outputPath: string;
  /** Resolved schema version; replaces `__SCHEMA_VERSION__` in query + prepSql. */
  schemaVersion?: string;
  /** Optional DDL to pre-materialize aggregations before the cursor stream. */
  prepSql?: string;
  /** Cursor batch size (default 500). */
  cursorSize?: number;
  /** Optional structured progress logger. */
  logger?: ProgressLogger;
}

/** Replace `__SCHEMA_VERSION__` placeholders when a schemaVersion is supplied. */
export function applySchemaVersion(sql: string, schemaVersion: string | undefined): string {
  return schemaVersion === undefined ? sql : sql.replaceAll("__SCHEMA_VERSION__", schemaVersion);
}

/**
 * Run the flatten pipeline: read from Postgres via a server-side cursor, compose
 * + validate each document, and write line-delimited JSON to `outputPath`.
 * Returns the count of written documents and of rows that failed validation.
 */
export async function streamFlatten<TDoc>(
  options: StreamFlattenOptions<TDoc>,
): Promise<{ count: number; errors: number }> {
  const {
    connectionString,
    query,
    compose,
    schema,
    outputPath,
    schemaVersion,
    prepSql,
    cursorSize = 500,
    logger,
  } = options;

  const sql = postgres(connectionString, FLATTEN_POSTGRES_CONFIG);

  let count = 0;
  let errors = 0;

  logger?.stageStart("flatten");

  try {
    // E1.24: reserve a single connection for the entire flatten run so temp
    // tables created by prepSql persist into the cursor query (same session).
    const reserved = await sql.reserve();
    try {
      if (prepSql) {
        // DDL: creates temp tables in the reserved connection's session.
        // (reserved.unsafe, not sql.unsafe — no cursor needed for DDL.)
        await reserved.unsafe(applySchemaVersion(prepSql, schemaVersion));
      }

      const flattenSql = applySchemaVersion(query, schemaVersion);
      const cursor = reserved.unsafe(flattenSql).cursor(cursorSize);

      const source = Readable.from(
        (async function* () {
          for await (const batch of cursor) {
            for (const row of batch) {
              yield row;
            }
          }
        })(),
      );

      const transform = new Transform({
        objectMode: true,
        transform(row: Record<string, unknown>, _encoding, callback) {
          try {
            const doc = compose(row);
            const result = schema.safeParse(doc);
            if (result.success) {
              count++;
              logger?.progress("flatten", { rows: count });
              callback(null, JSON.stringify(result.data) + "\n");
            } else {
              errors++;
              const id = (row._id as string) ?? "unknown";
              console.error(`[flatten] Validation failed for ${id}: ${result.error.message}`);
              callback();
            }
          } catch (err) {
            errors++;
            const id = (row._id as string) ?? "unknown";
            console.error(`[flatten] Error composing ${id}:`, err);
            callback();
          }
        },
      });

      const output = createWriteStream(outputPath);

      await pipeline(source, transform, output);

      logger?.stageEnd("flatten", { rows: count });
    } finally {
      // Always return the reserved connection, even on mid-stream failure.
      reserved.release();
    }
  } finally {
    await sql.end();
  }

  return { count, errors };
}
