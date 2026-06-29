/**
 * Unit tests for verify-harness.ts — generic NDJSON verify harness.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, unlinkSync, existsSync, readdirSync, rmdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { verify, type DocCheck } from "../../src/verify-harness.js";
import type { SafeParser } from "../../src/flatten-engine.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = resolve(__dirname, "../../.tmp-test-verify");

interface Doc {
  _id: string;
  value?: number;
}

// A tiny Zod-style validator: `value` must be a number.
const schema: SafeParser<Doc> = {
  safeParse(d) {
    const doc = d as Doc;
    if (typeof doc.value === "number") return { success: true, data: doc };
    return { success: false, error: { message: "value must be a number" } };
  },
};

// A domain check: ids must start with "A".
const idPrefixCheck: DocCheck<Doc> = {
  name: "id-prefix",
  run: (doc) => (String(doc._id).startsWith("A") ? null : `id must start with A: ${doc._id}`),
};

function tmpFile(name: string): string {
  return resolve(TMP_DIR, name);
}

function write(name: string, lines: string[]): string {
  const path = tmpFile(name);
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

beforeAll(() => mkdirSync(TMP_DIR, { recursive: true }));
afterAll(() => {
  if (existsSync(TMP_DIR)) {
    for (const f of readdirSync(TMP_DIR)) unlinkSync(resolve(TMP_DIR, f));
    rmdirSync(TMP_DIR);
  }
});

describe("verify", () => {
  it("passes a clean file", async () => {
    const path = write("clean.ndjson", [
      '{"_id":"A1","value":1}',
      '{"_id":"A2","value":2}',
      '{"_id":"A3","value":3}',
    ]);
    const report = await verify({ ndjsonPath: path, schema, checks: [idPrefixCheck] });
    expect(report.ok).toBe(true);
    expect(report.totalLines).toBe(3);
    expect(report.validCount).toBe(3);
    expect(report.issues).toHaveLength(0);
  });

  it("flags malformed JSON", async () => {
    const path = write("bad-json.ndjson", ['{"_id":"A1","value":1}', "{not json}"]);
    const report = await verify({ ndjsonPath: path });
    expect(report.ok).toBe(false);
    expect(report.jsonFailures).toBe(1);
    expect(report.issues[0].check).toBe("json");
  });

  it("flags schema failures and skips domain checks for them", async () => {
    const path = write("schema-fail.ndjson", [
      '{"_id":"A1","value":1}',
      '{"_id":"A2"}', // no value → schema fail
    ]);
    const report = await verify({ ndjsonPath: path, schema, checks: [idPrefixCheck] });
    expect(report.ok).toBe(false);
    expect(report.schemaFailures).toBe(1);
    expect(report.validCount).toBe(1);
    expect(report.checkFailures).toEqual({}); // schema-invalid doc not checked
  });

  it("flags duplicate ids", async () => {
    const path = write("dups.ndjson", ['{"_id":"A1","value":1}', '{"_id":"A1","value":2}']);
    const report = await verify({ ndjsonPath: path, schema });
    expect(report.ok).toBe(false);
    expect(report.duplicateIds).toBe(1);
  });

  it("runs injected domain checks", async () => {
    const path = write("domain.ndjson", [
      '{"_id":"A1","value":1}',
      '{"_id":"B2","value":2}', // fails id-prefix
    ]);
    const report = await verify({ ndjsonPath: path, schema, checks: [idPrefixCheck] });
    expect(report.ok).toBe(false);
    expect(report.checkFailures).toEqual({ "id-prefix": 1 });
    expect(report.issues.some((i) => i.check === "id-prefix")).toBe(true);
  });

  it("asserts an expected count", async () => {
    const path = write("count.ndjson", ['{"_id":"A1","value":1}', '{"_id":"A2","value":2}']);
    const ok = await verify({ ndjsonPath: path, schema, expectedCount: 2 });
    expect(ok.countMatches).toBe(true);
    expect(ok.ok).toBe(true);

    const bad = await verify({ ndjsonPath: path, schema, expectedCount: 3 });
    expect(bad.countMatches).toBe(false);
    expect(bad.ok).toBe(false);
  });

  it("caps stored issues but keeps exact counts", async () => {
    const lines = Array.from({ length: 10 }, (_, i) => `{"_id":"B${i}","value":1}`);
    const path = write("many-issues.ndjson", lines);
    const report = await verify({
      ndjsonPath: path,
      schema,
      checks: [idPrefixCheck],
      maxIssues: 3,
    });
    expect(report.checkFailures["id-prefix"]).toBe(10); // exact
    expect(report.issues.length).toBe(3); // capped
  });
});

// idsSorted mode replaces the unbounded id Set with O(1) adjacency checks — the
// only mode safe past V8's ~16.7M-entry Set cap on a full-scale build.
describe("verify — idsSorted (sorted-id mode)", () => {
  it("passes a clean ascending-id file with no Set", async () => {
    const path = write("sorted-clean.ndjson", [
      '{"_id":"A1","value":1}',
      '{"_id":"A2","value":2}',
      '{"_id":"A3","value":3}',
    ]);
    const report = await verify({ ndjsonPath: path, schema, idsSorted: true });
    expect(report.ok).toBe(true);
    expect(report.duplicateIds).toBe(0);
    expect(report.orderViolations).toBe(0);
  });

  it("flags an adjacent duplicate id", async () => {
    const path = write("sorted-dup.ndjson", [
      '{"_id":"A1","value":1}',
      '{"_id":"A2","value":2}',
      '{"_id":"A2","value":3}', // duplicate, adjacent (sorted)
      '{"_id":"A3","value":4}',
    ]);
    const report = await verify({ ndjsonPath: path, schema, idsSorted: true });
    expect(report.ok).toBe(false);
    expect(report.duplicateIds).toBe(1);
    expect(report.orderViolations).toBe(0);
    expect(report.issues.some((i) => i.check === "unique" && i.id === "A2")).toBe(true);
  });

  it("flags a broken sort assumption rather than silently missing duplicates", async () => {
    const path = write("sorted-broken.ndjson", [
      '{"_id":"A1","value":1}',
      '{"_id":"A3","value":2}',
      '{"_id":"A2","value":3}', // out of ascending order
    ]);
    const report = await verify({ ndjsonPath: path, schema, idsSorted: true });
    expect(report.ok).toBe(false);
    expect(report.orderViolations).toBe(1);
    expect(report.issues.some((i) => i.check === "order")).toBe(true);
  });

  it("matches Set-mode results on the same clean sorted input", async () => {
    const lines = ['{"_id":"A1","value":1}', '{"_id":"A2","value":2}', '{"_id":"A3","value":3}'];
    const sortedPath = write("parity-sorted.ndjson", lines);
    const setPath = write("parity-set.ndjson", lines);
    const sortedReport = await verify({ ndjsonPath: sortedPath, schema, idsSorted: true });
    const setReport = await verify({ ndjsonPath: setPath, schema, idsSorted: false });
    expect(sortedReport.ok).toBe(setReport.ok);
    expect(sortedReport.validCount).toBe(setReport.validCount);
    expect(sortedReport.duplicateIds).toBe(setReport.duplicateIds);
  });
});
