/**
 * crema — Schema compatibility checking.
 *
 * Compares JSON Schema snapshots to detect breaking vs non-breaking changes.
 * Used by consumers' CI to gate PRs that alter the NDJSON output contract.
 * `snapshotSchemas` turns named Zod schemas into a comparable snapshot.
 */

import { z } from "zod";

/** A single schema change detected during comparison. */
export interface SchemaChange {
  path: string;
  description: string;
}

/** Result of comparing two schema snapshots. */
export interface CompareResult {
  breaking: SchemaChange[];
  nonBreaking: SchemaChange[];
}

/** JSON Schema property definition (simplified). */
interface JsonSchemaProperty {
  type?: string;
  anyOf?: Array<{ type?: string }>;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  items?: JsonSchemaProperty;
  [key: string]: unknown;
}

/** Top-level JSON Schema object. */
export interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

/** Baseline snapshot format: named schemas keyed by identifier. */
export interface SchemaSnapshot {
  generatedAt: string;
  schemas: Record<string, JsonSchemaObject>;
}

/** Normalise a property's effective type set (sorted, e.g. ["null","string"]). */
function effectiveTypes(prop: JsonSchemaProperty): string[] {
  if (prop.anyOf) {
    return prop.anyOf.map((v) => v.type ?? "unknown").sort();
  }
  if (prop.type) {
    return [prop.type];
  }
  return ["unknown"];
}

/**
 * Compare two JSON Schema objects and classify changes.
 *   Breaking: field removed, type changed, nullable→non-nullable
 *   Non-breaking: field added, non-nullable→nullable, nested additions
 */
export function compareSchemas(
  baseline: JsonSchemaObject,
  current: JsonSchemaObject,
  path = "",
): CompareResult {
  const breaking: SchemaChange[] = [];
  const nonBreaking: SchemaChange[] = [];

  const baseProps = baseline.properties ?? {};
  const currProps = current.properties ?? {};

  const baseKeys = new Set(Object.keys(baseProps));
  const currKeys = new Set(Object.keys(currProps));

  for (const key of baseKeys) {
    if (!currKeys.has(key)) {
      breaking.push({ path: path ? `${path}.${key}` : key, description: "field removed" });
    }
  }

  for (const key of currKeys) {
    if (!baseKeys.has(key)) {
      nonBreaking.push({ path: path ? `${path}.${key}` : key, description: "field added" });
    }
  }

  for (const key of baseKeys) {
    if (!currKeys.has(key)) continue;

    const fieldPath = path ? `${path}.${key}` : key;
    const baseProp = baseProps[key];
    const currProp = currProps[key];

    const baseTypes = effectiveTypes(baseProp);
    const currTypes = effectiveTypes(currProp);

    if (JSON.stringify(baseTypes) !== JSON.stringify(currTypes)) {
      const baseHadNull = baseTypes.includes("null");
      const currHasNull = currTypes.includes("null");
      const baseNonNull = baseTypes.filter((t) => t !== "null");
      const currNonNull = currTypes.filter((t) => t !== "null");

      if (JSON.stringify(baseNonNull) === JSON.stringify(currNonNull)) {
        if (baseHadNull && !currHasNull) {
          breaking.push({
            path: fieldPath,
            description: "field changed from nullable to non-nullable",
          });
        } else if (!baseHadNull && currHasNull) {
          nonBreaking.push({
            path: fieldPath,
            description: "field changed from non-nullable to nullable",
          });
        }
      } else {
        breaking.push({
          path: fieldPath,
          description: `type changed: [${baseTypes.join(", ")}] → [${currTypes.join(", ")}]`,
        });
      }
    }

    if (baseProp.properties && currProp.properties) {
      const nested = compareSchemas(baseProp, currProp, fieldPath);
      breaking.push(...nested.breaking);
      nonBreaking.push(...nested.nonBreaking);
    }

    if (baseProp.items && currProp.items) {
      const nested = compareSchemas(
        baseProp.items as JsonSchemaObject,
        currProp.items as JsonSchemaObject,
        `${fieldPath}[]`,
      );
      breaking.push(...nested.breaking);
      nonBreaking.push(...nested.nonBreaking);
    }
  }

  return { breaking, nonBreaking };
}

/** Compare two full snapshots (multiple named schemas). */
export function compareSnapshots(baseline: SchemaSnapshot, current: SchemaSnapshot): CompareResult {
  const breaking: SchemaChange[] = [];
  const nonBreaking: SchemaChange[] = [];

  const baseKeys = new Set(Object.keys(baseline.schemas));
  const currKeys = new Set(Object.keys(current.schemas));

  for (const key of baseKeys) {
    if (!currKeys.has(key)) breaking.push({ path: key, description: "schema removed" });
  }
  for (const key of currKeys) {
    if (!baseKeys.has(key)) nonBreaking.push({ path: key, description: "schema added" });
  }
  for (const key of baseKeys) {
    if (!currKeys.has(key)) continue;
    const result = compareSchemas(baseline.schemas[key], current.schemas[key], key);
    breaking.push(...result.breaking);
    nonBreaking.push(...result.nonBreaking);
  }

  return { breaking, nonBreaking };
}

/** Build a comparable snapshot from named Zod schemas (via JSON Schema). */
export function snapshotSchemas(
  schemas: Record<string, z.ZodType>,
  generatedAt: string,
): SchemaSnapshot {
  const out: Record<string, JsonSchemaObject> = {};
  for (const [name, schema] of Object.entries(schemas)) {
    out[name] = z.toJSONSchema(schema) as JsonSchemaObject;
  }
  return { generatedAt, schemas: out };
}
