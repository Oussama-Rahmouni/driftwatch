/**
 * Config loading — driftwatch.json in the user's project.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface TargetConfig {
  name: string;
  url: string;
}

export interface DriftwatchConfig {
  targets: TargetConfig[];
  snapshotDir: string;
}

export const DEFAULT_CONFIG_PATH = "driftwatch.json";
export const DEFAULT_SNAPSHOT_DIR = ".driftwatch";

export async function loadConfig(configPath?: string): Promise<DriftwatchConfig> {
  const path = resolve(configPath ?? DEFAULT_CONFIG_PATH);

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch {
    throw new Error(
      `Config file not found: ${path}\nCreate one:\n` +
      `  { "targets": [{ "name": "example", "url": "https://example.com" }] }`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Config file ${path} is not valid JSON: ${(e as Error).message}`);
  }

  return validateConfig(parsed, path);
}

export function validateConfig(parsed: unknown, path = "config"): DriftwatchConfig {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${path}: top level must be an object`);
  }
  const obj = parsed as Record<string, unknown>;

  if (!Array.isArray(obj.targets) || obj.targets.length === 0) {
    throw new Error(`${path}: "targets" must be a non-empty array`);
  }

  const targets: TargetConfig[] = [];
  const seenNames = new Set<string>();

  for (let i = 0; i < obj.targets.length; i++) {
    const t = obj.targets[i] as Record<string, unknown>;
    const where = `${path}: targets[${i}]`;

    if (typeof t !== "object" || t === null) {
      throw new Error(`${where} must be an object with "name" and "url"`);
    }
    if (typeof t.name !== "string" || t.name.trim() === "") {
      throw new Error(`${where}.name is required (non-empty string)`);
    }
    if (typeof t.url !== "string" || t.url.trim() === "") {
      throw new Error(`${where}.url is required (non-empty string)`);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(t.url);
    } catch {
      throw new Error(`${where}.url is not a valid URL: ${t.url}`);
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(`${where}.url must be http(s): ${t.url}`);
    }
    if (seenNames.has(t.name)) {
      throw new Error(`${where}.name is duplicated: ${t.name}`);
    }
    seenNames.add(t.name);
    targets.push({ name: t.name, url: t.url });
  }

  const snapshotDir =
    typeof obj.snapshotDir === "string" && obj.snapshotDir.trim() !== ""
      ? obj.snapshotDir
      : DEFAULT_SNAPSHOT_DIR;

  return { targets, snapshotDir };
}
