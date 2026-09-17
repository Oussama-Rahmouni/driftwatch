/**
 * Snapshot — the committed baseline of a target's anti-bot posture.
 *
 * One JSON file per target under the snapshot dir, committed to git by the
 * user. `check` diffs a fresh probe against it.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProbeResult } from "./probe.js";
import type { Analysis } from "./analyze.js";
import { SIGNATURES } from "./vendors.js";

export interface TargetSnapshot {
  name: string;
  url: string;
  probedAt: string;
  finalUrl: string;
  status: number;
  classification: {
    kind: string;
    confidence: string;
    evidence: string;
  };
  blocked: boolean;
  /** sorted vendor names */
  vendors: string[];
  /** sorted set-cookie names */
  cookieNames: string[];
  redirectChain: string[];
  /** informational: server header + presence flags for known WAF headers */
  headersOfInterest: Record<string, string>;
  /** sha256 over the canonical list of matched body markers — cosmetic
   *  HTML changes that don't touch markers produce the same hash */
  bodyMarkerHash: string;
}

const HEADERS_OF_INTEREST = [
  "server",
  "cf-ray",
  "cf-mitigated",
  "x-datadome",
  "x-dd-debug",
  "x-kpsdk-ct",
  "x-amzn-waf-action",
  "x-px-original-token",
  "x-iinfo",
  "x-akamai-transformed",
];

/**
 * Canonical body markers: for every vendor body pattern that matches, record
 * `vendor:pattern-source`. The pattern source — not the matched substring —
 * keeps the marker stable across cosmetic page changes.
 */
export function extractBodyMarkers(body: string): string[] {
  const markers: string[] = [];
  for (const sig of SIGNATURES) {
    for (const re of sig.bodyPatterns ?? []) {
      if (re.test(body)) markers.push(`${sig.name}:${re.source}`);
    }
  }
  return markers.sort();
}

export function hashBodyMarkers(body: string): string {
  const markers = extractBodyMarkers(body);
  return createHash("sha256").update(markers.join("\n")).digest("hex");
}

function cookieNamesFromHeaders(headers: ProbeResult["headers"]): string[] {
  const raw = headers["set-cookie"];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const names = new Set<string>();
  for (const c of list) {
    const eq = c.indexOf("=");
    if (eq > 0) names.add(c.slice(0, eq).trim());
  }
  return [...names].sort();
}

function headersOfInterestFrom(headers: ProbeResult["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of HEADERS_OF_INTEREST) {
    const v = headers[name];
    if (v === undefined) continue;
    // Presence is the signal; keep the value only where it's stable and useful
    // (server). Volatile IDs (cf-ray request IDs) are recorded as "present".
    out[name] = name === "server" ? String(Array.isArray(v) ? v.join(",") : v) : "present";
  }
  return out;
}

export function buildSnapshot(
  name: string,
  probed: ProbeResult,
  analysis: Analysis,
  probedAt = new Date().toISOString(),
): TargetSnapshot {
  return {
    name,
    url: probed.url,
    probedAt,
    finalUrl: probed.finalUrl,
    status: probed.status,
    classification: {
      kind: analysis.challenge.kind,
      confidence: analysis.challenge.confidence,
      evidence: analysis.challenge.evidence,
    },
    blocked: analysis.blocked,
    vendors: analysis.vendors.map((v) => v.name).sort(),
    cookieNames: cookieNamesFromHeaders(probed.headers),
    redirectChain: probed.redirectChain,
    headersOfInterest: headersOfInterestFrom(probed.headers),
    bodyMarkerHash: hashBodyMarkers(probed.body),
  };
}

// ── Store ──────────────────────────────────────────────────────

/** Filesystem-safe file name for a target. */
export function snapshotFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug || "target"}.json`;
}

export async function writeSnapshot(dir: string, snapshot: TargetSnapshot): Promise<string> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, snapshotFileName(snapshot.name));
  await writeFile(path, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
  return path;
}

/** Returns null when no baseline exists yet (first run records one). */
export async function readSnapshot(dir: string, name: string): Promise<TargetSnapshot | null> {
  const path = join(dir, snapshotFileName(name));
  try {
    return JSON.parse(await readFile(path, "utf-8")) as TargetSnapshot;
  } catch {
    return null;
  }
}
