/**
 * Unit tests for flatten-engine.ts.
 *
 * The streamFlatten() DB path requires a live Postgres and is exercised by the
 * consumer's fixture loop. Here we lock the two pieces that must never regress:
 * the FLATTEN_POSTGRES_CONFIG (the E1.24 connection-lifecycle fix) and the
 * __SCHEMA_VERSION__ substitution boundary.
 */

import { describe, it, expect } from "vitest";
import { FLATTEN_POSTGRES_CONFIG, applySchemaVersion } from "../../src/flatten-engine.js";

describe("FLATTEN_POSTGRES_CONFIG", () => {
  it("pins the E1.24 connection-lifecycle settings", () => {
    expect(FLATTEN_POSTGRES_CONFIG.max).toBe(1);
    expect(FLATTEN_POSTGRES_CONFIG.max_lifetime).toBeNull();
    expect(FLATTEN_POSTGRES_CONFIG.transform.undefined).toBeNull();
  });
});

describe("applySchemaVersion", () => {
  it("substitutes every __SCHEMA_VERSION__ placeholder when a version is given", () => {
    const sql = "SELECT * FROM abn___SCHEMA_VERSION__.abn JOIN x___SCHEMA_VERSION__.y";
    expect(applySchemaVersion(sql, "20260628")).toBe(
      "SELECT * FROM abn_20260628.abn JOIN x_20260628.y",
    );
  });

  it("leaves SQL untouched when no version is given (engine knows no version format)", () => {
    const sql = "SELECT * FROM abn___SCHEMA_VERSION__.abn";
    expect(applySchemaVersion(sql, undefined)).toBe(sql);
  });

  it("does not validate the version format (8-digit date is accepted)", () => {
    expect(applySchemaVersion("s___SCHEMA_VERSION__", "20260628")).toBe("s_20260628");
    expect(applySchemaVersion("s___SCHEMA_VERSION__", "202602")).toBe("s_202602");
  });
});
