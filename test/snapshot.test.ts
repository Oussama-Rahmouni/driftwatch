import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSnapshot, hashBodyMarkers, readSnapshot, snapshotFileName, writeSnapshot,
} from "../src/snapshot.js";
import { analyze } from "../src/analyze.js";
import { diffSnapshots } from "../src/diff.js";
import type { ProbeResult } from "../src/probe.js";

function makeProbed(body: string, headers: Record<string, string | string[]> = {}): ProbeResult {
  return {
    url: "https://api.example.com/",
    finalUrl: "https://api.example.com/",
    status: 200,
    headers: { server: "nginx", ...headers },
    body,
    redirectChain: ["https://api.example.com/"],
    elapsedMs: 100,
  };
}

function snapFrom(body: string, headers: Record<string, string | string[]> = {}) {
  const probed = makeProbed(body, headers);
  const analysis = analyze({ status: probed.status, headers: probed.headers, body: probed.body });
  return buildSnapshot("example", probed, analysis, "2026-01-01T00:00:00.000Z");
}

test("snapshot store: write/read round-trip", async () => {
  const dir = await mkdtemp(join(tmpdir(), "driftwatch-test-"));
  try {
    const snap = snapFrom("<html><body>hello</body></html>");
    const path = await writeSnapshot(dir, snap);
    assert.ok(path.endsWith("example.json"));

    const loaded = await readSnapshot(dir, "example");
    assert.deepEqual(loaded, snap);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot store: missing snapshot returns null (baseline behavior)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "driftwatch-test-"));
  try {
    assert.equal(await readSnapshot(dir, "never-probed"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("snapshot: target names become filesystem-safe slugs", () => {
  assert.equal(snapshotFileName("My API (v2)"), "my-api-v2.json");
  assert.equal(snapshotFileName("example"), "example.json");
});

test("snapshot: captures classification, vendors, cookie names, headers of interest", () => {
  const snap = snapFrom(
    "<title>Just a moment...</title><div id=\"challenge-platform\"></div>",
    { "cf-ray": "8abc-IAD", server: "cloudflare", "set-cookie": ["__cf_bm=abc; Path=/", "sessionid=xyz; Path=/"] },
  );
  // status is 200 here, so not blocked — but vendor + cookies are captured
  assert.ok(snap.vendors.includes("cloudflare"));
  assert.deepEqual(snap.cookieNames, ["__cf_bm", "sessionid"]);
  assert.equal(snap.headersOfInterest["server"], "cloudflare");
  assert.equal(snap.headersOfInterest["cf-ray"], "present");
});

test("body markers: cosmetic HTML change with same markers → same hash, no drift", () => {
  const bodyA = `<html><head><title>Listings</title></head><body>
    <h1>240 results</h1><script src="https://api-js.datadome.co/tags.js"></script></body></html>`;
  const bodyB = `<html><head><title>Listings — updated!</title></head><body>
    <h1>312 results</h1><p>totally different page text</p>
    <script src="https://api-js.datadome.co/tags.js"></script></body></html>`;

  assert.equal(hashBodyMarkers(bodyA), hashBodyMarkers(bodyB));

  const before = snapFrom(bodyA);
  const after = snapFrom(bodyB);
  assert.deepEqual(diffSnapshots(before, after), []);
});

test("body markers: marker added → hash changes → body-markers-changed fires", () => {
  const clean = "<html><body>hello</body></html>";
  const withWidget = clean + "<div class=\"h-captcha\" data-sitekey=\"x\"></div>";

  assert.notEqual(hashBodyMarkers(clean), hashBodyMarkers(withWidget));

  const before = snapFrom(clean);
  const after = snapFrom(withWidget);
  const types = diffSnapshots(before, after).map((e) => e.type);
  assert.ok(types.includes("body-markers-changed"));
  assert.ok(types.includes("vendor-added")); // hcaptcha vendor appears too
  assert.ok(types.includes("classification-changed")); // none → hcaptcha
});
