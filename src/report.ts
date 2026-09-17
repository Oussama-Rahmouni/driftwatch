/**
 * Report rendering — human-readable drift reports and posture tables.
 */

import { isDriftEvent, sortEvents, type DriftEvent, type Severity } from "./diff.js";
import type { TargetResult } from "./runner.js";

const SEVERITY_TAG: Record<Severity, string> = {
  high: "HIGH  ",
  medium: "MED   ",
  low: "LOW   ",
};

/** Drift report for `check`, grouped by target. */
export function renderDriftReport(results: TargetResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    const name = result.target.name;
    lines.push(`\n${name} (${result.target.url})`);

    if (result.error) {
      lines.push(`  ! probe failed: ${result.error}`);
      continue;
    }
    if (result.baselineRecorded) {
      lines.push(`  baseline recorded (${result.snapshot!.status}, ${result.snapshot!.classification.kind}) — nothing to diff yet`);
      continue;
    }

    const drift = result.events.filter(isDriftEvent);
    if (drift.length === 0) {
      lines.push(`  ok — no drift (${result.snapshot!.status}, ${result.snapshot!.classification.kind}, ${result.elapsedMs}ms)`);
      continue;
    }
    for (const e of sortEvents(drift)) {
      lines.push(`  [${SEVERITY_TAG[e.severity]}] ${e.type}: ${e.message}`);
    }
  }

  // Summary
  const events = results.flatMap((r) => r.events);
  const drift = events.filter(isDriftEvent);
  const failures = events.filter((e) => e.type === "probe-failed");
  const baselines = results.filter((r) => r.baselineRecorded).length;
  const highs = drift.filter((e) => e.severity === "high").length;

  lines.push("");
  const parts = [
    `${results.length} target(s)`,
    `${drift.length} drift event(s) (${highs} high)`,
  ];
  if (failures.length) parts.push(`${failures.length} probe failure(s)`);
  if (baselines) parts.push(`${baselines} baseline(s) recorded`);
  lines.push(`driftwatch: ${parts.join(", ")}`);

  return lines.join("\n");
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

/** Posture table for `report` — no diffing. */
export function renderPostureTable(results: TargetResult[]): string {
  const rows = results.map((r) => {
    if (r.error || !r.snapshot) {
      return { name: r.target.name, status: "ERR", classification: "-", vendors: "-", blocked: "-" };
    }
    const s = r.snapshot;
    return {
      name: s.name,
      status: String(s.status),
      classification: `${s.classification.kind} (${s.classification.confidence})`,
      vendors: s.vendors.join(", ") || "none",
      blocked: s.blocked ? "yes" : "no",
    };
  });

  const w = {
    name: Math.max(6, ...rows.map((r) => r.name.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    classification: Math.max(14, ...rows.map((r) => r.classification.length)),
    vendors: Math.max(7, ...rows.map((r) => r.vendors.length)),
  };

  const lines = [
    `${pad("target", w.name)}  ${pad("status", w.status)}  ${pad("classification", w.classification)}  ${pad("vendors", w.vendors)}  blocked`,
    `${"-".repeat(w.name)}  ${"-".repeat(w.status)}  ${"-".repeat(w.classification)}  ${"-".repeat(w.vendors)}  -------`,
    ...rows.map((r) =>
      `${pad(r.name, w.name)}  ${pad(r.status, w.status)}  ${pad(r.classification, w.classification)}  ${pad(r.vendors, w.vendors)}  ${r.blocked}`,
    ),
  ];
  return lines.join("\n");
}

/** Machine-readable output for --json. */
export function eventsToJson(results: TargetResult[]): string {
  const events: DriftEvent[] = results.flatMap((r) => r.events);
  return JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      targets: results.map((r) => ({
        name: r.target.name,
        url: r.target.url,
        ok: !r.error,
        baselineRecorded: r.baselineRecorded,
        events: r.events,
      })),
      events,
    },
    null,
    2,
  );
}
