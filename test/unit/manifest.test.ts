import { describe, expect, it } from "vitest";
import { buildManifestV2, validateManifestV2 } from "../../src/manifest.js";

const baseFiles = [
  { key: "data/abn/2026-06-28/vic.ndjson.gz", records: 3, bytes: 30, sha256: "vic" },
  { key: "data/abn/2026-06-28/nsw.ndjson.gz", records: 2, bytes: 20, sha256: "nsw" },
  { key: "data/abn/2026-06-28/all.ndjson.gz", records: 5, bytes: 50, sha256: "all" },
] as const;

const basePipeline = { repo: "jbejenar/long-black", commit: "abc123", run_id: "123456789" };
const baseSource = {
  name: "ABR ABN Bulk Extract",
  release: "June 2026",
  url: "https://data.gov.au/data/dataset/abn-bulk-extract",
};

function build(sourceKeys: string[]) {
  return buildManifestV2({
    product: "abn",
    version: "2026-06-28",
    createdAt: "2026-06-28T12:00:00Z",
    pipeline: basePipeline,
    source: baseSource,
    files: [...baseFiles],
    sourceKeys,
  });
}

describe("buildManifestV2", () => {
  it("derives total_records from index.source_keys instead of files[]", () => {
    const manifest = build(["data/abn/2026-06-28/all.ndjson.gz"]);

    expect(manifest.manifest_version).toBe(2);
    expect(manifest.product).toBe("abn");
    expect(manifest.total_records).toBe(5);
    expect(manifest.files.map((file) => file.records)).toEqual([3, 2, 5]);
    expect(manifest.index.source_keys).toEqual(["data/abn/2026-06-28/all.ndjson.gz"]);
    expect(manifest.index.mappings_key).toBe("data/abn/2026-06-28/mappings.json");
    expect(manifest.index.settings).toEqual({ number_of_shards: 1, number_of_replicas: 0 });
  });
});

describe("validateManifestV2", () => {
  it("accepts a manifest whose source_keys match the contract", () => {
    const manifest = build(["data/abn/2026-06-28/all.ndjson.gz"]);
    expect(() =>
      validateManifestV2(manifest, {
        expectedProduct: "abn",
        expectedSourceKeys: ["data/abn/2026-06-28/all.ndjson.gz"],
      }),
    ).not.toThrow();
  });

  it("rejects a wrong product", () => {
    const manifest = build(["data/abn/2026-06-28/all.ndjson.gz"]);
    expect(() => validateManifestV2(manifest, { expectedProduct: "address" })).toThrow(
      "Manifest product must be address",
    );
  });

  it("rejects manifests whose total_records still sums all files[]", () => {
    const manifest = { ...build(["data/abn/2026-06-28/all.ndjson.gz"]), total_records: 10 };
    expect(() => validateManifestV2(manifest)).toThrow(
      "Manifest total_records mismatch: expected 5 from index.source_keys, got 10",
    );
  });

  it("rejects manifests whose source_keys are missing from files[]", () => {
    const manifest = {
      ...build(["data/abn/2026-06-28/all.ndjson.gz"]),
      index: {
        mappings_key: "data/abn/2026-06-28/mappings.json",
        settings: { number_of_shards: 1, number_of_replicas: 0 },
        source_keys: ["data/abn/2026-06-28/missing.ndjson.gz"],
      },
    };
    expect(() => validateManifestV2(manifest)).toThrow(
      "Manifest source key is missing from files[]: data/abn/2026-06-28/missing.ndjson.gz",
    );
  });

  it("rejects manifests whose source key differs from the expected contract", () => {
    const manifest = build(["data/abn/2026-06-28/vic.ndjson.gz"]);
    expect(() =>
      validateManifestV2(manifest, { expectedSourceKeys: ["data/abn/2026-06-28/all.ndjson.gz"] }),
    ).toThrow("Manifest source_keys[0] does not match the expected contract");
  });
});
