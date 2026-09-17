import { test } from "node:test";
import assert from "node:assert/strict";
import { detectChallenge } from "../src/detect.js";

/**
 * Canned WAF responses → expected classification.
 * The detector is vendored from whichwaf; this table is the regression net.
 */
const fixtures: Array<{
  name: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  expect: string;
}> = [
  {
    name: "cloudflare-challenge",
    status: 503,
    headers: { "cf-ray": "8abc12345-IAD", server: "cloudflare" },
    body: "<title>Just a moment...</title><div id=\"challenge-platform\"></div>",
    expect: "cloudflare",
  },
  {
    name: "datadome-block",
    status: 403,
    headers: { "x-dd-debug": "gw=...; bb=1" },
    body: "<script src=\"https://geo.captcha-delivery.com/captcha/?...\"></script>",
    expect: "datadome",
  },
  {
    name: "perimeterx-block",
    status: 403,
    headers: {},
    body: "window._pxAppId=\"PX...\"; var px_captcha = true;",
    expect: "perimeterx",
  },
  {
    name: "akamai-block",
    status: 403,
    headers: { server: "AkamaiGHost" },
    body: "Reference #18.abcdef.1700000000.123ab — your access has been blocked",
    expect: "akamai",
  },
  {
    name: "recaptcha-v2",
    status: 200,
    headers: {},
    body: "<div class=\"g-recaptcha\" data-sitekey=\"...\"></div><script src=\"https://www.google.com/recaptcha/api.js\"></script>",
    expect: "recaptcha",
  },
  {
    name: "hcaptcha",
    status: 200,
    headers: {},
    body: "<div class=\"h-captcha\" data-sitekey=\"...\"></div>",
    expect: "hcaptcha",
  },
  {
    name: "turnstile",
    status: 403,
    headers: {},
    body: "<script src=\"https://challenges.cloudflare.com/turnstile/v0/api.js\"></script>",
    expect: "turnstile",
  },
  {
    name: "normal-200",
    status: 200,
    headers: { "content-type": "text/html" },
    body: "<html><body>Hello world</body></html>",
    expect: "none",
  },
];

for (const f of fixtures) {
  test(`classify: ${f.name} → ${f.expect}`, () => {
    const sig = detectChallenge({ status: f.status, headers: f.headers, body: f.body });
    assert.equal(sig.kind, f.expect, `evidence: ${sig.evidence}`);
  });
}

test("classify: datadome presence on a clean 200 is not a block", () => {
  const sig = detectChallenge({
    status: 200,
    headers: {},
    body: "<script src=\"https://api-js.datadome.co/tags.js\"></script><html><body>ok</body></html>",
  });
  assert.equal(sig.kind, "datadome");
  assert.equal(sig.confidence, "low"); // presence, not blocking
});
