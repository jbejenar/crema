/**
 * crema — Per-key NDJSON splitter.
 *
 * Streams an NDJSON file and splits it into one file per key (default: the
 * document's `state` field). Each output file contains only docs for that key.
 *
 * Generalization over flat-white's splitter: the key is extracted by an
 * injected `keyFn`, and null/empty/whitespace keys route to an `other` bucket.
 * flat-white's original `state.toLowerCase()` threw on a null key — this fixes
 * it, and keying writers by the *normalized* key also closes a latent
 * same-filename collision (e.g. "VIC" and "vic" → one file).
 */

import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

export interface SplitOptions {
  /** Path to the input NDJSON file. */
  inputPath: string;
  /** Output directory for per-key files. */
  outputDir: string;
  /** Version string embedded in each output filename. */
  version: string;
  /** Output filename prefix (e.g. "long-black"). */
  prefix: string;
  /** Extract the split key from a document. Default: `doc.state`. */
  keyFn?: (doc: Record<string, unknown>) => unknown;
  /** Bucket name for null/empty/whitespace keys. Default: "other". */
  otherBucket?: string;
}

export interface SplitResult {
  /** Per-key document counts (keys normalized: lowercased, `other` for empty). */
  counts: Record<string, number>;
  /** Total documents processed. */
  totalCount: number;
  /** Paths to output files. */
  outputFiles: string[];
}

const defaultKeyFn = (doc: Record<string, unknown>): unknown => doc.state;

/** Normalize a raw key to a filename-safe bucket; null/empty → otherBucket. */
function normalizeKey(raw: unknown, otherBucket: string): string {
  if (raw === null || raw === undefined) return otherBucket;
  const s = String(raw).trim();
  return s === "" ? otherBucket : s.toLowerCase();
}

function buildFilename(prefix: string, version: string, key: string): string {
  return `${prefix}-${version}-${key}.ndjson`;
}

async function waitForDrain(writer: WriteStream): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onDrain = () => {
      cleanup();
      resolvePromise();
    };
    const onError = (error: Error) => {
      cleanup();
      rejectPromise(error);
    };
    const cleanup = () => {
      writer.off("drain", onDrain);
      writer.off("error", onError);
    };

    writer.on("drain", onDrain);
    writer.on("error", onError);
  });
}

/**
 * Split an NDJSON file into per-key files.
 *
 * Streams the input line by line, lazily opening write streams for each key
 * encountered (backpressure-safe via drain handling).
 */
export async function split(options: SplitOptions): Promise<SplitResult> {
  const {
    inputPath,
    outputDir,
    version,
    prefix,
    keyFn = defaultKeyFn,
    otherBucket = "other",
  } = options;

  const writers = new Map<string, WriteStream>();
  const counts: Record<string, number> = {};
  let totalCount = 0;
  let writeError: Error | null = null;

  const rl = createInterface({
    input: createReadStream(inputPath),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;
      totalCount++;

      let doc: Record<string, unknown>;
      try {
        doc = JSON.parse(line) as Record<string, unknown>;
      } catch (e) {
        throw new Error(`Malformed JSON at line ${totalCount}: ${line.slice(0, 100)}`, {
          cause: e,
        });
      }
      const key = normalizeKey(keyFn(doc), otherBucket);
      counts[key] = (counts[key] ?? 0) + 1;

      if (!writers.has(key)) {
        const outputPath = resolve(outputDir, buildFilename(prefix, version, key));
        const ws = createWriteStream(outputPath);
        ws.on("error", (err) => {
          writeError ??= err;
          rl.close();
        });
        writers.set(key, ws);
      }

      // Writer is guaranteed to exist — we just set it above if missing
      const writer = writers.get(key) as WriteStream;
      const ok = writer.write(line + "\n");
      if (!ok) {
        await waitForDrain(writer);
      }
    }
  } finally {
    // Always close every open writer — even if a malformed line, a failing
    // keyFn, or a write error throws mid-stream — so we never leak file
    // descriptors. Resolve on "close" (fires after both a clean end() and an
    // error-triggered destroy), short-circuiting the already-closed case.
    await Promise.all(
      Array.from(
        writers.values(),
        (writer) =>
          new Promise<void>((resolvePromise) => {
            if (writer.destroyed) {
              resolvePromise();
              return;
            }
            writer.once("close", () => resolvePromise());
            writer.end();
          }),
      ),
    );
  }

  if (writeError) {
    throw writeError;
  }

  const outputFiles = Array.from(writers.keys())
    .sort()
    .map((key) => resolve(outputDir, buildFilename(prefix, version, key)));

  return {
    counts,
    totalCount,
    outputFiles,
  };
}
