/**
 * crema — build-over-build comparison.
 *
 * Compares two build metadata objects (crema `BuildMetadata`, per-key `counts`)
 * and flags anomalies: any key whose count moved by more than `threshold`%, a
 * total that moved by more than the threshold, or a key that appeared/retired.
 * Generic over the key dimension (state, region, …) and the record noun.
 */

import type { BuildMetadata } from "./metadata.js";

export interface KeyDelta {
  key: string;
  current: number;
  prior: number;
  delta: number;
  deltaPercent: number;
  isAnomaly: boolean;
}

export interface ComparisonResult {
  currentVersion: string;
  priorVersion: string;
  threshold: number;
  totalCurrent: number;
  totalPrior: number;
  totalDelta: number;
  totalDeltaPercent: number;
  totalAnomaly: boolean;
  keys: KeyDelta[];
  newKeys: string[];
  retiredKeys: string[];
  hasAnomalies: boolean;
}

function pctChange(current: number, prior: number): number {
  const delta = current - prior;
  return prior > 0 ? (Math.abs(delta) / prior) * 100 : current > 0 ? 100 : 0;
}

/** Compare two metadata objects into a structured, key-agnostic result. */
export function compareMetadata(
  current: BuildMetadata,
  prior: BuildMetadata,
  threshold = 1.0,
): ComparisonResult {
  const currentKeys = new Set(Object.keys(current.counts));
  const priorKeys = new Set(Object.keys(prior.counts));

  const newKeys = [...currentKeys].filter((k) => !priorKeys.has(k));
  const retiredKeys = [...priorKeys].filter((k) => !currentKeys.has(k));

  const keys: KeyDelta[] = [...new Set([...currentKeys, ...priorKeys])].sort().map((key) => {
    const cur = current.counts[key] ?? 0;
    const pri = prior.counts[key] ?? 0;
    const deltaPercent = pctChange(cur, pri);
    return {
      key,
      current: cur,
      prior: pri,
      delta: cur - pri,
      deltaPercent,
      isAnomaly: deltaPercent > threshold,
    };
  });

  const totalDelta = current.totalCount - prior.totalCount;
  const totalDeltaPercent = pctChange(current.totalCount, prior.totalCount);

  return {
    currentVersion: current.version,
    priorVersion: prior.version,
    threshold,
    totalCurrent: current.totalCount,
    totalPrior: prior.totalCount,
    totalDelta,
    totalDeltaPercent,
    totalAnomaly: totalDeltaPercent > threshold,
    keys,
    newKeys,
    retiredKeys,
    hasAnomalies:
      totalDeltaPercent > threshold ||
      keys.some((k) => k.isAnomaly) ||
      newKeys.length > 0 ||
      retiredKeys.length > 0,
  };
}

export interface ReportLabels {
  /** The record noun, e.g. "addresses" / "businesses". Default "records". */
  noun?: string;
  /** The key column label, e.g. "State". Default "Key". */
  keyLabel?: string;
}

/** Format a comparison result as a human-readable markdown report. */
export function formatComparisonReport(
  result: ComparisonResult,
  labels: ReportLabels = {},
): string {
  const noun = labels.noun ?? "records";
  const keyLabel = labels.keyLabel ?? "Key";
  const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
  const pct = (n: number): string => n.toFixed(2);
  const lines: string[] = [];

  lines.push("# Build-Over-Build Comparison", "");
  lines.push(`**Current:** ${result.currentVersion}`);
  lines.push(`**Prior:** ${result.priorVersion}`);
  lines.push(`**Anomaly threshold:** ${result.threshold}%`, "");

  lines.push("## Summary", "");
  lines.push(`| Metric | Current | Prior | Delta | Change |`);
  lines.push("|--------|--------:|------:|------:|-------:|");
  lines.push(
    `| **Total** | ${result.totalCurrent.toLocaleString()} | ${result.totalPrior.toLocaleString()} | ${sign(result.totalDelta)} | ${pct(result.totalDeltaPercent)}% ${result.totalAnomaly ? "⚠️" : ""} |`,
  );
  lines.push("");

  lines.push(`## Per-${keyLabel} Comparison`, "");
  lines.push(`| ${keyLabel} | Current | Prior | Delta | Change | Anomaly |`);
  lines.push("|-------|--------:|------:|------:|-------:|:-------:|");
  for (const k of result.keys) {
    lines.push(
      `| ${k.key} | ${k.current.toLocaleString()} | ${k.prior.toLocaleString()} | ${sign(k.delta)} | ${pct(k.deltaPercent)}% | ${k.isAnomaly ? "⚠️ YES" : "-"} |`,
    );
  }
  lines.push("");

  if (result.newKeys.length > 0)
    lines.push(`## New ${keyLabel}s: ${result.newKeys.join(", ")}`, "");
  if (result.retiredKeys.length > 0)
    lines.push(`## Retired ${keyLabel}s: ${result.retiredKeys.join(", ")}`, "");

  if (result.hasAnomalies) {
    lines.push("## ⚠️ Anomalies Detected", "");
    if (result.totalAnomaly) {
      lines.push(
        `- **Total count** changed by ${pct(result.totalDeltaPercent)}% (threshold: ${result.threshold}%)`,
      );
    }
    for (const k of result.keys.filter((k) => k.isAnomaly)) {
      lines.push(`- **${k.key}** changed by ${pct(k.deltaPercent)}% (${sign(k.delta)} ${noun})`);
    }
    for (const k of result.newKeys) lines.push(`- **${k}** is new (not in prior release)`);
    for (const k of result.retiredKeys)
      lines.push(`- **${k}** was retired (not in current release)`);
    lines.push("");
    lines.push(
      "> **Action required:** Review anomalies before publishing this release. " +
        "The release has been kept as a draft.",
    );
  } else {
    lines.push("## No Anomalies", "");
    lines.push("All metrics within expected range. Release can be published.");
  }

  return lines.join("\n");
}
