# driftwatch

Know when your target's defenses change.

driftwatch probes a list of URLs, snapshots each target's anti-bot posture (status, challenge classification, vendor signals, cookie names, redirect chain), and diffs against a committed baseline. When a target's defenses change — new WAF, new challenge, 200 → 403 — the check fails with a human-readable diff. Run it nightly in CI and you find out before your pipeline does.

## The problem

Anti-bot vendors ship changes silently. A target adds DataDome, tightens a Cloudflare rule, or starts gating behind a challenge, and nothing notifies you — the first symptom is your crawler returning garbage or dying mid-run. If you crawl a handful of targets, the fix is cheap: probe each target daily with a deliberately non-stealthy client and alert when the defensive posture moves.

## Install

```sh
npm install
npm run build
npm link        # puts `driftwatch` on PATH
```

Node ≥ 20. Zero runtime dependencies.

## Quickstart

Declare your targets in your crawling project's repo:

```json
// driftwatch.json
{
  "targets": [
    { "name": "example-api", "url": "https://api.example.com/v1/listings" },
    { "name": "example-web", "url": "https://www.example.com/" }
  ],
  "snapshotDir": ".driftwatch"
}
```

Record the baseline and commit it:

```sh
driftwatch update
git add .driftwatch/ driftwatch.json && git commit -m "driftwatch baseline"
```

Then check — exits 1 when anything drifted:

```sh
driftwatch check
```

```
example-api (https://api.example.com/v1/listings)
  [HIGH  ] classification-changed: challenge classification changed: none → cloudflare
  [HIGH  ] vendor-added: new vendor in front of target: cloudflare
  [HIGH  ] challenge-appeared: a challenge now blocks the probe (cloudflare, high)
  [MED   ] cookie-names-changed: set-cookie names changed: +__cf_bm

driftwatch: 2 target(s), 4 drift event(s) (4 high)
```

Rebaseline after an intentional change with `driftwatch update`. Use `driftwatch report` for a posture table without diffing, and `--json` on any subcommand for machine-readable output.

## GitHub Action recipe

```yaml
name: driftwatch
on:
  schedule:
    - cron: "17 4 * * *"   # nightly
  workflow_dispatch:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      # driftwatch is not on npm yet — install from source until it is:
      - run: npm install -g github:Oussama-Rahmouni/driftwatch   # or npm i -g driftwatch once published
      - run: driftwatch check --json > drift-events.json || true
      - run: driftwatch check
      # on failure: open an issue / post to Slack from drift-events.json
```

Snapshots live in `.driftwatch/` next to your config — commit them so the diff baseline is versioned with the crawler it protects.

## Drift events

| Event | Severity | Meaning |
|---|---|---|
| `classification-changed` | high (low if only confidence moved) | the challenge kind changed: `none → cloudflare`, `cloudflare → datadome` |
| `vendor-added` | high | a new WAF/bot-manager/CDN signature appeared |
| `vendor-removed` | high | a vendor signature disappeared |
| `status-class-changed` | high | status class moved: 2xx → 4xx/5xx |
| `challenge-appeared` | high | the probe is now blocked |
| `challenge-cleared` | high | the probe is no longer blocked |
| `cookie-names-changed` | medium | set-cookie names added/removed (new session tokens to solve) |
| `redirect-chain-changed` | medium | the target now redirects differently (often into a challenge page) |
| `body-markers-changed` | low | the set of WAF markers in the HTML changed |
| `probe-failed` | warning | DNS/timeout/TLS — a network blip, not a posture change. `check` warns and passes; `--strict` makes it fail |

The body comparison hashes the canonical list of matched WAF markers, not the HTML — cosmetic page changes don't false-positive.

## How detection works

The detection engine (challenge classifier + passive vendor fingerprints) is shared with [whichwaf](https://github.com/Oussama-Rahmouni/whichwaf) (31 vendor signatures, synced at whichwaf v0.2.0). The classifier distinguishes a WAF's *presence* (benign JS on a 200) from a *block* (interstitial, challenge status) — presence alone doesn't count as a challenge, so baselines on clean targets stay clean.

## Limitations

- Single vantage point: the probe runs from wherever CI runs. Geo-gated or ASN-scored targets may look different from your crawler's IPs.
- No JS rendering and no stealth — deliberately. It's a posture tripwire ("what does the WAF do to a non-browser client?"), not a full browser probe. A target can change its behavior against real browsers without tripping driftwatch.
- The probe fetch is plain `fetch` with an honest UA. For the fetch layer of the actual crawler, pair with [impersonate](https://github.com/Oussama-Rahmouni/impersonate) (TLS fingerprinting) and [tokenbank](https://github.com/Oussama-Rahmouni/tokenbank) (clearance-token lifecycle).

## License

MIT — Oussama Rahmouni
