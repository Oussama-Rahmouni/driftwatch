import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, validateConfig } from "../src/config.js";

test("config: loads targets and defaults snapshotDir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "driftwatch-test-"));
  try {
    const path = join(dir, "driftwatch.json");
    await writeFile(path, JSON.stringify({
      targets: [{ name: "example", url: "https://api.example.com" }],
    }));
    const config = await loadConfig(path);
    assert.equal(config.targets.length, 1);
    assert.equal(config.targets[0].name, "example");
    assert.equal(config.snapshotDir, ".driftwatch");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("config: respects explicit snapshotDir", () => {
  const config = validateConfig({
    targets: [{ name: "a", url: "https://a.example.com" }],
    snapshotDir: "snapshots/waf",
  });
  assert.equal(config.snapshotDir, "snapshots/waf");
});

test("config: missing file produces an actionable error", async () => {
  await assert.rejects(
    loadConfig(join(tmpdir(), "definitely-missing-driftwatch-config.json")),
    /Config file not found/,
  );
});

test("config: invalid JSON produces an actionable error", async () => {
  const dir = await mkdtemp(join(tmpdir(), "driftwatch-test-"));
  try {
    const path = join(dir, "driftwatch.json");
    await writeFile(path, "{ not json");
    await assert.rejects(loadConfig(path), /not valid JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("config: rejects empty targets", () => {
  assert.throws(() => validateConfig({ targets: [] }), /non-empty array/);
  assert.throws(() => validateConfig({}), /non-empty array/);
});

test("config: rejects target without url", () => {
  assert.throws(
    () => validateConfig({ targets: [{ name: "example" }] }),
    /url is required/,
  );
});

test("config: rejects target without name", () => {
  assert.throws(
    () => validateConfig({ targets: [{ url: "https://api.example.com" }] }),
    /name is required/,
  );
});

test("config: rejects non-http(s) urls and invalid urls", () => {
  assert.throws(
    () => validateConfig({ targets: [{ name: "a", url: "ftp://x.example.com" }] }),
    /must be http/,
  );
  assert.throws(
    () => validateConfig({ targets: [{ name: "a", url: "not a url" }] }),
    /not a valid URL/,
  );
});

test("config: rejects duplicate target names", () => {
  assert.throws(
    () => validateConfig({
      targets: [
        { name: "a", url: "https://a.example.com" },
        { name: "a", url: "https://b.example.com" },
      ],
    }),
    /duplicated/,
  );
});
