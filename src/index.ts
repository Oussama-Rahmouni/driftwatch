export { detectChallenge, fingerprintVendors, SIGNATURES } from "whichwaf";
export type { ChallengeKind, ChallengeSignal, DetectInput, VendorHit, VendorSignature } from "whichwaf";

/** case-insensitive header lookup, same semantics as whichwaf's internal helper */
export function headerVal(headers: import("whichwaf").DetectInput["headers"], name: string): string | null {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v.join(",") : (v ?? null);
  }
  return null;
}

export function hasHeader(headers: import("whichwaf").DetectInput["headers"], name: string): boolean {
  return headerVal(headers, name) !== null;
}

export { analyze, type Analysis, type Layer } from "./analyze.js";
export { probe, type ProbeResult } from "./probe.js";
export { loadConfig, validateConfig, type DriftwatchConfig, type TargetConfig } from "./config.js";
export {
  buildSnapshot, extractBodyMarkers, hashBodyMarkers,
  readSnapshot, writeSnapshot, snapshotFileName, type TargetSnapshot,
} from "./snapshot.js";
export {
  diffSnapshots, decideExitCode, sortEvents, probeFailedEvent, isDriftEvent,
  type DriftEvent, type DriftEventType, type Severity,
} from "./diff.js";
export { run, pool, type TargetResult, type RunOptions } from "./runner.js";
export { renderDriftReport, renderPostureTable, eventsToJson } from "./report.js";
