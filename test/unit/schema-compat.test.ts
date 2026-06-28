/**
 * Unit tests for schema-compat.ts — JSON Schema diff + Zod snapshotting.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  compareSchemas,
  compareSnapshots,
  snapshotSchemas,
  type JsonSchemaObject,
} from "../../src/schema-compat.js";

const obj = (properties: Record<string, unknown>): JsonSchemaObject => ({
  type: "object",
  properties: properties as JsonSchemaObject["properties"],
});

describe("compareSchemas", () => {
  it("flags an added field as non-breaking", () => {
    const r = compareSchemas(
      obj({ a: { type: "string" } }),
      obj({ a: { type: "string" }, b: { type: "number" } }),
    );
    expect(r.breaking).toHaveLength(0);
    expect(r.nonBreaking.map((c) => c.path)).toEqual(["b"]);
  });

  it("flags a removed field as breaking", () => {
    const r = compareSchemas(
      obj({ a: { type: "string" }, b: { type: "number" } }),
      obj({ a: { type: "string" } }),
    );
    expect(r.breaking.map((c) => c.path)).toEqual(["b"]);
  });

  it("non-nullable → nullable is non-breaking; the reverse is breaking", () => {
    const nonNull = obj({ a: { type: "string" } });
    const nullable = obj({ a: { anyOf: [{ type: "string" }, { type: "null" }] } });
    expect(compareSchemas(nonNull, nullable).nonBreaking).toHaveLength(1);
    expect(compareSchemas(nullable, nonNull).breaking).toHaveLength(1);
  });

  it("flags a type change as breaking", () => {
    const r = compareSchemas(obj({ a: { type: "string" } }), obj({ a: { type: "number" } }));
    expect(r.breaking[0].description).toContain("type changed");
  });

  it("recurses into nested objects", () => {
    const base = obj({ n: { type: "object", properties: { x: { type: "string" } } } });
    const curr = obj({ n: { type: "object", properties: {} } });
    expect(compareSchemas(base, curr).breaking.map((c) => c.path)).toEqual(["n.x"]);
  });
});

describe("snapshotSchemas + compareSnapshots", () => {
  it("an identical schema produces no changes", () => {
    const schema = z.object({ a: z.string(), b: z.number().nullable() });
    const a = snapshotSchemas({ Doc: schema }, "2026-06-28");
    const b = snapshotSchemas({ Doc: schema }, "2026-06-28");
    const r = compareSnapshots(a, b);
    expect(r.breaking).toHaveLength(0);
    expect(r.nonBreaking).toHaveLength(0);
  });

  it("adding a field across snapshots is non-breaking", () => {
    const base = snapshotSchemas({ Doc: z.object({ a: z.string() }) }, "t");
    const curr = snapshotSchemas({ Doc: z.object({ a: z.string(), c: z.boolean() }) }, "t");
    const r = compareSnapshots(base, curr);
    expect(r.breaking).toHaveLength(0);
    expect(r.nonBreaking.some((x) => x.path.endsWith("c"))).toBe(true);
  });
});
