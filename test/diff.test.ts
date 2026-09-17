import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideExitCode, diffSnapshots, probeFailedEvent, sortEvents,
  type DriftEvent,
} from "../src/diff.js";
import type { TargetSnapshot } from "../src/snapshot.js";

function makeSnapshot(overrides: Partial<TargetSnapshot> = {}): TargetSnapshot {
  return {
    name: "example",
    url: "https://api.example.com/",
    probedAt: "2026-01-01T00:00:00.000Z",
    finalUrl: "https://api.example.com/",
    status: 200,
    classification: { kind: "none", confidence: "high", evidence: "status 200, no WAF markers" },
    blocked: false,
    vendors: [],
    cookieNames: ["sessionid"],
    redirectChain: ["https://api.example.com/"],
    headersOfInterest: { server: "nginx" },
    bodyMarkerHash: "aaa",
    ...overrides,
  };
}

test("diff: identical snapshots produce no events", () => {
  assert.deepEqual(diffSnapshots(makeSnapshot(), makeSnapshot()), []);
});

test("diff: cosmetic probe metadata changes produce no events", () => {
  const after = makeSnapshot({ probedAt: "2026-01-02T00:00:00.000Z" });
  assert.deepEqual(diffSnapshots(makeSnapshot(), after), []);
});

test("diff: classification-changed (high)", () => {
  const after = makeSnapshot({
    classification: { kind: "cloudflare", confidence: "high", evidence: "cf-ray + status 503" },
  });
  const events = diffSnapshots(makeSnapshot(), after);
  const e = events.find((e) => e.type === "classification-changed");
  assert.ok(e);
  assert.equal(e.severity, "high");
  assert.equal(e.before, "none");
  assert.equal(e.after, "cloudflare");
});

test("diff: confidence-only change is classification-changed (low)", () => {
  const before = makeSnapshot({ classification: { kind: "datadome", confidence: "low", evidence: "x" } });
  const after = makeSnapshot({ classification: { kind: "datadome", confidence: "high", evidence: "y" } });
  const events = diffSnapshots(before, after);
  const e = events.find((e) => e.type === "classification-changed");
  assert.ok(e);
  assert.equal(e.severity, "low");
});

test("diff: vendor-added and vendor-removed (high)", () => {
  const added = diffSnapshots(makeSnapshot(), makeSnapshot({ vendors: ["datadome"] }));
  const ea = added.find((e) => e.type === "vendor-added");
  assert.ok(ea);
  assert.equal(ea.severity, "high");
  assert.equal(ea.after, "datadome");

  const removed = diffSnapshots(makeSnapshot({ vendors: ["cloudflare"] }), makeSnapshot());
  const er = removed.find((e) => e.type === "vendor-removed");
  assert.ok(er);
  assert.equal(er.before, "cloudflare");
});

test("diff: status-class-changed (high), but 200→204 is not a class change", () => {
  const events = diffSnapshots(makeSnapshot(), makeSnapshot({ status: 403 }));
  const e = events.find((e) => e.type === "status-class-changed");
  assert.ok(e);
  assert.equal(e.severity, "high");

  assert.equal(
    diffSnapshots(makeSnapshot(), makeSnapshot({ status: 204 })).filter((e) => e.type === "status-class-changed").length,
    0,
  );
});

test("diff: challenge-appeared / challenge-cleared (high)", () => {
  const appeared = diffSnapshots(makeSnapshot(), makeSnapshot({ blocked: true }));
  const ea = appeared.find((e) => e.type === "challenge-appeared");
  assert.ok(ea);
  assert.equal(ea.severity, "high");

  const cleared = diffSnapshots(makeSnapshot({ blocked: true }), makeSnapshot());
  const ec = cleared.find((e) => e.type === "challenge-cleared");
  assert.ok(ec);
  assert.equal(ec.severity, "high");
});

test("diff: cookie-names-changed (medium), added and removed", () => {
  const after = makeSnapshot({ cookieNames: ["sessionid", "datadome"] });
  const events = diffSnapshots(makeSnapshot(), after);
  const e = events.find((e) => e.type === "cookie-names-changed");
  assert.ok(e);
  assert.equal(e.severity, "medium");
  assert.match(e.message, /\+datadome/);
});

test("diff: redirect-chain-changed (medium)", () => {
  const after = makeSnapshot({ redirectChain: ["https://api.example.com/", "https://api.example.com/blocked"] });
  const events = diffSnapshots(makeSnapshot(), after);
  const e = events.find((e) => e.type === "redirect-chain-changed");
  assert.ok(e);
  assert.equal(e.severity, "medium");
});

test("diff: body-markers-changed (low)", () => {
  const events = diffSnapshots(makeSnapshot(), makeSnapshot({ bodyMarkerHash: "bbb" }));
  const e = events.find((e) => e.type === "body-markers-changed");
  assert.ok(e);
  assert.equal(e.severity, "low");
});

test("diff: full posture flip fires the right combined events", () => {
  // clean 200 → Cloudflare 503 challenge
  const before = makeSnapshot({ vendors: [], status: 200 });
  const after = makeSnapshot({
    status: 503,
    blocked: true,
    vendors: ["cloudflare"],
    classification: { kind: "cloudflare", confidence: "high", evidence: "cf-ray + status 503" },
    cookieNames: ["sessionid", "__cf_bm"],
  });
  const types = diffSnapshots(before, after).map((e) => e.type);
  assert.ok(types.includes("classification-changed"));
  assert.ok(types.includes("status-class-changed"));
  assert.ok(types.includes("challenge-appeared"));
  assert.ok(types.includes("vendor-added"));
  assert.ok(types.includes("cookie-names-changed"));
});

test("sortEvents: high severity first", () => {
  const events: DriftEvent[] = [
    { type: "body-markers-changed", severity: "low", target: "t", message: "" },
    { type: "classification-changed", severity: "high", target: "t", message: "" },
    { type: "cookie-names-changed", severity: "medium", target: "t", message: "" },
  ];
  const sorted = sortEvents(events);
  assert.equal(sorted[0].severity, "high");
  assert.equal(sorted[1].severity, "medium");
  assert.equal(sorted[2].severity, "low");
});

test("exit code: drift fails the check", () => {
  const events = diffSnapshots(makeSnapshot(), makeSnapshot({ status: 403 }));
  assert.equal(decideExitCode(events).code, 1);
});

test("exit code: clean run passes", () => {
  assert.equal(decideExitCode([]).code, 0);
  assert.equal(decideExitCode([], { strict: true }).code, 0);
});

test("exit code: probe-failed warns, fails only with strict", () => {
  const events = [probeFailedEvent("example", "getaddrinfo ENOTFOUND api.example.com")];
  assert.equal(decideExitCode(events).code, 0);
  assert.equal(decideExitCode(events, { strict: true }).code, 1);
});

test("exit code: probe-failed does not mask drift", () => {
  const events = [
    probeFailedEvent("a", "timeout"),
    ...diffSnapshots(makeSnapshot({ name: "b" }), makeSnapshot({ name: "b", status: 403 })),
  ];
  assert.equal(decideExitCode(events).code, 1);
});
