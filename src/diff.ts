/**
 * Drift engine — diff a fresh snapshot against the committed baseline.
 *
 * Pure functions: no I/O, fully unit-tested. Every drift event carries a
 * severity; the exit-code decision is a separate pure function so CI
 * behavior is testable without spawning processes.
 */

import type { TargetSnapshot } from "./snapshot.js";

export type Severity = "high" | "medium" | "low";

export const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

export type DriftEventType =
  | "classification-changed"
  | "vendor-added"
  | "vendor-removed"
  | "status-class-changed"
  | "challenge-appeared"
  | "challenge-cleared"
  | "cookie-names-changed"
  | "redirect-chain-changed"
  | "body-markers-changed"
  | "probe-failed";

export interface DriftEvent {
  type: DriftEventType;
  severity: Severity;
  target: string;
  message: string;
  before?: string;
  after?: string;
}

/** probe-failed is a warning class, not a posture change. */
export function isDriftEvent(e: DriftEvent): boolean {
  return e.type !== "probe-failed";
}

function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

export function diffSnapshots(before: TargetSnapshot, after: TargetSnapshot): DriftEvent[] {
  const events: DriftEvent[] = [];
  const target = after.name;

  // ── classification ─────────────────────────────────────────────
  if (before.classification.kind !== after.classification.kind) {
    events.push({
      type: "classification-changed",
      severity: "high",
      target,
      message: `challenge classification changed: ${before.classification.kind} → ${after.classification.kind}`,
      before: before.classification.kind,
      after: after.classification.kind,
    });
  } else if (before.classification.confidence !== after.classification.confidence) {
    events.push({
      type: "classification-changed",
      severity: "low",
      target,
      message: `classification confidence changed: ${before.classification.kind} (${before.classification.confidence} → ${after.classification.confidence})`,
      before: before.classification.confidence,
      after: after.classification.confidence,
    });
  }

  // ── vendors (set diff) ─────────────────────────────────────────
  const beforeVendors = new Set(before.vendors);
  const afterVendors = new Set(after.vendors);
  for (const v of after.vendors) {
    if (!beforeVendors.has(v)) {
      events.push({
        type: "vendor-added",
        severity: "high",
        target,
        message: `new vendor in front of target: ${v}`,
        after: v,
      });
    }
  }
  for (const v of before.vendors) {
    if (!afterVendors.has(v)) {
      events.push({
        type: "vendor-removed",
        severity: "high",
        target,
        message: `vendor no longer detected: ${v}`,
        before: v,
      });
    }
  }

  // ── status class (2xx → 4xx is a posture change; 200 → 204 is not) ──
  if (statusClass(before.status) !== statusClass(after.status)) {
    events.push({
      type: "status-class-changed",
      severity: "high",
      target,
      message: `status class changed: ${before.status} → ${after.status}`,
      before: String(before.status),
      after: String(after.status),
    });
  }

  // ── challenge state ────────────────────────────────────────────
  if (!before.blocked && after.blocked) {
    events.push({
      type: "challenge-appeared",
      severity: "high",
      target,
      message: `a challenge now blocks the probe (${after.classification.kind}, ${after.classification.confidence})`,
    });
  } else if (before.blocked && !after.blocked) {
    events.push({
      type: "challenge-cleared",
      severity: "high",
      target,
      message: "the challenge no longer blocks the probe",
    });
  }

  // ── cookie names (set diff) ────────────────────────────────────
  const beforeCookies = new Set(before.cookieNames);
  const afterCookies = new Set(after.cookieNames);
  const addedCookies = after.cookieNames.filter((c) => !beforeCookies.has(c));
  const removedCookies = before.cookieNames.filter((c) => !afterCookies.has(c));
  if (addedCookies.length > 0 || removedCookies.length > 0) {
    const parts: string[] = [];
    if (addedCookies.length) parts.push(`+${addedCookies.join(", +")}`);
    if (removedCookies.length) parts.push(`-${removedCookies.join(", -")}`);
    events.push({
      type: "cookie-names-changed",
      severity: "medium",
      target,
      message: `set-cookie names changed: ${parts.join(" ")}`,
      before: before.cookieNames.join(","),
      after: after.cookieNames.join(","),
    });
  }

  // ── redirect chain ─────────────────────────────────────────────
  if (before.redirectChain.join(" → ") !== after.redirectChain.join(" → ")) {
    events.push({
      type: "redirect-chain-changed",
      severity: "medium",
      target,
      message: `redirect chain changed: ${before.redirectChain.join(" → ")} ⇒ ${after.redirectChain.join(" → ")}`,
      before: before.redirectChain.join(" → "),
      after: after.redirectChain.join(" → "),
    });
  }

  // ── body markers ───────────────────────────────────────────────
  if (before.bodyMarkerHash !== after.bodyMarkerHash) {
    events.push({
      type: "body-markers-changed",
      severity: "low",
      target,
      message: "body marker set changed (WAF/challenge markers in the HTML differ)",
      before: before.bodyMarkerHash.slice(0, 12),
      after: after.bodyMarkerHash.slice(0, 12),
    });
  }

  return events;
}

export function probeFailedEvent(target: string, error: string): DriftEvent {
  return {
    type: "probe-failed",
    severity: "medium",
    target,
    message: `probe failed (network/timeout, not a posture change): ${error}`,
  };
}

/** Sort: severity desc, then type. */
export function sortEvents(events: DriftEvent[]): DriftEvent[] {
  return [...events].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.type.localeCompare(b.type),
  );
}

export interface ExitDecision {
  code: 0 | 1;
  reason: string;
}

/**
 * Exit-code policy:
 *   - any real drift event           → 1
 *   - only probe-failed events       → 0 (warn), or 1 with --strict
 *   - nothing                        → 0
 */
export function decideExitCode(events: DriftEvent[], opts: { strict?: boolean } = {}): ExitDecision {
  const drift = events.filter(isDriftEvent);
  const failures = events.filter((e) => e.type === "probe-failed");

  if (drift.length > 0) {
    return { code: 1, reason: `${drift.length} drift event(s) across targets` };
  }
  if (failures.length > 0 && opts.strict) {
    return { code: 1, reason: `${failures.length} probe failure(s) (strict mode)` };
  }
  if (failures.length > 0) {
    return { code: 0, reason: `${failures.length} probe failure(s), no drift` };
  }
  return { code: 0, reason: "no drift" };
}
