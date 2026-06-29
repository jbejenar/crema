/**
 * crema — release manifest (v2) build + validate.
 *
 * A manifest is a small provenance document published with each release: the
 * product + version, when/where it was built (pipeline), the upstream source,
 * and the per-file record counts + sha256 checksums. An optional `index` block
 * carries OpenSearch deployment hints (mappings key + shard/replica settings +
 * the ordered source keys) for products that deploy to a search index.
 *
 * Generic: `product` is a parameter (not a hard-coded literal) and `index` is
 * optional, so both flat-white (address, OpenSearch) and long-black (abn, no
 * index) build manifests from the same code.
 */

export interface ManifestFile {
  key: string;
  records: number;
  bytes: number;
  sha256: string;
}

export interface ManifestPipeline {
  repo: string;
  commit: string;
  run_id: string;
}

export interface ManifestSource {
  name: string;
  release: string;
  url: string;
}

export interface ManifestIndexSettings {
  number_of_shards: number;
  number_of_replicas: number;
}

export interface ManifestIndex {
  mappings_key: string;
  settings: ManifestIndexSettings;
  source_keys: string[];
}

export interface ManifestV2 {
  manifest_version: 2;
  product: string;
  version: string;
  created_at: string;
  pipeline: ManifestPipeline;
  source: ManifestSource;
  files: ManifestFile[];
  total_records: number;
  /** OpenSearch deployment hints — present only for products that index. */
  index?: ManifestIndex;
}

export interface BuildManifestOptions {
  product: string;
  version: string;
  createdAt: string;
  pipeline: ManifestPipeline;
  source: ManifestSource;
  files: ManifestFile[];
  /** The ordered file keys that count toward `total_records`. */
  sourceKeys: string[];
  /** Include an OpenSearch `index` block (mappings + settings). Omit for none. */
  index?: { mappingsKey: string; settings?: ManifestIndexSettings };
}

const DEFAULT_SETTINGS: ManifestIndexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0,
};

function recordsForSourceKeys(files: ManifestFile[], sourceKeys: string[]): number {
  const filesByKey = new Map(files.map((file) => [file.key, file] as const));
  return sourceKeys.reduce((sum, key) => {
    const file = filesByKey.get(key);
    if (file == null) {
      throw new Error(`Manifest source key is missing from files[]: ${key}`);
    }
    return sum + file.records;
  }, 0);
}

export function buildManifestV2(options: BuildManifestOptions): ManifestV2 {
  const manifest: ManifestV2 = {
    manifest_version: 2,
    product: options.product,
    version: options.version,
    created_at: options.createdAt,
    pipeline: options.pipeline,
    source: options.source,
    files: options.files,
    total_records: recordsForSourceKeys(options.files, options.sourceKeys),
  };
  if (options.index != null) {
    manifest.index = {
      mappings_key: options.index.mappingsKey,
      settings: options.index.settings ?? DEFAULT_SETTINGS,
      source_keys: options.sourceKeys,
    };
  }
  return manifest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseNonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`Manifest field must be a non-negative integer: ${field}`);
  }
  return value as number;
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Manifest field must be a non-empty string: ${field}`);
  }
  return value;
}

function parseFiles(value: unknown): ManifestFile[] {
  if (!Array.isArray(value)) {
    throw new Error("Manifest field must be an array: files");
  }
  return value.map((item, index) => {
    if (!isRecord(item)) {
      throw new Error(`Manifest files[${index}] must be an object`);
    }
    return {
      key: parseString(item.key, `files[${index}].key`),
      records: parseNonNegativeInteger(item.records, `files[${index}].records`),
      bytes: parseNonNegativeInteger(item.bytes, `files[${index}].bytes`),
      sha256: parseString(item.sha256, `files[${index}].sha256`),
    };
  });
}

function parseSourceKeys(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Manifest field must be an array: ${field}`);
  }
  return value.map((item, index) => parseString(item, `${field}[${index}]`));
}

/**
 * Validate an unknown value as a ManifestV2 for `expectedProduct`. With
 * `expectedSourceKeys`, the index's `source_keys` (when present) must match
 * exactly. Re-derives `total_records` from the source keys and checks it.
 */
export function validateManifestV2(
  manifest: unknown,
  expectedProduct: string,
  expectedSourceKeys?: string[],
): ManifestV2 {
  if (!isRecord(manifest)) {
    throw new Error("Manifest must be an object");
  }
  if (manifest.manifest_version !== 2) {
    throw new Error("Manifest version must be 2");
  }
  if (manifest.product !== expectedProduct) {
    throw new Error(`Manifest product must be ${expectedProduct}`);
  }

  const files = parseFiles(manifest.files);
  const totalRecords = parseNonNegativeInteger(manifest.total_records, "total_records");

  if (!isRecord(manifest.pipeline)) {
    throw new Error("Manifest field must be an object: pipeline");
  }
  if (!isRecord(manifest.source)) {
    throw new Error("Manifest field must be an object: source");
  }

  // The source keys driving total_records: from the index block when present,
  // else every file key (no index → all files count).
  let index: ManifestIndex | undefined;
  let sourceKeys: string[];
  if (manifest.index != null) {
    if (!isRecord(manifest.index)) {
      throw new Error("Manifest field must be an object: index");
    }
    sourceKeys = parseSourceKeys(manifest.index.source_keys, "index.source_keys");
    if (!isRecord(manifest.index.settings)) {
      throw new Error("Manifest field must be an object: index.settings");
    }
    index = {
      mappings_key: parseString(manifest.index.mappings_key, "index.mappings_key"),
      settings: {
        number_of_shards: parseNonNegativeInteger(
          manifest.index.settings.number_of_shards,
          "index.settings.number_of_shards",
        ),
        number_of_replicas: parseNonNegativeInteger(
          manifest.index.settings.number_of_replicas,
          "index.settings.number_of_replicas",
        ),
      },
      source_keys: sourceKeys,
    };
  } else {
    sourceKeys = files.map((f) => f.key);
  }

  if (expectedSourceKeys != null) {
    if (sourceKeys.length !== expectedSourceKeys.length) {
      throw new Error("Manifest source_keys length does not match the expected contract");
    }
    expectedSourceKeys.forEach((expectedKey, i) => {
      if (sourceKeys[i] !== expectedKey) {
        throw new Error(`Manifest source_keys[${i}] does not match the expected contract`);
      }
    });
  }

  const derivedTotal = recordsForSourceKeys(files, sourceKeys);
  if (derivedTotal !== totalRecords) {
    throw new Error(
      `Manifest total_records mismatch: expected ${derivedTotal} from source keys, got ${totalRecords}`,
    );
  }

  const result: ManifestV2 = {
    manifest_version: 2,
    product: manifest.product,
    version: parseString(manifest.version, "version"),
    created_at: parseString(manifest.created_at, "created_at"),
    pipeline: {
      repo: parseString(manifest.pipeline.repo, "pipeline.repo"),
      commit: parseString(manifest.pipeline.commit, "pipeline.commit"),
      run_id: parseString(manifest.pipeline.run_id, "pipeline.run_id"),
    },
    source: {
      name: parseString(manifest.source.name, "source.name"),
      release: parseString(manifest.source.release, "source.release"),
      url: parseString(manifest.source.url, "source.url"),
    },
    files,
    total_records: totalRecords,
  };
  if (index != null) result.index = index;
  return result;
}
