/**
 * crema — NDJSON → Parquet converter (generic).
 *
 * Streams an NDJSON file line-by-line and writes a Parquet file via
 * `@dsnp/parquetjs`. Memory stays bounded by the writer's row-group buffering.
 *
 * This is the domain-agnostic engine: the consumer injects the `ParquetSchema`
 * and a `mapRow` that flattens each document into a Parquet row (scalars as
 * native columns; nested objects/arrays serialized to JSON strings for maximum
 * reader compatibility). flat-white and long-black each supply their own schema
 * + mapper. `ParquetSchema` is re-exported so consumers build their schema
 * against the same parquetjs the engine writes with (one dependency, here).
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { ParquetSchema, ParquetWriter } from "@dsnp/parquetjs";

export { ParquetSchema };

/** Map a parsed NDJSON document to a flat Parquet row. */
export type ParquetRowMapper = (doc: Record<string, unknown>) => Record<string, unknown>;

export interface ParquetConvertOptions {
  /** Path to the input NDJSON file. */
  inputPath: string;
  /** Path for the output `.parquet` file. */
  outputPath: string;
  /** The Parquet schema (build it with the re-exported `ParquetSchema`). */
  schema: ParquetSchema;
  /** Flatten a document into a Parquet row matching `schema`. */
  mapRow: ParquetRowMapper;
}

/**
 * Convert an NDJSON file to Parquet. Returns the row count written. The writer
 * is always closed (even on a malformed line) so the file descriptor is
 * released; the error still propagates to the caller.
 */
export async function convertToParquet(options: ParquetConvertOptions): Promise<{ count: number }> {
  const { inputPath, outputPath, schema, mapRow } = options;

  const writer = await ParquetWriter.openFile(schema, outputPath);
  let count = 0;
  const rl = createInterface({ input: createReadStream(inputPath), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      const doc = JSON.parse(line) as Record<string, unknown>;
      await writer.appendRow(mapRow(doc));
      count++;
    }
  } finally {
    await writer.close();
  }

  return { count };
}
