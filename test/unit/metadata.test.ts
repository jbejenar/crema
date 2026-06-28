/**
 * Unit tests for metadata.ts — build metadata generation (per-keyFn).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  writeFileSync,
  mkdirSync,
  unlinkSync,
  existsSync,
  readdirSync,
  rmdirSync,
  readFileSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { countByKey, generateMetadata, writeMetadata } from "../../src/metadata.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = resolve(__dirname, "../../.tmp-test-metadata");

const stateKey = (d: Record<string, unknown>) => String(d.state);

function tmpFile(name: string): string {
  return resolve(TMP_DIR, name);
}

function writeNdjson(path: string, docs: Array<Record<string, unknown>>): void {
  writeFileSync(path, docs.map((d) => JSON.stringify(d)).join("\n") + "\n");
}

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_DIR)) {
    for (const f of readdirSync(TMP_DIR)) {
      unlinkSync(resolve(TMP_DIR, f));
    }
    rmdirSync(TMP_DIR);
  }
});

describe("countByKey", () => {
  it("counts documents per key (default state)", async () => {
    const docs = [
      { _id: "A1", state: "VIC" },
      { _id: "A2", state: "VIC" },
      { _id: "A3", state: "NSW" },
      { _id: "A4", state: "QLD" },
    ];
    const path = tmpFile("count-states.ndjson");
    writeNdjson(path, docs);

    const result = await countByKey(path);
    expect(result.totalCount).toBe(4);
    expect(result.counts).toEqual({ VIC: 2, NSW: 1, QLD: 1 });
  });

  it("counts by a custom keyFn", async () => {
    const docs = [
      { _id: "A1", kind: "company" },
      { _id: "A2", kind: "company" },
      { _id: "A3", kind: "individual" },
    ];
    const path = tmpFile("count-kind.ndjson");
    writeNdjson(path, docs);

    const result = await countByKey(path, (d) => String(d.kind));
    expect(result.totalCount).toBe(3);
    expect(result.counts).toEqual({ company: 2, individual: 1 });
  });

  it("handles empty file", async () => {
    const path = tmpFile("empty.ndjson");
    writeFileSync(path, "");

    const result = await countByKey(path);
    expect(result.totalCount).toBe(0);
    expect(result.counts).toEqual({});
  });
});

describe("generateMetadata", () => {
  it("generates a complete metadata object with sources + extra", async () => {
    const docs = [
      { _id: "A1", state: "VIC" },
      { _id: "A2", state: "NSW" },
    ];
    const path = tmpFile("gen-meta.ndjson");
    writeNdjson(path, docs);

    const meta = await generateMetadata({
      ndjsonPath: path,
      version: "2026.06.28",
      schemaVersion: "0.1.0",
      keyFn: stateKey,
      outputFiles: ["output/fixture.ndjson"],
      sources: [
        { name: "ABR ABN Bulk Extract", licence: "CC-BY 3.0 AU", extractDate: "2026-06-25" },
      ],
      extra: { parserVersion: "saxes" },
    });

    expect(meta.version).toBe("2026.06.28");
    expect(meta.schemaVersion).toBe("0.1.0");
    expect(meta.totalCount).toBe(2);
    expect(meta.counts).toEqual({ VIC: 1, NSW: 1 });
    expect(meta.outputFiles).toEqual(["output/fixture.ndjson"]);
    expect(meta.buildTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(meta.sources?.[0].licence).toBe("CC-BY 3.0 AU");
    expect(meta.extra?.parserVersion).toBe("saxes");
  });

  it("omits sources/extra when not provided", async () => {
    const path = tmpFile("gen-meta-bare.ndjson");
    writeNdjson(path, [{ _id: "A1", state: "VIC" }]);

    const meta = await generateMetadata({
      ndjsonPath: path,
      version: "2026.06.28",
      schemaVersion: "0.1.0",
    });
    expect(meta.sources).toBeUndefined();
    expect(meta.extra).toBeUndefined();
  });
});

describe("writeMetadata", () => {
  it("writes metadata to a JSON file", async () => {
    const docs = [
      { _id: "A1", state: "VIC" },
      { _id: "A2", state: "VIC" },
      { _id: "A3", state: "NSW" },
    ];
    const ndjsonPath = tmpFile("write-meta.ndjson");
    writeNdjson(ndjsonPath, docs);

    const outputPath = tmpFile("metadata.json");
    const meta = await writeMetadata({
      ndjsonPath,
      outputPath,
      version: "2026.06.28",
      schemaVersion: "0.1.0",
      keyFn: stateKey,
    });

    expect(meta.totalCount).toBe(3);

    const written = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<string, unknown>;
    expect(written.version).toBe("2026.06.28");
    expect(written.totalCount).toBe(3);
    expect(written.counts).toEqual({ VIC: 2, NSW: 1 });
  });
});

describe("synthetic fixture metadata", () => {
  const fixturePath = resolve(__dirname, "../fixtures/sample.ndjson");

  it("counts the fixture by its `key` field", async () => {
    const result = await countByKey(fixturePath, (d) => String(d.key));
    expect(result.totalCount).toBe(20);
    expect(result.counts).toEqual({ alpha: 5, beta: 5, gamma: 5, delta: 5 });
  });
});
