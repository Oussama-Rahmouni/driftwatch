#!/usr/bin/env node
/**
 * driftwatch — CLI entry point.
 *
 * Subcommands:
 *   check    probe targets, diff against committed snapshots, exit 1 on drift
 *   update   probe targets, (re)write snapshots
 *   report   print current posture table, no diffing, no writes
 */

import { loadConfig } from "./config.js";
import { run } from "./runner.js";
import { decideExitCode } from "./diff.js";
import { renderDriftReport, renderPostureTable, eventsToJson } from "./report.js";

const USAGE = `driftwatch — know when your target's defenses change

Usage:
  driftwatch check [--config path] [--json] [--strict]
  driftwatch update [--config path] [--json]
  driftwatch report [--config path] [--json]

Config (driftwatch.json in your project):
  {
    "targets": [{ "name": "example", "url": "https://example.com" }],
    "snapshotDir": ".driftwatch"
  }

Options:
  --config <path>  Config file (default: ./driftwatch.json)
  --json           Machine-readable output
  --strict         check: probe failures (network/timeout) also fail the run
`;

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--no-")) {
      args[a.slice(5)] = false;
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  if (command !== "check" && command !== "update" && command !== "report") {
    console.error(`Unknown command: ${command}\n`);
    console.log(USAGE);
    return 1;
  }

  const args = parseArgs(rest);
  const config = await loadConfig(args["config"] as string | undefined);
  const results = await run(config, { mode: command });

  if (args["json"]) {
    console.log(eventsToJson(results));
  } else if (command === "report") {
    console.log(renderPostureTable(results));
  } else {
    console.log(renderDriftReport(results));
    if (command === "update") {
      const ok = results.filter((r) => !r.error).length;
      console.log(`\ndriftwatch: ${ok}/${results.length} snapshot(s) written to ${config.snapshotDir}/`);
    }
  }

  if (command === "check") {
    const decision = decideExitCode(results.flatMap((r) => r.events), { strict: args["strict"] === true });
    return decision.code;
  }
  // update/report: fail only if every probe failed
  return results.every((r) => r.error) ? 1 : 0;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`driftwatch: ${(err as Error).message}`);
      process.exit(2);
    });
}
