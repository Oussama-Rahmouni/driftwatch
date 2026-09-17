export { detectChallenge, headerVal, hasHeader, type ChallengeKind, type ChallengeSignal, type DetectInput } from "./detect.js";
export { fingerprintVendors, SIGNATURES, type VendorHit, type VendorSignature } from "./vendors.js";
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
