/**
 * Unit tests for manifest.ts — generic release-manifest build + validate.
 */

import { describe, it, expect } from "vitest";
import {
  buildManifestV2,
  validateManifestV2,
  type BuildManifestOptions,
} from "../../src/manifest.js";

const base: BuildManifestOptions = {
  product: "abn",
  version: "2026.06.28",
  createdAt: "2026-06-29T00:00:00Z",
  pipeline: { repo: "jbejenar/long-black", commit: "abc123", run_id: "42" },
  source: { name: "ABR", release: "2026.06.28", url: "https://data.gov.au/x" },
  files: [
    { key: "long-black-2026.06.28-nsw.ndjson.gz", records: 100, bytes: 10, sha256: "a" },
    { key: "long-black-2026.06.28-vic.ndjson.gz", records: 50, bytes: 5, sha256: "b" },
  ],
  sourceKeys: ["long-black-2026.06.28-nsw.ndjson.gz", "long-black-2026.06.28-vic.ndjson.gz"],
};

describe("buildManifestV2", () => {
  it("derives total_records from the source keys and omits index by default", () => {
    const m = buildManifestV2(base);
    expect(m.product).toBe("abn");
    expect(m.total_records).toBe(150);
    expect(m.index).toBeUndefined();
  });

  it("includes the index block when requested (OpenSearch products)", () => {
    const m = buildManifestV2({ ...base, index: { mappingsKey: "data/abn/mappings.json" } });
    expect(m.index?.mappings_key).toBe("data/abn/mappings.json");
    expect(m.index?.settings).toEqual({ number_of_shards: 1, number_of_replicas: 0 });
    expect(m.index?.source_keys).toEqual(base.sourceKeys);
  });

  it("throws when a source key is missing from files[]", () => {
    expect(() => buildManifestV2({ ...base, sourceKeys: ["nope"] })).toThrow(/missing from files/);
  });
});

describe("validateManifestV2", () => {
  it("round-trips a built manifest (no index → all files count)", () => {
    const m = buildManifestV2(base);
    const v = validateManifestV2(JSON.parse(JSON.stringify(m)), "abn");
    expect(v.total_records).toBe(150);
    expect(v.product).toBe("abn");
  });

  it("round-trips a manifest with an index block + matching source keys", () => {
    const m = buildManifestV2({ ...base, index: { mappingsKey: "k" } });
    const v = validateManifestV2(JSON.parse(JSON.stringify(m)), "abn", base.sourceKeys);
    expect(v.index?.source_keys).toEqual(base.sourceKeys);
  });

  it("rejects the wrong product", () => {
    const m = buildManifestV2(base);
    expect(() => validateManifestV2(m, "address")).toThrow(/product must be address/);
  });

  it("rejects a tampered total_records", () => {
    const m = { ...buildManifestV2(base), total_records: 999 };
    expect(() => validateManifestV2(m, "abn")).toThrow(/total_records mismatch/);
  });

  it("rejects source_keys that don't match the expected contract", () => {
    const m = buildManifestV2({ ...base, index: { mappingsKey: "k" } });
    expect(() => validateManifestV2(m, "abn", ["only-one"])).toThrow(/length does not match/);
  });

  it("rejects a non-object / wrong version", () => {
    expect(() => validateManifestV2(null, "abn")).toThrow(/must be an object/);
    expect(() => validateManifestV2({ manifest_version: 1 }, "abn")).toThrow(/version must be 2/);
  });
});
