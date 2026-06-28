# Changelog

All notable changes to crema are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); SemVer.

## [Unreleased]

### Added

- **0.1.0** — initial extraction of flat-white's domain-agnostic pipeline core:
  - `streamFlatten` — cursor-streaming Postgres → NDJSON (compose + schema
    injected; the E1.24 `FLATTEN_POSTGRES_CONFIG` preserved).
  - `split` — per-key NDJSON splitter (`keyFn` + null/`other` bucket bugfix).
  - `compress` (gzip), `ProgressLogger`, `metadata` (per-key counts + sources),
    `manifest` (product-agnostic).
  - `verify` — NDJSON verify harness (domain checks injected).
  - `download` — data.gov.au CKAN discovery + atomic download/extract.
  - `schema-compat` — JSON Schema diff + Zod snapshotting.

### Notes

- Ships compiled ESM + types; `prepare` builds on install (git/file deps).
- Consumers: `flat-white` (addresses, migrating onto crema), `long-black` (ABNs).
