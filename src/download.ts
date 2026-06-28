/**
 * crema — data.gov.au CKAN discovery + download + atomic zip extract.
 *
 * The generic core extracted from flat-white's download.ts. Domain projects pass
 * a stable package id + a resource predicate (which resources to fetch); the
 * G-NAF/ABN-specific source config stays in each consumer's `sources.ts`.
 *
 * data.gov.au's WAF rejects some clients, so requests carry a browser-ish
 * User-Agent. Extraction is atomic (temp dir → rename) so a partial unzip is
 * never mistaken for a complete one.
 */

import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";

const execFileAsync = promisify(execFile);

const CKAN_PACKAGE_SHOW = "https://data.gov.au/data/api/3/action/package_show";
const USER_AGENT = "Mozilla/5.0 (crema data pipeline)";

export interface CkanResource {
  name?: string;
  format?: string;
  url?: string;
  /** Size in bytes, if CKAN reports it. */
  size?: number;
}

interface CkanPackageResponse {
  result?: { resources?: CkanResource[] };
}

type FetchImpl = typeof globalThis.fetch;

/** Fetch a CKAN package's resource list by (stable) package id. */
export async function ckanResources(
  packageId: string,
  opts: { baseUrl?: string; fetchImpl?: FetchImpl } = {},
): Promise<CkanResource[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl ?? CKAN_PACKAGE_SHOW;
  const url = `${base}?id=${encodeURIComponent(packageId)}`;
  const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`CKAN package_show "${packageId}" → HTTP ${res.status}`);
  }
  const json = (await res.json()) as CkanPackageResponse;
  return json.result?.resources ?? [];
}

/** Filter resources by a predicate (e.g. `r => r.format === "ZIP"`). */
export function selectResources(
  resources: CkanResource[],
  predicate: (resource: CkanResource) => boolean,
): CkanResource[] {
  return resources.filter(predicate);
}

/** Case-insensitive format match — a common predicate helper. */
export function byFormat(...formats: string[]): (r: CkanResource) => boolean {
  const wanted = new Set(formats.map((f) => f.toUpperCase()));
  return (r) => r.format != null && wanted.has(r.format.toUpperCase());
}

/** Stream-download a URL to destPath atomically (`.part` → rename), with retries. */
export async function downloadFile(
  url: string,
  destPath: string,
  opts: { retries?: number; fetchImpl?: FetchImpl } = {},
): Promise<void> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const retries = opts.retries ?? 3;
  mkdirSync(dirname(destPath), { recursive: true });

  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
      if (!res.ok || res.body == null) {
        throw new Error(`download "${url}" → HTTP ${res.status}`);
      }
      const tmp = `${destPath}.part`;
      const webStream = res.body as unknown as NodeWebReadableStream<Uint8Array>;
      await pipeline(Readable.fromWeb(webStream), createWriteStream(tmp));
      renameSync(tmp, destPath);
      return;
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise<void>((r) => setTimeout(r, attempt * 1000));
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`download "${url}" failed after ${retries} attempts`);
}

/** Extract a zip atomically: unzip into a temp dir, then rename into place. */
export async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const tmp = `${destDir}.extracting`;
  if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  await execFileAsync("unzip", ["-o", "-q", zipPath, "-d", tmp]);
  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  renameSync(tmp, destDir);
}
