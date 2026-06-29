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

  it("retains non-v version tags by default (no hard-coded v prefix)", () => {
    const out = processReleases(
      [release({ tag_name: "2026.06.28" }), release({ tag_name: "release-2026.05" })],
      branding,
    );
    expect(out.map((r) => r.version)).toEqual(["2026.06.28", "release-2026.05"]);
  });

  it("honours an opt-in releaseFilter when a consumer wants stricter filtering", () => {
    const out = processReleases(
      [release({ tag_name: "v2026.06.28" }), release({ tag_name: "nightly-2026.06.28" })],
      { ...branding, releaseFilter: (tag) => tag.startsWith("v") },
    );
    expect(out.map((r) => r.version)).toEqual(["v2026.06.28"]);
  });

  it("does not hang on a non-global keyPattern and still parses keys", () => {
    // A caller who forgets the `g` flag must not cause an infinite exec loop.
    const nonGlobal: CatalogueBranding = {
      ...branding,
      keyPattern: /\|\s*(VIC|NSW|QLD|SA|WA|TAS|NT|ACT|OT)\s*\|\s*([0-9,]+)\s*\|/,
    };
    const [r] = processReleases([release({})], nonGlobal);
    expect(r.keys).toEqual([
      { key: "NSW", count: 1000 },
      { key: "VIC", count: 234 },
    ]);
    // The caller's regex is not mutated (lastIndex untouched).
    expect(nonGlobal.keyPattern.lastIndex).toBe(0);
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
    expect(seenUrl).toContain("per_page=100");
    expect(seenUA).toBe("long-black-catalogue");
    expect(out).toHaveLength(1);
  });

  it("follows the Link header across pages and accumulates every release", async () => {
    const page1 = { headers: { Link: '<https://api.github.com/p2>; rel="next"' }, body: ["a"] };
    const page2 = { headers: {}, body: ["b", "c"] };
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      const page = url.includes("/p2") ? page2 : page1;
      return {
        ok: true,
        headers: { get: (k: string) => (page.headers as Record<string, string>)[k] ?? null },
        json: async () => page.body.map((tag) => release({ tag_name: tag })),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const out = await fetchReleases("a/b", { fetchImpl });
    expect(seen).toHaveLength(2);
    expect(out.map((r) => r.tag_name)).toEqual(["a", "b", "c"]);
  });

  it("surfaces an error on a non-ok later page", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.includes("/p2")) {
        return { ok: false, status: 502, statusText: "Bad Gateway" } as unknown as Response;
      }
      return {
        ok: true,
        headers: {
          get: (k: string) => (k === "Link" ? '<https://api.github.com/p2>; rel="next"' : null),
        },
        json: async () => [release({})],
      } as unknown as Response;
    }) as unknown as typeof fetch;
    await expect(fetchReleases("a/b", { fetchImpl })).rejects.toThrow(/error fetching .*502/);
  });

  it("throws on a non-ok first response", async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 404, statusText: "Not Found" }) as Response) as unknown as typeof fetch;
    await expect(fetchReleases("a/b", { fetchImpl })).rejects.toThrow(/error fetching .*404/);
  });
});
