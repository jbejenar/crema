/**
 * crema — Build metadata generator.
 *
 * Streams an NDJSON output file, counts documents per key (default: `state`),
 * and produces a machine-readable metadata object. Domain projects inject their
 * own `keyFn`, per-source provenance (`sources`), and any domain `extra` fields.
 */

import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

/** Provenance for one input source (URL, licence, attribution, extract date). */
export interface SourceInfo {
  /** Source dataset name (e.g. "ABR ABN Bulk Extract"). */
  name: string;
  url?: string;
  licence?: string;
  attribution?: string;
  /** The source's own snapshot/extract date — sources may differ per build. */
  extractDate?: string;
}

export interface BuildMetadata {
  version: string;
  schemaVersion: string;
  buildTimestamp: string;
  /** Per-key document counts (key = keyFn(doc); default `state`). */
  counts: Record<string, number>;
  totalCount: number;
  outputFiles: string[];
  /** Per-source provenance: URL, licence, attribution, extract date. */
  sources?: SourceInfo[];
  /** Domain-specific extras (e.g. a loader version). */
  extra?: Record<string, unknown>;
}

export interface MetadataOptions {
  /** Path to the NDJSON output file. */
  ndjsonPath: string;
  /** Data version (e.g. "2026.06.28"). */
  version: string;
  /** Output document schema version (from package.json). */
  schemaVersion: string;
  /** Extract the grouping key from a document. Default: `String(doc.state)`. */
  keyFn?: (doc: Record<string, unknown>) => string;
  /** Output file paths to record in metadata. */
  outputFiles?: string[];
  /** Per-source provenance to record. */
  sources?: SourceInfo[];
  /** Domain-specific extras to record. */
  extra?: Record<string, unknown>;
}

const defaultKeyFn = (doc: Record<string, unknown>): string => String(doc.state);

/**
 * Count documents per key by streaming an NDJSON file.
 * The key is derived by `keyFn` (default: the document's `state` field).
 */
export async function countByKey(
  ndjsonPath: string,
  keyFn: (doc: Record<string, unknown>) => string = defaultKeyFn,
): Promise<{ counts: Record<string, number>; totalCount: number }> {
  const counts: Record<string, number> = {};
  let totalCount = 0;

  const rl = createInterface({
    input: createReadStream(ndjsonPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    totalCount++;

    let doc: Record<string, unknown>;
    try {
      doc = JSON.parse(line) as Record<string, unknown>;
    } catch (e) {
      throw new Error(`Malformed JSON at line ${totalCount}: ${line.slice(0, 100)}`, { cause: e });
    }
    const key = keyFn(doc);
    counts[key] = (counts[key] ?? 0) + 1;
  }

  return { counts, totalCount };
}

/**
 * Generate build metadata from an NDJSON output file.
 */
export async function generateMetadata(options: MetadataOptions): Promise<BuildMetadata> {
  const { ndjsonPath, version, schemaVersion, keyFn, outputFiles = [], sources, extra } = options;

  const { counts, totalCount } = await countByKey(ndjsonPath, keyFn);

  const metadata: BuildMetadata = {
    version,
    schemaVersion,
    buildTimestamp: new Date().toISOString(),
    counts,
    totalCount,
    outputFiles,
  };
  if (sources) metadata.sources = sources;
  if (extra) metadata.extra = extra;
  return metadata;
}

/**
 * Generate metadata and write it to a JSON file.
 */
export async function writeMetadata(
  options: MetadataOptions & { outputPath: string },
): Promise<BuildMetadata> {
  const { outputPath, ...metadataOptions } = options;
  const metadata = await generateMetadata(metadataOptions);
  await writeFile(outputPath, JSON.stringify(metadata, null, 2) + "\n");
  return metadata;
}
