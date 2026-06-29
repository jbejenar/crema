# AGENTS.md — crema

## Project Overview

crema is the **shared streaming data-pipeline core** consumed by `flat-white`
(addresses) and `long-black` (businesses). It contains only domain-agnostic
primitives; all domain logic (schemas, composers, verify checks, source config)
lives in the consumers. Extracted from flat-white so hardened pipeline code lives
in one place.

## Architecture

```
src/
  flatten-engine.ts   — streamFlatten: sql.reserve() + cursor(500) + Transform(safeParse) + pipeline
  download.ts         — CKAN discovery + downloadFile + extractZip (atomic)
  split.ts            — per-key NDJSON splitter (keyFn + null/other bucket)
  compress.ts         — streaming gzip
  verify-harness.ts   — NDJSON verify harness (checks injected)
  metadata.ts         — build metadata (per-key counts, sources, attribution)
  schema-compat.ts    — JSON Schema diff + Zod snapshotting
  progress.ts         — ProgressLogger
  index.ts            — public API surface
```

## Principles (MUST follow)

1. **Stay domain-agnostic.** Nothing here may know about addresses, ABNs, G-NAF,
   or any specific schema. Domain concerns are injected (compose, schema, keyFn,
   checks, source config).
2. **Streaming everywhere.** Cursor reads, line-by-line NDJSON, streaming gzip.
   RSS must stay under 500 MB regardless of dataset size.
3. **No version-format knowledge.** The flatten engine substitutes
   `__SCHEMA_VERSION__` only; consumers derive their own version format.
4. **Build on install.** `prepare` runs `npm run build` so git/file consumers get
   compiled ESM + types.

## Code Conventions

- ESM only, strict TypeScript, no `any`, `.js` import extensions.
- Every generic module has a pure-unit test (no live Postgres needed; the DB
  paths — streamFlatten, downloadFile — are exercised by the consumers).

## Do NOT

- Introduce a domain dependency (a specific schema, dataset, or field name).
- Read whole datasets into memory — stream.
- Bake a version format into the flatten engine.
