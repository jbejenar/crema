/**
 * Unit tests for generate-catalogue.ts — generic GitHub-release catalogue.
 */

import { describe, it, expect } from "vitest";
import {
  processReleases,
  generateHTML,
  fetchReleases,
  noGrouping,
  type GitHubRelease,
  type CatalogueBranding,
} from "../../src/generate-catalogue.js";

const branding: CatalogueBranding = {
  name: "long-black",
  tagline: "Australian businesses. Joined and served.",
  noun: "businesses",
  keyLabel: "State",
  keyPattern: /\|\s*(VIC|NSW|QLD|SA|WA|TAS|NT|ACT|OT)\s*\|\s*([0-9,]+)\s*\|/g,
  schemaDocPath: "docs/DOCUMENT-SCHEMA.md",
  schemaLineDescription: "Each NDJSON line is one ABN document.",
  dataSourceHtml: 'Data from the <a href="https://abr.business.gov.au">ABR</a> under CC-BY 3.0 AU.',
};

function release(over: Partial<GitHubRelease>): GitHubRelease {
  return {
    tag_name: "v2026.06.28",
    name: "v2026.06.28",
    published_at: "2026-06-28T10:00:00Z",
    html_url: "https://github.com/x/y/releases/tag/v2026.06.28",
    body: "**1,234** businesses\nSchema: v0.6.0\n| NSW | 1,000 |\n| VIC | 234 |",
    assets: [
      { name: "long-black-2026.06.28-nsw.ndjson.gz", browser_download_url: "u1", size: 1_048_576 },
      { name: "long-black-2026.06.28.parquet", browser_download_url: "u2", size: 2_097_152 },
      { name: "notes.txt", browser_download_url: "u3", size: 10 },
    ],
    draft: false,
    prerelease: false,
    ...over,
  };
}

describe("processReleases", () => {
  it("parses the body (count, keys, schema) and filters non-data assets", () => {
    const [r] = processReleases([release({})], branding);
    expect(r.totalCount).toBe(1234);
    expect(r.schemaVersion).toBe("0.6.0");
    expect(r.keys).toEqual([
      { key: "NSW", count: 1000 },
      { key: "VIC", count: 234 },
    ]);
    // .ndjson.gz + .parquet kept; notes.txt dropped.
    expect(r.assets.map((a) => a.name)).toEqual([
      "long-black-2026.06.28-nsw.ndjson.gz",
      "long-black-2026.06.28.parquet",
    ]);
    expect(r.assets[1].sizeMB).toBe("2.0");
  });

  it("excludes drafts and prereleases", () => {
    const out = processReleases(
      [release({ draft: true }), release({ tag_name: "v2026.05.01", prerelease: true })],
      branding,
    );
    expect(out).toHaveLength(0);
  });

  it("does not group by default (noGrouping → all top-level)", () => {
    const out = processReleases(
      [release({ tag_name: "v2026.06.28" }), release({ tag_name: "v2026.05.31" })],
      branding,
    );
    expect(out.map((r) => r.version)).toEqual(["v2026.06.28", "v2026.05.31"]);
    expect(out.every((r) => r.patches === undefined)).toBe(true);
  });

  it("groups patches under a parent when parseVersion groups", () => {
    const parseVersion = (tag: string): { base: string; patch: number | null } => {
      const m = tag.match(/^(v\d{4}\.\d{2})(?:\.(\d+))?$/);
      return m ? { base: m[1], patch: m[2] ? Number(m[2]) : null } : { base: tag, patch: null };
    };
    const out = processReleases(
      [release({ tag_name: "v2026.04" }), release({ tag_name: "v2026.04.1" })],
      { ...branding, parseVersion },
    );
    expect(out).toHaveLength(1);
    expect(out[0].version).toBe("v2026.04");
    expect(out[0].patches?.map((p) => p.version)).toEqual(["v2026.04.1"]);
  });
});

describe("noGrouping", () => {
  it("returns the tag as base with no patch", () => {
    expect(noGrouping("v2026.06.28")).toEqual({ base: "v2026.06.28", patch: null });
  });
});

describe("generateHTML", () => {
  it("renders the injected branding and escapes release content", () => {
    const releases = processReleases([release({})], branding);
    const html = generateHTML("jbejenar/long-black", releases, branding, "2026-06-29");
    expect(html).toContain("<h1>long-black</h1>");
    expect(html).toContain("Australian businesses. Joined and served.");
    expect(html).toContain("1,234 businesses");
    expect(html).toContain("docs/DOCUMENT-SCHEMA.md");
    expect(html).toContain("Generated 2026-06-29");
    expect(html).toContain("CC-BY 3.0 AU");
  });

  it("shows an empty state with no releases", () => {
    const html = generateHTML("x/y", [], branding, "2026-06-29");
    expect(html).toContain("No releases yet.");
  });
});

describe("fetchReleases", () => {
  it("calls the GitHub API with the configured user agent and returns the JSON", async () => {
    let seenUrl = "";
    let seenUA = "";
    const fetchImpl = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seenUrl = url;
      seenUA = init?.headers?.["User-Agent"] ?? "";
      return { ok: true, json: async () => [release({})] } as unknown as Response;
    }) as unknown as typeof fetch;
    const out = await fetchReleases("a/b", { userAgent: "long-black-catalogue", fetchImpl });
    expect(seenUrl).toContain("/repos/a/b/releases");
    expect(seenUA).toBe("long-black-catalogue");
    expect(out).toHaveLength(1);
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 404, statusText: "Not Found" }) as Response) as unknown as typeof fetch;
    await expect(fetchReleases("a/b", { fetchImpl })).rejects.toThrow(/GitHub API error: 404/);
  });
});
