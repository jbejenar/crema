/**
 * Unit tests for split.ts — per-key NDJSON splitter (generalized keyFn + other bucket).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  writeFileSync,
  readFileSync,
  mkdirSync,
  unlinkSync,
  existsSync,
  readdirSync,
  rmdirSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { split } from "../../src/split.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP_DIR = resolve(__dirname, "../../.tmp-test-split");
const TMP_OUT = resolve(TMP_DIR, "output");
const PREFIX = "long-black";

function tmpFile(name: string): string {
  return resolve(TMP_DIR, name);
}

function writeNdjson(path: string, docs: Array<Record<string, unknown>>): void {
  writeFileSync(path, docs.map((d) => JSON.stringify(d)).join("\n") + "\n");
}

function readLines(path: string): string[] {
  return readFileSync(path, "utf-8").trimEnd().split("\n");
}

beforeAll(() => {
  mkdirSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_OUT, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP_DIR)) {
    const cleanup = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = resolve(dir, f);
        try {
          unlinkSync(p);
        } catch {
          // directory
          cleanup(p);
          rmdirSync(p);
        }
      }
    };
    cleanup(TMP_DIR);
    rmdirSync(TMP_DIR);
  }
});

describe("split", () => {
  it("splits multi-state NDJSON into per-key files (normalized keys)", async () => {
    const docs = [
      { _id: "A1", state: "VIC" },
      { _id: "A2", state: "NSW" },
      { _id: "A3", state: "VIC" },
      { _id: "A4", state: "QLD" },
      { _id: "A5", state: "NSW" },
    ];
    const inputPath = tmpFile("multi-state.ndjson");
    const outDir = resolve(TMP_OUT, "multi");
    mkdirSync(outDir, { recursive: true });
    writeNdjson(inputPath, docs);

    const result = await split({
      inputPath,
      outputDir: outDir,
      version: "2026.06.28",
      prefix: PREFIX,
    });

    expect(result.totalCount).toBe(5);
    expect(result.counts).toEqual({ vic: 2, nsw: 2, qld: 1 });
    expect(result.outputFiles.length).toBe(3);

    const vicPath = resolve(outDir, `${PREFIX}-2026.06.28-vic.ndjson`);
    expect(existsSync(vicPath)).toBe(true);
    const vicLines = readLines(vicPath);
    expect(vicLines.length).toBe(2);
    for (const line of vicLines) {
      const doc = JSON.parse(line) as { state: string };
      expect(doc.state).toBe("VIC");
    }

    const nswPath = resolve(outDir, `${PREFIX}-2026.06.28-nsw.ndjson`);
    expect(readLines(nswPath).length).toBe(2);

    const qldPath = resolve(outDir, `${PREFIX}-2026.06.28-qld.ndjson`);
    expect(readLines(qldPath).length).toBe(1);
  });

  it("routes null/empty/whitespace keys to the `other` bucket (the bugfix)", async () => {
    const docs = [
      { _id: "A1", state: "VIC" },
      { _id: "A2", state: null },
      { _id: "A3" }, // missing state → undefined
      { _id: "A4", state: "" },
      { _id: "A5", state: "  " },
      { _id: "A6", state: "AAT" },
    ];
    const inputPath = tmpFile("null-state.ndjson");
    const outDir = resolve(TMP_OUT, "nullstate");
    mkdirSync(outDir, { recursive: true });
    writeNdjson(inputPath, docs);

    // Must not throw on null/missing/empty state.
    const result = await split({ inputPath, outputDir: outDir, version: "v1", prefix: PREFIX });

    expect(result.totalCount).toBe(6);
    expect(result.counts).toEqual({ vic: 1, other: 4, aat: 1 });
    const otherPath = resolve(outDir, `${PREFIX}-v1-other.ndjson`);
    expect(existsSync(otherPath)).toBe(true);
    expect(readLines(otherPath).length).toBe(4);
  });

  it("collapses mixed-case keys into one file", async () => {
    const docs = [
      { _id: "A1", state: "VIC" },
      { _id: "A2", state: "vic" },
    ];
    const inputPath = tmpFile("mixed-case.ndjson");
    const outDir = resolve(TMP_OUT, "mixedcase");
    mkdirSync(outDir, { recursive: true });
    writeNdjson(inputPath, docs);

    const result = await split({ inputPath, outputDir: outDir, version: "v1", prefix: PREFIX });
    expect(result.counts).toEqual({ vic: 2 });
    expect(result.outputFiles.length).toBe(1);
    expect(readLines(resolve(outDir, `${PREFIX}-v1-vic.ndjson`)).length).toBe(2);
  });

  it("supports a custom keyFn", async () => {
    const docs = [
      { _id: "A1", kind: "Company" },
      { _id: "A2", kind: "Individual" },
      { _id: "A3", kind: "Company" },
    ];
    const inputPath = tmpFile("custom-key.ndjson");
    const outDir = resolve(TMP_OUT, "customkey");
    mkdirSync(outDir, { recursive: true });
    writeNdjson(inputPath, docs);

    const result = await split({
      inputPath,
      outputDir: outDir,
      version: "v1",
      prefix: PREFIX,
      keyFn: (d) => d.kind,
    });
    expect(result.counts).toEqual({ company: 2, individual: 1 });
  });

  it("sum of per-key counts equals total", async () => {
    const docs = [
      { _id: "A1", state: "VIC" },
      { _id: "A2", state: "NSW" },
      { _id: "A3", state: "QLD" },
      { _id: "A4", state: "SA" },
      { _id: "A5", state: "WA" },
      { _id: "A6", state: "TAS" },
      { _id: "A7", state: "NT" },
      { _id: "A8", state: "ACT" },
      { _id: "A9", state: "AAT" },
    ];
    const inputPath = tmpFile("all-states.ndjson");
    const outDir = resolve(TMP_OUT, "all");
    mkdirSync(outDir, { recursive: true });
    writeNdjson(inputPath, docs);

    const result = await split({ inputPath, outputDir: outDir, version: "v1", prefix: PREFIX });

    const sum = Object.values(result.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(result.totalCount);
    expect(result.totalCount).toBe(9);
    expect(Object.keys(result.counts).length).toBe(9);
  });

  it("preserves document content exactly", async () => {
    const doc = { _id: "FULL1", state: "VIC", entityName: "ACME PTY LTD", postcode: "3000" };
    const inputPath = tmpFile("preserve.ndjson");
    const outDir = resolve(TMP_OUT, "preserve");
    mkdirSync(outDir, { recursive: true });
    writeNdjson(inputPath, [doc]);

    await split({ inputPath, outputDir: outDir, version: "v1", prefix: PREFIX });

    const vicPath = resolve(outDir, `${PREFIX}-v1-vic.ndjson`);
    const outputDoc = JSON.parse(readLines(vicPath)[0]);
    expect(outputDoc).toEqual(doc);
  });

  it("throws on a malformed line but still flushes + closes already-open writers (no fd leak)", async () => {
    const inputPath = tmpFile("malformed.ndjson");
    const outDir = resolve(TMP_OUT, "malformed");
    mkdirSync(outDir, { recursive: true });
    // Valid VIC line opens a writer, then a malformed line must abort the split.
    writeFileSync(inputPath, '{"_id":"A1","state":"VIC"}\nNOT JSON\n{"_id":"A2","state":"NSW"}\n');

    await expect(
      split({ inputPath, outputDir: outDir, version: "v1", prefix: PREFIX }),
    ).rejects.toThrow(/Malformed JSON at line 2/);

    // The finally block must have closed + flushed the VIC writer opened before
    // the throw — the file exists and holds the one valid line.
    const vicPath = resolve(outDir, `${PREFIX}-v1-vic.ndjson`);
    expect(existsSync(vicPath)).toBe(true);
    expect(readLines(vicPath)).toEqual(['{"_id":"A1","state":"VIC"}']);
  });

  it("rejects (without hanging) when a writer cannot open — error path closes cleanly", async () => {
    // outputDir's parent does not exist → createWriteStream emits ENOENT, which
    // drives the writer-error → finally-close path that the `closed`-based close
    // tracking guards. split() must reject and the close-await must settle (a
    // 5s test timeout fails the test if the finally hangs). The exact
    // "destroyed-before-close" race is not deterministically reproducible with
    // real fs streams (they emit `close` promptly), so this guards that the
    // error path completes rather than hangs.
    const inputPath = tmpFile("writer-open-error.ndjson");
    writeNdjson(inputPath, [
      { _id: "A1", state: "VIC" },
      { _id: "A2", state: "NSW" },
    ]);
    const missingDir = resolve(TMP_OUT, "does-not-exist", "nested");

    await expect(
      split({ inputPath, outputDir: missingDir, version: "v1", prefix: PREFIX }),
    ).rejects.toThrow();
  });
});
