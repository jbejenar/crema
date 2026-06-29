/**
 * Unit tests for parquet.ts — the generic NDJSON → Parquet engine.
 *
 * Uses a tiny synthetic schema + row-mapper (the domain schema/mapper live in
 * each consumer) and round-trips through @dsnp/parquetjs's reader.
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ParquetReader } from "@dsnp/parquetjs";
import { convertToParquet, ParquetSchema } from "../../src/parquet.js";

// One unpredictable, atomically-created temp dir per test (mkdtemp — not a
// guessable path in the shared temp root); files live inside it.
const dirs: string[] = [];
function tmpDir(): string {
  const d = mkdtempSync(join(tmpdir(), "crema-parquet-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) if (existsSync(d)) rmSync(d, { recursive: true, force: true });
});

// A tiny doc: one required scalar, one optional scalar, one nested → JSON string.
const schema = new ParquetSchema({
  _id: { type: "UTF8" },
  count: { type: "INT32" },
  note: { type: "UTF8", optional: true },
  nested: { type: "UTF8" }, // JSON string
});

const mapRow = (doc: Record<string, unknown>): Record<string, unknown> => {
  const row: Record<string, unknown> = {
    _id: doc._id,
    count: doc.count,
    nested: JSON.stringify(doc.nested),
  };
  if (doc.note != null) row.note = doc.note; // omit null → parquet null
  return row;
};

async function readBack(path: string): Promise<Record<string, unknown>[]> {
  const reader = await ParquetReader.openFile(path);
  const cursor = reader.getCursor();
  const rows: Record<string, unknown>[] = [];
  let rec: unknown;
  while ((rec = await cursor.next())) rows.push(rec as Record<string, unknown>);
  await reader.close();
  return rows;
}

describe("convertToParquet", () => {
  it("converts NDJSON to Parquet and round-trips via the reader", async () => {
    const dir = tmpDir();
    const input = join(dir, "in.ndjson");
    const output = join(dir, "out.parquet");
    writeFileSync(
      input,
      [
        JSON.stringify({ _id: "A1", count: 1, note: "hi", nested: { a: [1, 2] } }),
        JSON.stringify({ _id: "A2", count: 2, note: null, nested: { a: [] } }),
        "", // blank line skipped
        JSON.stringify({ _id: "A3", count: 3, note: "yo", nested: { a: [9] } }),
      ].join("\n") + "\n",
    );

    const { count } = await convertToParquet({
      inputPath: input,
      outputPath: output,
      schema,
      mapRow,
    });
    expect(count).toBe(3); // blank line not counted
    expect(existsSync(output)).toBe(true);

    const rows = await readBack(output);
    expect(rows.map((r) => r._id)).toEqual(["A1", "A2", "A3"]);
    expect(rows[0].count).toBe(1);
    // Buffer/string-safe nested round-trip.
    expect(JSON.parse(String(rows[0].nested))).toEqual({ a: [1, 2] });
    // Omitted null optional reads back as null/undefined.
    expect(rows[1].note ?? null).toBeNull();
    expect(String(rows[2].note)).toBe("yo");
  });

  it("writes an empty (zero-row) Parquet for an empty NDJSON", async () => {
    const dir = tmpDir();
    const input = join(dir, "in.ndjson");
    const output = join(dir, "out.parquet");
    writeFileSync(input, "");
    const { count } = await convertToParquet({
      inputPath: input,
      outputPath: output,
      schema,
      mapRow,
    });
    expect(count).toBe(0);
    expect(await readBack(output)).toEqual([]);
  });

  it("propagates a malformed line and leaves no partial file at the output path", async () => {
    const dir = tmpDir();
    const input = join(dir, "in.ndjson");
    const output = join(dir, "out.parquet");
    writeFileSync(input, '{"_id":"A1","count":1,"nested":{}}\n{ not json }\n');
    await expect(
      convertToParquet({ inputPath: input, outputPath: output, schema, mapRow }),
    ).rejects.toThrow();
    // Atomic write: no finalized-but-incomplete Parquet, and no leftover .part.
    expect(existsSync(output)).toBe(false);
    expect(existsSync(`${output}.part`)).toBe(false);
  });
});
