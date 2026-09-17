/**
 * Runner — probe targets, build snapshots, diff against baselines.
 */

import { resolve } from "node:path";
import type { DriftwatchConfig, TargetConfig } from "./config.js";
import { probe, type ProbeResult } from "./probe.js";
import { analyze } from "./analyze.js";
import { buildSnapshot, readSnapshot, writeSnapshot, type TargetSnapshot } from "./snapshot.js";
import { diffSnapshots, probeFailedEvent, type DriftEvent } from "./diff.js";

export interface TargetResult {
  target: TargetConfig;
  snapshot: TargetSnapshot | null;
  /** set when the probe itself failed (DNS, timeout, TLS) */
  error: string | null;
  /** true when no baseline existed and this run recorded one */
  baselineRecorded: boolean;
  events: DriftEvent[];
  elapsedMs: number;
}

/** Run tasks with a small concurrency pool. */
export async function pool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function probeTarget(target: TargetConfig): Promise<{ probed: ProbeResult; analysis: ReturnType<typeof analyze> }> {
  const probed = await probe(target.url);
  const analysis = analyze({ status: probed.status, headers: probed.headers, body: probed.body, url: probed.finalUrl });
  return { probed, analysis };
}

export interface RunOptions {
  concurrency?: number;
  /** "check" diffs against baselines; "update" overwrites them; "report" does neither */
  mode: "check" | "update" | "report";
}

export async function run(config: DriftwatchConfig, opts: RunOptions): Promise<TargetResult[]> {
  const snapshotDir = resolve(config.snapshotDir);
  const concurrency = opts.concurrency ?? 4;

  return pool(config.targets, concurrency, async (target): Promise<TargetResult> => {
    let probed: ProbeResult;
    let analysis: ReturnType<typeof analyze>;
    try {
      ({ probed, analysis } = await probeTarget(target));
    } catch (e) {
      const msg = (e as Error).message;
      return {
        target,
        snapshot: null,
        error: msg,
        baselineRecorded: false,
        events: [probeFailedEvent(target.name, msg)],
        elapsedMs: 0,
      };
    }

    const snapshot = buildSnapshot(target.name, probed, analysis);
    const base: TargetResult = {
      target,
      snapshot,
      error: null,
      baselineRecorded: false,
      events: [],
      elapsedMs: probed.elapsedMs,
    };

    if (opts.mode === "report") return base;

    if (opts.mode === "update") {
      await writeSnapshot(snapshotDir, snapshot);
      return base;
    }

    // check
    const baseline = await readSnapshot(snapshotDir, target.name);
    if (!baseline) {
      await writeSnapshot(snapshotDir, snapshot);
      base.baselineRecorded = true;
      return base;
    }
    base.events = diffSnapshots(baseline, snapshot);
    return base;
  });
}

export function allEvents(results: TargetResult[]): DriftEvent[] {
  return results.flatMap((r) => r.events);
}
