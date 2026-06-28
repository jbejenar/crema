/**
 * crema — shared streaming data-pipeline core.
 *
 * Public API surface. Consumers (flat-white, long-black) import the generic
 * pipeline primitives from here and inject only their domain layer
 * (schema + composeDocument + verify checks + source config).
 */

export { compress } from "./compress.js";
export type { CompressOptions, CompressResult } from "./compress.js";

export { ProgressLogger } from "./progress.js";
export type { ProgressEvent, ProgressEntry, ProgressLoggerOptions } from "./progress.js";
