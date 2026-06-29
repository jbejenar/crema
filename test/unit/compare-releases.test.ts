/**
 * Unit tests for compare-releases.ts — generic build-over-build comparison.
 */

import { describe, it, expect } from "vitest";
import { compareMetadata, formatComparisonReport } from "../../src/compare-releases.js";
import type { BuildMetadata } from "../../src/metadata.js";

function meta(version: string, counts: Record<string, number>): BuildMetadata {
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    version,
    schemaVersion: "0.1.0",
    buildTimestamp: "2026-06-29T00:00:00Z",
    counts,
    totalCount,
    outputFiles: [],
  };
}

describe("compareMetadata", () => {
  it("reports no anomalies for a within-threshold change", () => {
    const r = compareMetadata(
      meta("v2", { nsw: 1005, vic: 500 }),
      meta("v1", { nsw: 1000, vic: 500 }),
      1.0,
    );
    expect(r.hasAnomalies).toBe(false);
    expect(r.totalDelta).toBe(5);
  });

  it("flags a key that moved beyond the threshold", () => {
    const r = compareMetadata(
      meta("v2", { nsw: 1200, vic: 500 }),
      meta("v1", { nsw: 1000, vic: 500 }),
      1.0,
    );
    expect(r.hasAnomalies).toBe(true);
    expect(r.keys.find((k) => k.key === "nsw")?.isAnomaly).toBe(true);
    expect(r.keys.find((k) => k.key === "vic")?.isAnomaly).toBe(false);
  });

  it("flags new and retired keys", () => {
    const r = compareMetadata(
      meta("v2", { nsw: 1000, act: 10 }),
      meta("v1", { nsw: 1000, other: 5 }),
      1.0,
    );
    expect(r.newKeys).toEqual(["act"]);
    expect(r.retiredKeys).toEqual(["other"]);
    expect(r.hasAnomalies).toBe(true);
  });

  it("treats a key appearing from zero as a 100% change", () => {
    const r = compareMetadata(meta("v2", { nsw: 1000, act: 10 }), meta("v1", { nsw: 1000 }), 1.0);
    expect(r.keys.find((k) => k.key === "act")?.deltaPercent).toBe(100);
  });
});

describe("formatComparisonReport", () => {
  it("injects the noun and key label", () => {
    const r = compareMetadata(meta("v2", { nsw: 1200 }), meta("v1", { nsw: 1000 }), 1.0);
    const md = formatComparisonReport(r, { noun: "businesses", keyLabel: "State" });
    expect(md).toContain("## Per-State Comparison");
    expect(md).toContain("businesses)");
    expect(md).toContain("⚠️ Anomalies Detected");
  });

  it("defaults to records / Key and reports clean when no anomalies", () => {
    const r = compareMetadata(meta("v2", { nsw: 1000 }), meta("v1", { nsw: 1000 }), 1.0);
    const md = formatComparisonReport(r);
    expect(md).toContain("## Per-Key Comparison");
    expect(md).toContain("## No Anomalies");
  });
});
