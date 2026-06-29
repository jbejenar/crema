/**
 * crema — NDJSON verify harness.
 *
 * Streams an NDJSON file line-by-line and produces a structured report:
 *   - JSON well-formedness
 *   - optional schema validation (any Zod-style `safeParse`)
 *   - id-field uniqueness
 *   - injected per-document domain checks (return a message on failure)
 *   - optional total-count assertion
 *
 * This is the generic *harness* extracted from flat-white's verify.ts; the
 * domain-specific checks (coordinate bounds, postcode ranges, ABN checksum,
 * enum sets, …) are injected by the consumer — the harness knows none of them.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { SafeParser } from "./flatten-engine.js";

export interface VerifyIssue {
  /** 1-based line number. */
  line: number;
  /** The document's id (from idField) if available. */
  id: string | null;
  /** The check that produced the issue (e.g. "json", "schema", or a check name). */
  check: string;
  message: string;
}

/** A per-document domain check: return a failure message, or null if it passes. */
export interface DocCheck<TDoc> {
  name: string;
  run: (doc: TDoc) => string | null;
}

export interface VerifyOptions<TDoc> {
  /** Path to the NDJSON file to verify. */
  ndjsonPath: string;
  /** Optional schema validator; failures are counted and sampled. */
  schema?: SafeParser<TDoc>;
  /** Per-document domain checks. */
  checks?: DocCheck<TDoc>[];
  /** Field used as the document id for uniqueness + issue labelling. Default "_id". */
  idField?: string;
  /**
   * Declare that ids are emitted already grouped by a total order on the id —
   * e.g. a flatten with `ORDER BY <id>`. Duplicate detection then compares each
   * id to the previous one in O(1) memory instead of holding every id in a Set,
   * which is mandatory past ~16.7M docs (V8's per-Set entry limit) and keeps RSS
   * flat on a full-scale build. Duplicates are detected by exact string equality
   * of adjacent ids — correct for ANY total-order sort, regardless of which
   * ordering the producer used. The harness also asserts the order holds (via
   * `idComparator`) so a broken sort assumption surfaces as an `order` issue
   * rather than silently missing non-adjacent duplicates. Default false
   * (Set-based, any order).
   */
  idsSorted?: boolean;
  /**
   * Ordering used for the `idsSorted` order-violation check. It MUST match the
   * order the producer emitted (the semantics of its `ORDER BY`). The default is
   * JS lexicographic string comparison — correct for fixed-width or
   * already-lexicographic ids, but NOT for numeric ids ordered numerically (where
   * `'10' < '2'` lexicographically would be a false violation). For a numeric
   * stream pass e.g. `(a, b) => Number(a) - Number(b)`. Duplicate detection is
   * unaffected (always exact string equality). Returns <0 / 0 / >0 like
   * `Array.prototype.sort`'s compare function.
   */
  idComparator?: (a: string, b: string) => number;
  /** If set, the total line count must equal this. */
  expectedCount?: number;
  /** Cap on stored issue samples (default 100). Counts are always exact. */
  maxIssues?: number;
}

export interface VerifyReport {
  ok: boolean;
  totalLines: number;
  /** Lines that parsed and passed schema validation (or all parsed lines if no schema). */
  validCount: number;
  jsonFailures: number;
  schemaFailures: number;
  duplicateIds: number;
  /**
   * Ids seen out of order per `idComparator` — only possible (and only checked)
   * when `idsSorted` is set; a non-zero value means the sorted assumption is
   * wrong (or `idComparator` doesn't match the producer's ordering) and duplicate
   * detection may have missed non-adjacent duplicates.
   */
  orderViolations: number;
  /** Per-check failure counts, keyed by check name. */
  checkFailures: Record<string, number>;
  /** Sampled issues (capped at maxIssues). */
  issues: VerifyIssue[];
  expectedCount?: number;
  countMatches?: boolean;
}

/**
 * Verify an NDJSON file. Streams line-by-line; memory stays flat in `idsSorted`
 * mode (the only mode safe past ~16.7M docs). Without `idsSorted`, the id
 * uniqueness check holds every distinct id in a Set, so memory grows with the
 * distinct-id count and V8 caps a Set at ~16.7M entries — pass `idsSorted` for
 * a sorted, full-scale stream.
 */
export async function verify<TDoc>(options: VerifyOptions<TDoc>): Promise<VerifyReport> {
  const {
    ndjsonPath,
    schema,
    checks = [],
    idField = "_id",
    idsSorted = false,
    idComparator = (a, b) => (a < b ? -1 : a > b ? 1 : 0),
    expectedCount,
    maxIssues = 100,
  } = options;

  let totalLines = 0;
  let validCount = 0;
  let jsonFailures = 0;
  let schemaFailures = 0;
  let duplicateIds = 0;
  let orderViolations = 0;
  const checkFailures: Record<string, number> = {};
  const issues: VerifyIssue[] = [];
  // Sorted mode keeps only the previous id (O(1) memory); unsorted mode holds
  // every id in a Set (bounded by the distinct-id count — see idsSorted).
  const seenIds = idsSorted ? null : new Set<string>();
  let prevId: string | null = null;

  const addIssue = (issue: VerifyIssue): void => {
    if (issues.length < maxIssues) issues.push(issue);
  };

  const rl = createInterface({
    input: createReadStream(ndjsonPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    totalLines++;

    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(line) as Record<string, unknown>;
    } catch {
      jsonFailures++;
      addIssue({ line: totalLines, id: null, check: "json", message: "malformed JSON" });
      continue;
    }

    const rawId = doc[idField];
    const id = typeof rawId === "string" ? rawId : rawId == null ? null : String(rawId);

    // id uniqueness — sorted mode compares to the previous id (O(1) memory),
    // unsorted mode tracks all ids in a Set.
    if (id != null) {
      if (seenIds) {
        if (seenIds.has(id)) {
          duplicateIds++;
          addIssue({
            line: totalLines,
            id,
            check: "unique",
            message: `duplicate ${idField}: ${id}`,
          });
        } else {
          seenIds.add(id);
        }
      } else if (prevId !== null) {
        if (id === prevId) {
          duplicateIds++;
          addIssue({
            line: totalLines,
            id,
            check: "unique",
            message: `duplicate ${idField}: ${id}`,
          });
        } else if (idComparator(id, prevId) < 0) {
          orderViolations++;
          addIssue({
            line: totalLines,
            id,
            check: "order",
            message: `${idField} out of order: ${id} after ${prevId}`,
          });
        }
      }
      prevId = id;
    }

    // schema validation
    let typed: TDoc = doc as unknown as TDoc;
    if (schema) {
      const result = schema.safeParse(doc);
      if (!result.success) {
        schemaFailures++;
        addIssue({ line: totalLines, id, check: "schema", message: result.error.message });
        continue; // don't run domain checks on a schema-invalid doc
      }
      typed = result.data;
    }
    validCount++;

    // domain checks
    for (const check of checks) {
      const message = check.run(typed);
      if (message != null) {
        checkFailures[check.name] = (checkFailures[check.name] ?? 0) + 1;
        addIssue({ line: totalLines, id, check: check.name, message });
      }
    }
  }

  const countMatches = expectedCount === undefined ? undefined : totalLines === expectedCount;
  const ok =
    jsonFailures === 0 &&
    schemaFailures === 0 &&
    duplicateIds === 0 &&
    orderViolations === 0 &&
    Object.keys(checkFailures).length === 0 &&
    (countMatches ?? true);

  const report: VerifyReport = {
    ok,
    totalLines,
    validCount,
    jsonFailures,
    schemaFailures,
    duplicateIds,
    orderViolations,
    checkFailures,
    issues,
  };
  if (expectedCount !== undefined) {
    report.expectedCount = expectedCount;
    report.countMatches = countMatches;
  }
  return report;
}
