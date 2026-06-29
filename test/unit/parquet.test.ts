/**
 * Unit tests for parquet.ts — the generic NDJSON → Parquet engine.
 *
 * Uses a tiny synthetic schema + row-mapper (the domain schema/mapper live in
 * each consumer) and round-trips through @dsnp/parquetjs's reader.
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { ParquetReader } from "@dsnp/parquetjs";
import { convertToParquet, ParquetSchema } from "../../src/parquet.js";

const created: string[] = [];
function tmp(ext: string): string {
  const p = join(tmpdir(), `crema-parquet-${randomBytes(4).toString("hex")}${ext}`);
  created.push(p);
  return p;
}
afterEach(() => {
  for (const p of created.splice(0)) if (existsSync(p)) unlinkSync(p);
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
    const input = tmp(".ndjson");
    const output = tmp(".parquet");
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
    const input = tmp(".ndjson");
    const output = tmp(".parquet");
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

  it("propagates a malformed line and still releases the writer", async () => {
    const input = tmp(".ndjson");
    const output = tmp(".parquet");
    writeFileSync(input, '{"_id":"A1","count":1,"nested":{}}\n{ not json }\n');
    await expect(
      convertToParquet({ inputPath: input, outputPath: output, schema, mapRow }),
    ).rejects.toThrow();
  });
});
