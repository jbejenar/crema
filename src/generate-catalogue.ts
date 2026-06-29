/**
 * crema — GitHub-release catalogue generator.
 *
 * Fetches a repo's releases from the GitHub API and renders a self-contained
 * static HTML page: release history, per-key counts, schema link, and download
 * links. All product-specific text (name, tagline, record noun, key label, data
 * source, theme accent) is injected via `CatalogueBranding`, and the
 * patch-grouping is injected via `parseVersion` (default: no grouping) — so both
 * flat-white and long-black render from the same engine.
 *
 * Drafts and prereleases are always excluded — the public catalogue must never
 * expose a release the pipeline intentionally withheld for review.
 */

// --- Types ---

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GitHubRelease {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
  body: string;
  assets: ReleaseAsset[];
  draft: boolean;
  prerelease: boolean;
}

export interface KeyCount {
  key: string;
  count: number;
}

export interface ReleaseData {
  version: string;
  date: string;
  url: string;
  totalCount: number;
  keys: KeyCount[];
  schemaVersion: string;
  assets: { name: string; url: string; sizeMB: string }[];
  /** Patch releases grouped under this parent (when `parseVersion` groups). */
  patches?: ReleaseData[];
}

export interface CatalogueBranding {
  /** Product name — the `<h1>` and (with the tagline) the page title. */
  name: string;
  /** One-line tagline under the heading. */
  tagline: string;
  /** Record noun, e.g. "addresses" / "businesses". */
  noun: string;
  /** Per-key column label, e.g. "State". */
  keyLabel: string;
  /**
   * Global regex extracting per-key count rows from a release body; capture
   * group 1 = key, group 2 = count (commas allowed). e.g. for AU states:
   * `/\|\s*(VIC|NSW|…)\s*\|\s*([0-9,]+)\s*\|/g`.
   */
  keyPattern: RegExp;
  /** Path to the schema doc within the repo, e.g. "docs/DOCUMENT-SCHEMA.md". */
  schemaDocPath: string;
  /** Per-line schema blurb, e.g. "Each NDJSON line is one address document." */
  schemaLineDescription: string;
  /** Footer HTML describing the data source + licence (already escaped/trusted). */
  dataSourceHtml: string;
  /** Optional "Output formats: …" blurb under the schema section. */
  outputFormatsHtml?: string;
  /** Theme accent colours; defaults to amber. */
  accent?: { light: string; dark: string };
  /** Which assets to list; default `.ndjson.gz` / `.parquet` / `metadata.json`. */
  assetFilter?: (name: string) => boolean;
  /** Group patches under a parent; default: every release is top-level. */
  parseVersion?: (tag: string) => { base: string; patch: number | null };
}

// --- GitHub API ---

export async function fetchReleases(
  repo: string,
  opts: { token?: string; userAgent?: string; fetchImpl?: typeof fetch } = {},
): Promise<GitHubRelease[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const token = opts.token ?? process.env.GITHUB_TOKEN ?? "";
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": opts.userAgent ?? "crema-catalogue",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=20`, {
    headers,
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as GitHubRelease[];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseMetadataFromBody(
  body: string,
  branding: CatalogueBranding,
): { totalCount: number; keys: KeyCount[]; schemaVersion: string } {
  // Total count: "**12,345** <noun>".
  const totalRe = new RegExp(`\\*\\*([0-9,]+)\\*\\*\\s+${escapeRegex(branding.noun)}`);
  const totalMatch = body.match(totalRe);
  const totalCount = totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : 0;

  // Per-key rows via the injected pattern (reset lastIndex — it is a shared global regex).
  const keys: KeyCount[] = [];
  branding.keyPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = branding.keyPattern.exec(body)) !== null) {
    keys.push({ key: match[1], count: Number(match[2].replace(/,/g, "")) });
  }

  const schemaMatch = body.match(/Schema:\s*v?([0-9.]+)/i);
  return { totalCount, keys, schemaVersion: schemaMatch ? schemaMatch[1] : "unknown" };
}

/** Default: no patch grouping — every release is a top-level entry. */
export function noGrouping(tag: string): { base: string; patch: number | null } {
  return { base: tag, patch: null };
}

function defaultAssetFilter(name: string): boolean {
  return name.endsWith(".ndjson.gz") || name.endsWith(".parquet") || name === "metadata.json";
}

export function processReleases(
  releases: GitHubRelease[],
  branding: CatalogueBranding,
): ReleaseData[] {
  const parseVersion = branding.parseVersion ?? noGrouping;
  const assetFilter = branding.assetFilter ?? defaultAssetFilter;

  const all: ReleaseData[] = releases
    .filter((r) => !r.draft && !r.prerelease)
    .filter((r) => r.tag_name.startsWith("v"))
    .map((r) => {
      const meta = parseMetadataFromBody(r.body ?? "", branding);
      return {
        version: r.tag_name,
        date: r.published_at.split("T")[0],
        url: r.html_url,
        totalCount: meta.totalCount,
        keys: meta.keys,
        schemaVersion: meta.schemaVersion,
        assets: r.assets
          .filter((a) => assetFilter(a.name))
          .map((a) => ({
            name: a.name,
            url: a.browser_download_url,
            sizeMB: (a.size / 1_048_576).toFixed(1),
          })),
      };
    });

  // Group patch releases under their parent.
  const parentMap = new Map<string, ReleaseData>();
  const patches: ReleaseData[] = [];
  for (const r of all) {
    const { patch } = parseVersion(r.version);
    if (patch !== null) patches.push(r);
    else parentMap.set(parseVersion(r.version).base, r);
  }
  for (const patch of patches) {
    const parent = parentMap.get(parseVersion(patch.version).base);
    if (parent) (parent.patches ??= []).push(patch);
  }
  const grouped = new Set(
    patches.filter((p) => parentMap.has(parseVersion(p.version).base)).map((p) => p.version),
  );
  return all.filter((r) => !grouped.has(r.version));
}

// --- HTML ---

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatNumber(n: number): string {
  return n.toLocaleString("en-AU");
}

export function generateHTML(
  repo: string,
  releases: ReleaseData[],
  branding: CatalogueBranding,
  now: string,
): string {
  const [owner, repoName] = repo.split("/");
  const repoUrl = `https://github.com/${repo}`;
  const accent = branding.accent ?? { light: "#b45309", dark: "#f59e0b" };
  const noun = esc(branding.noun);
  const keyLabel = esc(branding.keyLabel);

  const renderRelease = (r: ReleaseData, isPatch = false): string => {
    const tag = isPatch ? "h3" : "h2";
    const cls = isPatch ? "release patch" : "release";
    return `
      <section class="${cls}">
        <${tag}><a href="${esc(r.url)}">${esc(r.version)}</a></${tag}>
        <p class="meta">Released ${esc(r.date)} &middot; ${esc(formatNumber(r.totalCount))} ${noun} &middot; Schema ${esc(r.schemaVersion)}</p>
        ${
          r.keys.length > 0
            ? `<table class="keys">
          <thead><tr><th>${keyLabel}</th><th>${noun.charAt(0).toUpperCase() + noun.slice(1)}</th></tr></thead>
          <tbody>${r.keys.map((k) => `<tr><td>${esc(k.key)}</td><td>${esc(formatNumber(k.count))}</td></tr>`).join("")}</tbody>
        </table>`
            : ""
        }
        ${
          r.assets.length > 0
            ? `<details>
          <summary>Downloads (${r.assets.length} files)</summary>
          <ul class="downloads">${r.assets.map((a) => `<li><a href="${esc(a.url)}">${esc(a.name)}</a> <span class="size">(${esc(a.sizeMB)} MB)</span></li>`).join("")}</ul>
        </details>`
            : ""
        }
      </section>`;
  };

  const releasesHTML = releases
    .map((r) => {
      let html = renderRelease(r);
      if (r.patches && r.patches.length > 0) {
        html += r.patches.map((p) => renderRelease(p, true)).join("\n");
      }
      return html;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(branding.name)} — ${esc(branding.tagline)}</title>
  <style>
    :root {
      --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --border: #d6d3d1;
      --accent: ${accent.light}; --card-bg: #ffffff;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1c1917; --fg: #fafaf9; --muted: #a8a29e; --border: #44403c;
        --accent: ${accent.dark}; --card-bg: #292524;
      }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg); color: var(--fg); line-height: 1.6;
      max-width: 800px; margin: 0 auto; padding: 2rem 1rem;
    }
    header { margin-bottom: 2rem; border-bottom: 1px solid var(--border); padding-bottom: 1rem; }
    header h1 { font-size: 1.75rem; font-weight: 700; }
    header p { color: var(--muted); margin-top: 0.25rem; }
    nav { margin-top: 0.75rem; display: flex; gap: 1rem; flex-wrap: wrap; }
    nav a { color: var(--accent); text-decoration: none; font-size: 0.9rem; }
    nav a:hover { text-decoration: underline; }
    .release { background: var(--card-bg); border: 1px solid var(--border); border-radius: 0.5rem; padding: 1.25rem; margin-bottom: 1rem; }
    .release h2 { font-size: 1.25rem; }
    .release.patch { margin-left: 1.5rem; border-left: 3px solid var(--accent); border-top: none; border-right: none; border-bottom: none; border-radius: 0; padding: 0.75rem 1rem; background: transparent; }
    .release.patch h3 { font-size: 1rem; }
    .release h2 a, .release h3 a { color: var(--accent); text-decoration: none; }
    .release h2 a:hover { text-decoration: underline; }
    .meta { color: var(--muted); font-size: 0.875rem; margin-top: 0.25rem; }
    .keys { width: 100%; border-collapse: collapse; margin: 0.75rem 0; font-size: 0.875rem; }
    .keys th, .keys td { text-align: left; padding: 0.375rem 0.75rem; border-bottom: 1px solid var(--border); }
    .keys th { font-weight: 600; color: var(--muted); }
    .keys td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
    details { margin-top: 0.75rem; }
    summary { cursor: pointer; color: var(--accent); font-size: 0.875rem; }
    .downloads { list-style: none; margin-top: 0.5rem; }
    .downloads li { padding: 0.25rem 0; font-size: 0.875rem; }
    .downloads a { color: var(--accent); text-decoration: none; }
    .downloads a:hover { text-decoration: underline; }
    .size { color: var(--muted); font-size: 0.8rem; }
    .schema { margin-top: 2rem; border-top: 1px solid var(--border); padding-top: 1rem; }
    .schema h2 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    .schema-link { color: var(--accent); text-decoration: none; }
    .schema-link:hover { text-decoration: underline; }
    footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.8rem; }
    .empty { text-align: center; padding: 3rem 1rem; color: var(--muted); }
  </style>
</head>
<body>
  <header>
    <h1>${esc(branding.name)}</h1>
    <p>${esc(branding.tagline)}</p>
    <nav>
      <a href="${esc(repoUrl)}">GitHub</a>
      <a href="${esc(repoUrl)}/blob/main/${esc(branding.schemaDocPath)}">Schema Reference</a>
      <a href="${esc(repoUrl)}/blob/main/CHANGELOG.md">Changelog</a>
      <a href="${esc(repoUrl)}/releases">All Releases</a>
    </nav>
  </header>

  <main>
    <h2 style="margin-bottom: 1rem;">Releases</h2>
    ${releases.length > 0 ? releasesHTML : '<p class="empty">No releases yet.</p>'}
  </main>

  <section class="schema">
    <h2>Document Schema</h2>
    <p>${esc(branding.schemaLineDescription)} See the full <a class="schema-link" href="${esc(repoUrl)}/blob/main/${esc(branding.schemaDocPath)}">schema reference</a>.</p>
    ${
      branding.outputFormatsHtml
        ? `<p style="margin-top: 0.5rem; font-size: 0.875rem; color: var(--muted);">${branding.outputFormatsHtml}</p>`
        : ""
    }
  </section>

  <footer>
    <p>Generated ${esc(now)} from <a href="${esc(repoUrl)}" style="color: var(--accent);">${esc(owner)}/${esc(repoName)}</a>. ${branding.dataSourceHtml}</p>
  </footer>
</body>
</html>`;
}
