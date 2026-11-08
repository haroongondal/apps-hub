# YouTube playback measurement with and without Sieve (2026-11-08)

Why: in the Task 1.11 fix-round live run, public video `kJQP7kiw5Fk` (signed out, headless Chrome for Testing) reached only 6 s of a 30 s window with Sieve on (15 s with an ad and no extension, 30 s with Sieve off afterwards). That is a possible breach of the anti-goal "YouTube must not feel janky". An Opus agent measured it.

## Method

Headless Chrome for Testing (chromium-1228) through playwright-core, launched as `apps/sieve/test/harness.mjs` does plus `--autoplay-policy=no-user-gesture-required`; one fresh temp profile per run; signed out; video `kJQP7kiw5Fk`; order A, B, C, D repeated; 40 s sampled every 500 ms from navigation start; main run: 24 runs (6 rounds x 4 conditions; 23 usable, one `goto` timeout), 18.4 minutes; then a capped follow-up of 25 more runs (A 9, B 8, D 8; 15 s windows): 49 runs in all, 48 usable. Sieve conditions waited for a settled worker first. No run met a consent page or a bot check. Scratch files (not in the repo): `/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/90b0c714-a63a-40cc-af79-924447502595/scratchpad/yt-measure/` (`measure.mjs`, `prep.mjs`, `analyze.mjs`, `followup.mjs`, per-run data `results.jsonl`, `followup.jsonl`, the three builds).

- A: no extension. B: Sieve on, byte-identical to HEAD 5f2cabd. C: stripping only (all five rulesets disabled in the manifest and the plan's `enableRulesets` forced to `[]`; verified `getEnabledRulesets() == []`; cosmetic CSS and scriptlets stay as in B and D). D: network rules only (the `yt-main.js` content script removed from the manifest; all five rulesets enabled; nothing strips). A read-only `JSON.parse`/`Response.json` probe was installed in all four conditions: ad fields were stripped in B and C (6/6 and 5/5) and present in A and D.

## Results (median [range]; runs ok / not ok: A 6/0, B 6/0, C 5/1, D 6/0)

| | A: no extension | B: Sieve on | C: stripping only | D: network rules only |
|---|---|---|---|---|
| Time to first frame, s | 3.7 [2.5-8.8] | 4.0 [2.8-7.0] | 3.9 [2.3-11.3] | 3.9 [2.3-13.3] |
| `currentTime` at 10 s | 6.2 [1.1-7.4] | 5.6 [2.5-7.2] | 5.8 [0-7.3] | 5.4 [0-7.3] |
| `currentTime` at 20 s | 16.2 [11.1-17.4] | 15.6 [6.1-17.2] | 15.8 [8.4-17.3] | 15.4 [5.5-17.3] |
| `currentTime` at 30 s | 26.2 [11.9-27.4] | 25.6 [9.6-26.9] | 25.8 [18.4-27.3] | 25.4 [5.5-27.3] |
| `waiting` / `stalled` events | 1 / 0 | 1 / 0 | 1 / 0 | 1 / 0 |
| Stall seconds | 0.5 [0.2-18.3] | 0.7 [0.1-17.0] | 0.8 [0.2-3.2] | 1.1 [0.3-3.8] |
| Dropped-frame ratio | 0 [0-0.059] | 0 [0-0.185] | 0 | 0 |
| Ad shown | 0/6 | 0/6 | 0/5 | 0/6 |
| Overlay or error seen | 0/6 | 0/6 | 0/5 | 0/6 |

Blocked requests in B and D (same set): `www.youtube.com/api/stats/qoe` (35 in B, 24 in D), `googleads.g.doubleclick.net/pagead/id` (12), and 6 each of `static.doubleclick.net/instream/ad_status.js`, `www.youtube.com/ptracking`, `www.youtube.com/pagead/viewthroughconversion`, `www.google.com/pagead/1p-user-list`, `www.google.com/pagead/lvz`, `www.google.com.pk/pagead/lvz`, `www.youtube.com/generate_204`. Nothing on `googlevideo.com`, and no `/youtubei/v1/player` call was ever blocked.

Unusual runs: round 6 (12:36-12:40 UTC) was a network outage (`ERR_INTERNET_DISCONNECTED`, `ERR_NETWORK_CHANGED`, `ERR_NAME_NOT_RESOLVED`) and set every condition's worst value; C round 4 timed out in `goto`; D round 3 self-paused at 5.5 s (player state 2, no overlay; no hook was installed then to see why). In the follow-up (with a `pause()` caller hook and an enforcement-element check) no pause call, no pause event and no enforcement element appeared in any of 25 runs.

## Reading

- Sieve does not hold back playback in these runs. With round 6 and D round 3 set aside, `currentTime` at 30 s had medians A 26.5, B 26.0, C 26.0, D 26.05; time to first frame 3.3 to 3.8 s; every difference is under 1 s and inside the others' ranges. Neither the stripping (C) nor the network rules (D) alone shows a cost. A real cost of 1 to 2 s could still hide in the 2.5 to 4.5 s spread of normal runs.
- The Task 1.11 "only 6 s" has two candidate explanations seen here, which the data cannot separate: a network drop like round 6, or a self-pause like D round 3 (`yt-live.mjs` reports `Math.round(max currentTime)`, so a pause at 5.5 s reads exactly "6 s"). The self-pause is a guess; it happened once in 48 usable runs, in D (network rules, no stripping).
- **YouTube served no ad in any of the 15 no-extension runs (6 main, 9 follow-up)** although every page response contained `adPlacements` (23/23 main, 25/25 follow-up). So these runs say nothing about the cost of skipping or removing an ad, and nothing about ad removal itself. A run with an ad needs a time or network where YouTube actually plays one.
- Limits: one video, signed out, headless, one network (requests went to google.com.pk), one 30 minute window; 5 to 8 usable runs per condition.

## What is still open

- Ad removal while an ad is actually served (owner checklist, signed in).
- What paused D round 3 (not reproduced).
- The live gate `playedTo > 5` in `apps/sieve/test/yt-live.mjs` is being changed to compare against the control.
