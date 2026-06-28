/**
 * Unit tests for download.ts — CKAN discovery + resource selection.
 * (downloadFile / extractZip hit the network + filesystem and are exercised by
 * the consumer's real-data smoke.)
 */

import { describe, it, expect } from "vitest";
import { ckanResources, selectResources, byFormat, type CkanResource } from "../../src/download.js";

/** A realistic abn-bulk-extract resource list. */
const ABN_RESOURCES: CkanResource[] = [
  { name: "Bulk Extract Schema", format: "XML", url: "https://x/bulkextract.xsd" },
  { name: "ABN Lookup Bulk Extract Readme", format: "PDF", url: "https://x/readme.pdf" },
  { name: "ABN Bulk Extract Part 1", format: "ZIP", url: "https://x/public_split_1_10.zip" },
  { name: "ABN Bulk Extract Part 2", format: "zip", url: "https://x/public_split_11_20.zip" },
  { name: "ABN Bulk Extract Resource List", format: "CSV", url: "https://x/resources.csv" },
];

function mockFetch(json: unknown, ok = true, status = 200): typeof fetch {
  return (async () => ({
    ok,
    status,
    json: async () => json,
  })) as unknown as typeof fetch;
}

describe("ckanResources", () => {
  it("returns the resource list from a package_show response", async () => {
    const fetchImpl = mockFetch({ result: { resources: ABN_RESOURCES } });
    const resources = await ckanResources("abn-bulk-extract", { fetchImpl });
    expect(resources).toHaveLength(5);
    expect(resources[2].url).toContain("public_split_1_10.zip");
  });

  it("returns [] when there are no resources", async () => {
    const fetchImpl = mockFetch({ result: {} });
    expect(await ckanResources("x", { fetchImpl })).toEqual([]);
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = mockFetch({}, false, 403);
    await expect(ckanResources("x", { fetchImpl })).rejects.toThrow("HTTP 403");
  });
});

describe("selectResources / byFormat", () => {
  it("selects the two ZIP parts (case-insensitive), skipping XSD/PDF/CSV", () => {
    const zips = selectResources(ABN_RESOURCES, byFormat("ZIP"));
    expect(zips.map((r) => r.url)).toEqual([
      "https://x/public_split_1_10.zip",
      "https://x/public_split_11_20.zip",
    ]);
  });

  it("supports multiple formats", () => {
    expect(selectResources(ABN_RESOURCES, byFormat("xml", "csv")).map((r) => r.format)).toEqual([
      "XML",
      "CSV",
    ]);
  });
});
