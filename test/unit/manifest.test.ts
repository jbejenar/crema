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
    expect(() =>
      buildManifestV2({ ...base, index: { mappingsKey: "k" }, sourceKeys: ["nope"] }),
    ).toThrow(/missing from files/);
  });

  it("counts all files for a no-index manifest when sourceKeys is omitted", () => {
    const { sourceKeys: _omit, ...noKeys } = base;
    const m = buildManifestV2(noKeys);
    expect(m.total_records).toBe(150);
    expect(m.index).toBeUndefined();
    // Builder and validator agree end to end (the Bug-1 contract).
    expect(validateManifestV2(JSON.parse(JSON.stringify(m)), "abn").total_records).toBe(150);
  });

  it("rejects a no-index manifest whose sourceKeys are not exactly all files", () => {
    expect(() => buildManifestV2({ ...base, sourceKeys: [base.files[0].key] })).toThrow(
      /must list exactly all file keys/,
    );
  });

  it("requires sourceKeys when an index block is present", () => {
    const { sourceKeys: _omit, ...noKeys } = base;
    expect(() => buildManifestV2({ ...noKeys, index: { mappingsKey: "k" } })).toThrow(
      /sourceKeys is required when an index block is present/,
    );
  });

  it("rejects duplicate file keys (no-index) so totals can't be inflated", () => {
    const dupe = { ...base.files[0], records: 999 };
    const { sourceKeys: _omit, ...noKeys } = base;
    expect(() => buildManifestV2({ ...noKeys, files: [...base.files, dupe] })).toThrow(
      /duplicate file key/,
    );
  });

  it("rejects duplicate source_keys in an indexed manifest", () => {
    expect(() =>
      buildManifestV2({
        ...base,
        index: { mappingsKey: "k" },
        sourceKeys: [base.files[0].key, base.files[0].key],
      }),
    ).toThrow(/duplicate source key/);
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

  it("rejects a manifest with duplicate file keys", () => {
    const m = buildManifestV2(base);
    const tampered = { ...m, files: [...m.files, m.files[0]], total_records: 250 };
    expect(() => validateManifestV2(tampered, "abn")).toThrow(/duplicate file key/);
  });

  it("rejects a manifest with duplicate index.source_keys", () => {
    const m = buildManifestV2({ ...base, index: { mappingsKey: "k" } });
    const tampered = {
      ...m,
      index: { ...m.index, source_keys: [base.files[0].key, base.files[0].key] },
    };
    expect(() => validateManifestV2(tampered, "abn")).toThrow(/duplicate source key/);
  });
});
