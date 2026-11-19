# Phase gate run 1: clean export of HEAD 299dc39 (agent a4eea4e4f7eac4648 resumed for Task 1.13 step 2; 2026-11-08 ~18:20 to 18:53)

Export: /private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/90b0c714-a63a-40cc-af79-924447502595/scratchpad/sieve-gate (git archive HEAD; raw logs gate-*.log|out|err in the same scratchpad). No edits to the repo worktree, no commits. The agent went past "stop on a failing gate" twice (diagnostic re-runs of e2e and then perf), reported as such.

| Step | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0, 29 workspace projects |
| `pnpm test` | exit 0; 14 suites `# fail 0`; 667 tests, 667 pass (apps/sieve 43/43, packages/sieve-core 139/139, packages/core 112/112) |
| `pnpm typecheck` | exit 0, no `error TS` |
| `pnpm --filter sieve build` | exit 0; fresh list download: ads 50,841; trackers 56,427; distraction 2,037; cookies 2,111; antiadblock 4,673; ai 0 (4 hosts); Rules: 116,089 in all, all on by default (above the 30,000 Chrome guarantees; harmless Node MODULE_TYPELESS_PACKAGE_JSON warning) |
| `pnpm --filter sieve test:e2e` run 1 | exit 1, 170/171: failing check test/e2e.mjs:1452 (JSON.parse and Response.json act as the browser's own ...): the page's JSON.parse and Response.json were named `jsonParseWrapper` / `responseJsonWrapper` with the wrapper source as toString (the AdGuard json-prune scriptlet from the antiadblock list for www.youtube.com wrapped, or was wrapped by, yt-main's wrappers) |
| e2e run 2 (no change) | exit 0, 171/171: the check is intermittent (a race between the worker-injected scriptlet and the document_start content script; cause not proven) |
| `node apps/sieve/test/perf.mjs` run 1 (7 min 12 s) | exit 1: local part PASS (+7.0 ms, limit +20); real sites: guardian 0.95x pass; dawn.com excluded (HTTP 403 on both sides); edition.cnn.com excluded (without the extension 0/2 loads: timeout 60 s; with it 2/2 loaded in about 10-12 s); weather.com 0.59x pass (5/5 with, 3/5 without: timeouts without); bbc 1.35x slower (with 2.8-7.1 s, without 2.4-11.3 s: noise); 2 of 5 (need 4) |
| perf rerun (7 min 45 s) | exit 1: local +6.8 ms PASS; guardian 1.04x pass; dawn excluded (403); cnn excluded; weather excluded (without 2/5 loads); bbc 0.87x pass; 2 of 5, 3 excluded |

No site lost loads with the extension, so there is no "real break" under the rerun policy. Heap (page JS only): weather.com 17 vs 54 MB, bbc 13 vs 31 MB, cnn 27 MB with (no reading without), guardian about the same.
Reading: the local page cost is +7 ms (limit 20). The real-site gate cannot reach 4 of 5 with the plan's site list in headless Chrome here: the failures are the sites (403 on dawn.com; cnn.com and weather.com do not finish loading without an ad blocker), not the extension.

Decisions (controller): (1) the e2e flake goes to agent A (make the shape check deterministic by isolating the antiadblock scriptlet; add an order-independent behaviour check; report whether the double wrapping matters in production); (2) the perf site list is replaced by sites that load reliably without the extension (probe candidates; rule R23 and the pass threshold unchanged); then the FULL gate is re-run once from a clean export of the final HEAD.
