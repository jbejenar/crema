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

export { countByKey, generateMetadata, writeMetadata } from "./metadata.js";
export type { BuildMetadata, MetadataOptions, SourceInfo } from "./metadata.js";

export { split } from "./split.js";
export type { SplitOptions, SplitResult } from "./split.js";

export { streamFlatten, applySchemaVersion, FLATTEN_POSTGRES_CONFIG } from "./flatten-engine.js";
export type { StreamFlattenOptions, SafeParser } from "./flatten-engine.js";

export { verify } from "./verify-harness.js";
export type { VerifyOptions, VerifyReport, VerifyIssue, DocCheck } from "./verify-harness.js";

export { ckanResources, selectResources, byFormat, downloadFile, extractZip } from "./download.js";
export type { CkanResource } from "./download.js";

export { compareSchemas, compareSnapshots, snapshotSchemas } from "./schema-compat.js";
export type {
  SchemaChange,
  CompareResult,
  SchemaSnapshot,
  JsonSchemaObject,
} from "./schema-compat.js";

export { convertToParquet, ParquetSchema } from "./parquet.js";
export type { ParquetConvertOptions, ParquetRowMapper } from "./parquet.js";

export { buildManifestV2, validateManifestV2 } from "./manifest.js";
export type {
  ManifestV2,
  ManifestFile,
  ManifestPipeline,
  ManifestSource,
  ManifestIndex,
  ManifestIndexSettings,
  BuildManifestOptions,
} from "./manifest.js";

export { compareMetadata, formatComparisonReport } from "./compare-releases.js";
export type { ComparisonResult, KeyDelta, ReportLabels } from "./compare-releases.js";

export { fetchReleases, processReleases, generateHTML, noGrouping } from "./generate-catalogue.js";
export type {
  GitHubRelease,
  ReleaseData,
  KeyCount,
  CatalogueBranding,
} from "./generate-catalogue.js";
