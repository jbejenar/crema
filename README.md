# crema

> The espresso layer common to both drinks.

**crema** is the shared streaming data-pipeline core for
[`flat-white`](../flat-white) (Australian addresses) and
[`long-black`](../long-black) (Australian businesses). It holds the
domain-agnostic primitives both projects need _identically_ — extracted once so
hardened code (connection-lifecycle fixes, streaming guarantees) lives in one
place instead of drifting across forks.

Consumers inject only their domain layer: the flatten SQL, a `compose`
row→document mapper, a Zod `schema`, verify checks, and source config.

## Public API

| Export                                                                           | What                                                                         |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `streamFlatten`                                                                  | cursor-streaming Postgres → NDJSON (compose + schema injected; RSS < 500 MB) |
| `split`                                                                          | per-key NDJSON splitter (`keyFn` + null/`other` bucket)                      |
| `compress`                                                                       | streaming gzip                                                               |
| `verify`                                                                         | NDJSON verify harness (domain checks injected)                               |
| `generateMetadata` / `writeMetadata`                                             | build metadata (per-key counts, `sources[]`, attribution)                    |
| `buildManifestV2` / `validateManifestV2`                                         | release manifest (product-agnostic)                                          |
| `ckanResources` / `selectResources` / `byFormat` / `downloadFile` / `extractZip` | data.gov.au CKAN discovery + atomic download/extract                         |
| `ProgressLogger`                                                                 | structured JSON progress logging                                             |

## Usage

```ts
import { streamFlatten, split, compress, verify } from "crema";

const { count } = await streamFlatten({
  connectionString,
  query, // your flatten SQL (with __SCHEMA_VERSION__)
  schemaVersion, // resolved by your domain (crema knows no version format)
  compose, // (row) => YourDocument
  schema, // anything with Zod-style safeParse
  outputPath,
});
```

Depend on it via npm: `"crema": "file:../crema"` (or a published/git release).
It ships compiled ESM + types (`prepare` builds on install).

## Develop

```bash
npm install && npm run build && npm test && npm run lint
```

## Licence

Apache-2.0.
