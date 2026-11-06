# SDD ledger — plan: docs/superpowers/plans/2026-11-06-sieve.md

Spec: docs/superpowers/specs/2026-11-06-sieve-design.md (reachable). Branch `sieve`, start commit 7caa5be.
Order: 0.1 → 0.5, 0.6 step 1 (checklist) then ask owner; 1.1 → 1.10 while waiting; 0.6 step 3 after the owner's file; then 1.11 → 1.13.

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|
| 0.1 → 0.2..0.5 | spike files, probe result shape | sequential edits of the same files; fine |
| 0.1 → 0.6 | spike.html "Run all" + "Save results" | 0.1 text only asks for results + Save; 0.6 checklist needs "Run all" driving the open YouTube tab. R1 |
| 0.1 → 1.11 | fixtures/player-response.json | fine (1.11 runs after 0.6) |
| 1.1 → 1.4 | brand `sieve` → `data-brand="sieve"` pages | fine |
| 1.2 → 1.5, 1.7, 1.9, 1.11 | Settings, validateSettings | fine |
| 1.3 → 1.4, 1.9 | compileFilters, CompiledList | fine |
| 1.4 ↔ 1.5 | BuildMeta written by build.mjs (1.4), typed in plan.ts (1.5) | build.mjs is JS, type lands later; `genericExcept` contents undefined. R2 |
| 1.4 ↔ 1.12 | LISTS.ai file `filters/ai-summaries.txt` | file is created in 1.12 but the 1.4 build reads it. R3 |
| 1.4 ↔ 1.7/1.9/1.10 | manifest keys popup/options/devtools | pages don't exist until those tasks. R4 |
| 1.4 ↔ 1.6 | scriptlets.js → SCRIPTLETS[name] in worker | how the worker loads it is unstated. R5 |
| 1.5 ↔ 1.6 | genericExcept + excludePatterns → registrations | `google.*`-style hosts can't be match patterns. R2 |
| 1.6 ↔ 1.7 (ai switch) | lists[f] → which cosmetic sets inject | 1.6 text doesn't say disabled features are skipped. R6 |
| 1.6 ↔ 1.8/1.9 | myCosmetic set in pageInjections | My filters' generic selectors have no registered CSS. R7 |
| 1.7 ↔ 1.10 | counts.ts forwards matches | fine |
| 1.9 (ai row) | "Ads · 21,345 rules" format | ai has 0 network rules (cosmetic only). R8 |
| self 0.1..0.5 | no tests (spike) | plan says measurements only; fine |
| self 1.2, 1.3, 1.5..1.8, 1.11 | tests vs interfaces | agree |
| self 1.3 | `'||[\nnot a filter at all ##'` must be errors | library may accept them; compileFilters must reject them itself if so |
| self 1.4 | e2e needs a control (unblocked hit) | 1.5 adds pause → hit; acceptable |

## Rulings

- Ruling R1: Task 0.1 builds spike.html with "Run all" (runs every strategy implemented so far against the active/most recent YouTube tab) and "Save results" (label from the probe's `ytcfg LOGGED_IN`: `signed-in`/`signed-out`); run.mjs drives that same button path — the owner checklist (0.6) must exercise exactly what we tested — cost if wrong: small spike rework.
- Ruling R2: `BuildMeta.features[f].genericExcept` is a list of hosts (keys of `unhide` ∪ `generichide` ∪ `elemhide` for that feature); blockingPlan converts them with `excludePatterns`. Hosts with a `*` label (`google.*`) cannot be match patterns: the build leaves them out of genericExcept and counts them as `dropped['wildcard-exception']` — cost if wrong: generic CSS still hides an unhidden element on a few google.* style sites.
- Ruling R3: Task 1.4 creates `apps/sieve/filters/ai-summaries.txt` as a valid empty list (Adblock header + title comment, no rules); Task 1.12 fills it — cost if wrong: none.
- Ruling R4: Task 1.4's manifest carries only keys whose files exist; 1.7 adds `action.default_popup`, 1.9 `options_page`, 1.10 `devtools_page` — avoids a manifest pointing at missing files — cost if wrong: none.
- Ruling R5: the 1.4 implementer chooses how the worker reaches the scriptlet functions (generated module imported by the bundle, or a module worker importing `scriptlets.js`); requirement: worker startup must not parse cosmetic maps eagerly — cost if wrong: 1.6 adjusts the import.
- Ruling R6: inject.ts (1.6) only uses cosmetic sets and scriptlets of features whose `lists[f]` is on — required by the 1.7 switches (AI summaries off by default) — cost if wrong: none.
- Ruling R7: for the My filters set (1.8), `excluded(i)` returns true so its generic selectors inject per page (it has no registered CSS) — cost if wrong: My filters' generic `##` lines would never apply.
- Ruling R8: the 1.9 Filter lists row for a list with 0 network rules shows its name only (no "· 0 rules") — no new BuildMeta field — cost if wrong: copy tweak.

## Progress
Task 0.1: dispatched (base 7caa5be, sonnet, agent ae04076544d9d6214)
Task 0.1: implementer DONE_WITH_CONCERNS (d1e28e9): S1 0 url / 0 cipher / 40 none, sabr true, max 2160; fixture from dQw4w9WgXcQ (adPlacements only); keeps one opaque ad-serving token. Review dispatched (sonnet).
Task 0.1: minor (deferred unless a fix round runs): Semgrep — postMessage targets '*' in probe-main.js:2 and probe-relay.js:21; use location.origin. Listeners already gate on e.source === window.
Task 0.1: review Needs fixes — I1 fixture keeps serializedSlotAdServingDataEntry token (denylist scrub); I2 loggedIn missing on error → mislabelled overwrite; I3 handoff overstates (muxed formats uncounted). Fix round 1 sent with I1-I3 + Semgrep '*' target. FIX_BASE d1e28e9.
Task 0.1: minor (deferred): owner path has no timeout if probe never answers (spike.js:44), pending never deleted (probe-relay.js:23)
Task 0.1: minor (deferred): results cleared before run is known to start (spike.js:43)
Task 0.1: minor (deferred): sw.js:9 no .catch on storage set; probe:undefined key if no strategy
Task 0.1: minor (deferred): run.mjs exits 0 when playability != OK (bot check reads as 0 formats)
Task 0.1: minor (deferred): status text asserts "Saved Downloads/..." and ignores interrupted downloads
Task 0.1: minor (deferred): prefer getPlayerResponse() over ytInitialPlayerResponse for same-video revisit
Task 0.1: fix round 1 implementer DONE (ede98e7); re-review dispatched
Task 0.1: fix round 1/5 (4 addressed, 0 open; commits d1e28e9..ede98e7)
Task 0.1: minor (deferred): ytcfg.get('LOGGED_IN') outside try (probe-main.js:140) — a throw would hang Run all
Task 0.1: minor (deferred): scrub/guard blind spot — array string elements lose parent key; opaque tokens under unmatched keys (e.g. ei) pass
Task 0.1: complete (commits 7caa5be..ede98e7, review clean after round 1)
Task 0.2: dispatched (base dc6a09e, sonnet, agent ade8ba44fa384703a); carries 0.1 deferred minor (LOGGED_IN read inside try)
Task 0.2: implementer DONE_WITH_CONCERNS (e1f8651): yt-dlp 12ac9ac; visionos = plain URLs up to 2160p + audio (sig present, no n); tv family flaky UNPLAYABLE; web_embedded unavailable.
- Ruling: S2 result keys use yt-dlp client names (probe:S2:visionos …) instead of clientName — three tv clients share TVHTML5, so clientName keys would collide; real clientName stays in each result's `client` — cost if wrong: none (spike only).
Task 0.2: review Approved, 0 Critical/Important. Minors: m1 error text may dump visitorData (probe-main.js:116); m2 unguarded player-script fetch for STS fails all clients (:97); m3 no fetch timeout (:98); m4 handoff overstates tv/UA (sieve.md:138, :297); m5 tv confounds (shared VISITOR_DATA, order) not recorded; m6 UA strings paraphrased in table; m7 "no pot/n" generalised from 3 URLs; m8 HLS not probed.
Task 0.2: complete (commits dc6a09e..e1f8651, review clean). m1-m3, m4, m7, m8 carried into 0.3 dispatch; m5, m6 deferred.
Task 0.3: dispatched (base e1f8651, opus, agent a67a7425248a963ed)
Task 0.3: implementer died on API ENOTFOUND (no changes made); resumed same agent
Task 0.3: implementer DONE_WITH_CONCERNS (09bb187): S1 muxed cipher pass 5/5 (sig+n solved, 206); tv cipher not reached in extension (node one-off: solved+unsolved both 403); n pass; ejs 0.8.0 vendored (controller verified SHA-256 = release digests). Deviation: solver in blob worker inside sandbox page, custom sandbox CSP. Safety classifier was unavailable for this run; controller checked footprint (spike + handoff only). Review dispatched (sonnet, vendor excluded).
Task 0.3: review Needs fixes — I1 sampled Range check with any-pass. Fix round 1 sent: I1 + m2 ('*' to parent), m6 (scanned counts), m9 (streams → storage.session), handoff wording (tv, jsc time, n row). FIX_BASE 09bb187.
Task 0.3: minor (deferred): spike.js:84 signatureCipher format without inner url silently dropped
Task 0.3: minor (deferred): solver.js:6 reason() passes ejs "no solutions" text (≤160 chars) into Save
Task 0.3: minor (deferred): solver.js:37 worker message relayed verbatim ({id,...out}) — trust boundary, negligible
Task 0.3: note: worker location is blob:null; a future player reading location at solve time could break
Task 0.3: fix round 1 implementer DONE_WITH_CONCERNS (11e6e54): every URL checked, all items fixed; added player-fetch retry + longer run.mjs waits; network very slow (8 launch failures). Re-review dispatched.
- Ruling R9 (Task 0.4): full download = the 1080p video stream + best audio; the top height (2160p) gets a bounded check (first 100 MiB as 10 sequential 10 MiB ranges for speed, plus the last 1 MiB range to prove the end is reachable), and the run records a link-speed baseline so a slow Mac link is not read as YouTube throttling — this Mac's network is slow and a full 4K60 stream is GBs — cost if wrong: a failure that only appears deep inside a 2160p stream is missed until phase 5.
Task 0.3: fix round 1/5 (5 addressed, 0 open; commits 09bb187..11e6e54)
Task 0.3: minor (deferred): sieve.md:184 "seventh run" ordinal wrong (was sixth); :138 "1 of 17" vs 9 S3 runs use different denominators
Task 0.3: minor (deferred): spike.js:175 no longer clears streams: from storage.local (only matters for a profile that ran 09bb187)
Task 0.3: minor (carry to 0.4): player body read (res.text()) not retried; sw.js:10 no .catch on set → relay waits until SW dies
Task 0.3: complete (commits e1f8651..11e6e54, review clean after round 1)
Task 0.4: dispatched (base af6942c, sonnet, agent a12c7cd2680b613f4); carries R9 + 0.3 minors (body-read retry, sw.js .catch)
Task 0.4: implementer DONE_WITH_CONCERNS (e46d867): visionos 1080p itag 299 Q1 pass, Q2 FAIL 0.61 MB/s 0.7x; audio 251 pass 14.5x; 2160p partial 0.28x; baseline 5.0 MB/s → googlevideo near real time, cause undetermined.
- Ruling R10 (Task 0.5): add a googlevideo split measurement — the 1080p stream's first 60 MiB as 6 parallel 10 MiB ranges vs 6 sequential — to separate a per-request cap (split helps) from a per-client/IP cap (it doesn't); Q2's answer depends on it — cost if wrong: ~120 MB extra traffic.
Task 0.4: review Needs fixes — I1 retry stall inside speed timing. Fix round 1 sent: I1 + m5, m6, m8, m11 (pause video), handoff wording, one rerun. FIX_BASE e46d867.
Task 0.4: minor (deferred): fixed 60 s timeout per request regardless of size (spike.js:190); missing-audio placeholder prints NaN (spike.js:320, run.mjs:57); run.mjs:53 timeout path prints reasons before STREAM_LEAK guard; single baseline sample
Task 0.4: fix round 1 implementer DONE_WITH_CONCERNS (94ebba9): rerun on dQw4w9WgXcQ (aqz-KE-bpKQ now bot-checked from this IP for every client); 1080p itag 137 0.49 MB/s 0.91x Q2 fail; baseline 2.3 MB/s; run.mjs wait → stall detector. Re-review dispatched.
Task 0.4: fix round 1/5 (6 addressed, 0 open; commits e46d867..94ebba9)
Task 0.4: minor (deferred): video pause checked once only (run.mjs:38-39); handoff:208 mislabels a dQw4 run under aqz heading; run.mjs:49 comment on 30 min cap; baseline()/rangeCheck map only TimeoutError to "timed out"
Task 0.4: complete (commits af6942c..94ebba9, review clean after round 1)
- Ruling R11 (Task 0.5): the generic-server Q4 measurement (≈1.2 GB) runs from its own "Speed test" button, not "Run all" — the owner's 0.6 run is on this same Mac and network, so repeating it adds GBs and nothing new; the googlevideo split (R10) IS in "Run all" since signed-in may differ — cost if wrong: the owner's file lacks generic Q4 numbers (we have them from the automated run).
Task 0.5: dispatched (base 94ebba9, sonnet, agent a5cfa3393c6527372) with R10 + R11
- Ruling R12: owner said "until then you can work on something else" while 0.5 runs long measurements → Task 1.1 runs in parallel with 0.5 in the same worktree (disjoint files: packages/ui, apps/sieve/assets, apps/sieve/scripts, AGENTS.md vs apps/sieve/spike, docs/handoffs); both agents told to stage only their own paths — cost if wrong: one commit sweeps the other's files (fixable with a follow-up commit).
Task 1.1: dispatched (base 94ebba9, sonnet, agent ae3c4b50134586198) in parallel with 0.5
Task 1.1: implementer DONE (93b9b99): ui tests 19/19 incl sieve WCAG, no accent change; icon ok at 128, 16 px is ring+dots (controller viewed, acceptable). Review dispatched.
Task 1.1: review Approved, 0 Critical/Important.
Task 1.1: minor (deferred): web-css.test.ts:12 hard-codes 5 brands (already missing deputy, strongroom; now sieve) — iterate Object.keys(brands); icon mesh stroke clipped to ~1 unit (icon.svg:4); render-icon.mjs:96 hard-codes chromium-1228
Task 1.1: complete (commits 94ebba9..93b9b99, review clean)
Task 1.2: dispatched (base 93b9b99, sonnet, agent a381a3968330d0b45) in parallel with 0.5
Task 1.2: implementer DONE (3b1c566): 17/17, root pnpm test exit 0; IPv6 hosts not allowlistable (shortcut); denyNotifications default true; version!==1 resets. Review dispatched.
Task 1.2: review Needs fixes — I1 missing version resets all. Fix round 1 sent with I1 + m2-m6 + m7a (trailing dot). FIX_BASE 3b1c566.
Task 1.2: downstream note for 1.7/1.9: IPv6 tabs can't be allowlisted; 1.9 must strip ports and punycode typed hosts (localhost:3000, münchen.de) before validateSettings and show its error text.
Task 0.5: implementer DONE_WITH_CONCERNS (ad3a2f6, parent 3b1c566): http/1.1 ping.online.net ratio 1.05; h2 OVH split 429; kernel.org h2 ratio 0.83; R10 googlevideo http/1.1 seq 1.01 vs par 1.24 MB/s (1.23) → not a per-request cap; link 0.2-1.2 MB/s, ratios within noise. Review dispatched.
Task 1.2: fix round 1 implementer DONE (9ef2419): 26/26; RED 6/26 before. Re-review dispatched.
Task 1.2: fix round 1/5 (7 addressed, 0 open; commits ad3a2f6..9ef2419)
Task 1.2: minor (deferred): underscore hosts (my_app.local) rejected by LABEL — Chrome allows them in tab hostnames
Task 1.2: complete (commits 93b9b99..9ef2419 excluding ad3a2f6 (0.5), review clean after round 1)
Task 1.3: dispatched (base 9ef2419, opus, agent a04a9201775bf527f); browser-safe compile, trailing-dot strip, errors-vs-dropped policy, EasyList timing
Task 0.5: review Needs fixes — I1 Q4 reading over-claims (asymmetric drop rules), I2 R10 reading over-claims. Fix round 1 sent: I1, I2 doc + m4-m6 doc + m7, m8 code; no rerun. FIX_BASE ad3a2f6.
Task 0.5: minor (deferred): a rejected plain download() aborts the whole speed test; s.error set after save (spike.js:347, :390, :403); Speed test results can't be saved by button and Run all deletes probe:Q4; committed 3-server sequence never run end to end; Q4 numbers predate no-store (likely not cache-served)
Task 0.5: fix round 1 implementer DONE_WITH_CONCERNS (4a4a89c, parent 9ef2419): readings inconclusive, n shown, shared 10 min limit, ticker shows bytes. Re-review dispatched.
Task 0.5: fix round 1/5 (8 addressed, 0 open; commits 9ef2419..4a4a89c)
Task 0.5: minor (deferred): sieve.md:213 run range "160 to 560 s" should be ~100 to 560 s; "it is not one connection" wording; run.mjs 270 s no-byte abort < 600 s RUN_LIMIT_MS (symmetric)
Task 0.5: complete (commits ad3a2f6 + 4a4a89c, review clean after round 1)
Task 0.6: step 1 (checklist) dispatched (haiku); steps 2-4 wait for the owner
- Ruling R13: Task 0.6 step 1 (14-line owner checklist) reviewed by the controller directly instead of a reviewer subagent — doc only, controller relays it to the owner anyway; checked labels/status text/name against spike.html, spike.js:513, manifest — cost if wrong: the owner hits a checklist mistake.
Task 0.6: step 1 complete (6ace2b3). Owner asked to run the checklist; steps 2-4 pending.
Task 1.3: implementer DONE (597fc4f): 46/46, root 531 pass; EasyList 78,415 lines → 50,215 rules in 0.34 s, 14 errors (unsupported regex). Added src/node-regex.ts + @adguard/re2-wasm 1.2.0 (Node-only regex validation, reaches dnr-converter internal file). Generic exceptions keyed '*'. $document exceptions don't disable cosmetics. trusted-* scriptlets accepted from any list. Review dispatched (opus).
Task 1.3: review Needs fixes — I1 $document doesn't disable cosmetics/scriptlets; I2 trusted-* scriptlets from any list. Fix round 1 sent: I1, I2 + m3, m4, m5, m6 (CSS-breaking selectors), m7, m9 (lone $third-party). FIX_BASE 597fc4f.
Task 1.3: minor (deferred to 1.9): error reasons are raw parser text — map common classes to plain words in the settings page
Task 1.3: minor (deferred): converter throw after partial push keeps rules and marks every line errored; NON_ASCII check also catches regexes; name-only scriptlet exceptions (#@%#//scriptlet('name')) may be exact-key only
Task 1.3: carry to 1.4: build must await checkRegexesWithRe2(); subtract unhide['*'] from generic CSS; licences into apps/sieve/README.md. Carry to 1.5/1.6: unhide['*'] and scriptletExcept['*'].
Task 1.3: fix round 1 implementer DONE (90e624d): 52/52; EasyList unchanged 50,215 rules; m6 checks outside quotes only. Re-review dispatched.
Task 1.3: fix round 1/5 (8 addressed, 0 open; commits 597fc4f..90e624d)
Task 1.3: minor (carry to 1.4): backslash escapes outside quotes pass the CSS-breaking check (compile.ts:90-91, 230) — tested one-line fix from re-review; hide-kind exception with an extra modifier also becomes a network allow rule (compile.ts:197-198) — make it cosmetic-only unless document/doc
Task 1.3: minor (deferred): $document exemption applied before parse validation (compile.ts:199-207); domain=/from= ignored with non-empty pattern; duplicate host entries; one-char patterns (/$script) still near-total blocks; uBO ##+js(trusted-…) resolves unknown even with trusted
Task 1.3: carry to 1.9: My filters must call compileFilters with trusted: true (plan text doesn't say so)
Task 1.3: complete (commits b42a20c..90e624d, review clean after round 1)
Task 1.4: dispatched (base 90e624d, opus, agent aa6b7f779d2d5b96e) with R2-R5, carried 1.3 minors (escape, hide-kind allow), rule-budget stop condition
Task 1.4: implementer DONE_WITH_CONCERNS (bed15d6 core fixes 54/54; 10b4f5b app): all 5 rulesets enabled in fresh profile, no warning; ads 50,225 trackers 56,422 distraction 2,037 cookies 2,111 antiadblock 4,673 ai 0 = 115,468; e2e 10/10; root test 539 pass, typecheck 0. R5: scriptlets.js ES module external, module worker. Added @adguard/scriptlets app dep; esbuild: false in pnpm-workspace allowBuilds. 1,581 ABP snippet lines lost (no AdGuard match).
- Ruling R14: wildcard-TLD exception hosts (`www.google.*`, `music.amazon.*`) are expanded at build time into concrete hosts over a fixed TLD list (every Google ccTLD domain for google.*, plus a common-TLD list — com, net, org, co.uk, de, fr, it, es, nl, ca, com.au, co.in, com.pk, pk, co.jp, com.br, ru, pl, se, ch, at, be, com.mx, co.za, ie, nz/co.nz — for the rest) and fed into genericExcept, with a shortcut comment naming the limit — R2's "drop them" would leave the generic ad CSS hiding real content on Google search, a site-breaking anti-goal hit — cost if wrong: a larger excludeMatches list (a few thousand patterns) and missed rare TLDs.
Task 1.4: review dispatched (opus); R14 to be applied in the fix round regardless
Task 1.4: review Approved (0 Critical/Important). Fix round 1 sent anyway for R14 (controller-confirmed gap) + m1 host validation, m7 genericExcept intersect, m2 min Chrome 128, m3, m4, m5, m6. FIX_BASE 10b4f5b.
- Ruling R15: minimum_chrome_version raised from the plan's 127 to 128 — EasyList anti-cv emits responseHeaders conditions (Chrome 128+), and on 127 such a rule would block every script on its site; the owner runs current Chrome — cost if wrong: none practical.
Task 1.4: minor (deferred to final review): build drops 92 redirect/rewrite rules (e.g. blank-js stubs) while sibling block rules stay — sieve-core 1.3 decision, may break the few sites those stubs protect; abp-filters-anti-cv licence unverified offline; tools/store-api vite build not re-checked after lockfile change; status() picks last chrome-extension version (harness.mjs:83)
Task 1.4: fix round 1 implementer DONE (55d7712): genericExcept ads 874 (213 expanded), distraction 177, cookies 803, antiadblock 24; e2e 10/10; scriptletFunction exported from sieve-core, app dep dropped; expansion untested. Re-review dispatched.
Task 1.4: fix round 1/5 (8 addressed, 0 open; commits 10b4f5b..55d7712); google list verified against google.com/supported_domains (187)
Task 1.4: minor (carry to 1.5): expandWildcard (build.mjs:108-112) needs an assert-based self-check; README:3 says only antiadblock needs Chrome 128 (ads 3, trackers 2 too)
Task 1.4: minor (deferred): plan doc + spike manifest still say minimum Chrome 127
Task 1.4: complete (commits 90e624d..55d7712, review clean after round 1)
Task 1.5: dispatched (base 55d7712, opus, agent ade0e682ffea765ec); carries 1.4 minors (expandWildcard self-check, README wording)
Task 1.5: implementer DONE (bab5df7): sieve-core 73/73, e2e 32/32 (x2), root 558 pass + typecheck 17 pkgs. Chrome probes: getRegisteredContentScripts sorts/dedupes excludeMatches; updateContentScripts defaults persistAcrossSessions false; ports refused in match patterns (page patterns drop port); worker restart fires no new serviceworker event (old handle reaches new instance) — my carried note was wrong.
- Ruling R16: accept updateContentScripts in place of unregister+register for changed registrations — no window where a page loads without the generic CSS (anti-goal 2) — cost if wrong: none seen; e2e covers the diff.
Task 1.5: carry to 1.9: myRules is a plain DnrRule[] — store sources under a separate key (e.g. myRuleSources); the check-by-applying must use the unpaused plan's dynamic rules.
Task 1.5: review dispatched (opus)
Task 1.5: review Needs fixes — I1 allow rules refused together with a bad myRule. Fix round 1 sent: I1 + m1, m2, m3, m6, m8. FIX_BASE bab5df7.
Task 1.5: carry to 1.6/1.8/1.9: applyBlocking wipes any registration or dynamic rule not in blockingPlan — later work must route through the plan (blocking.ts:25,34). Carry to 1.6: cross-origin iframes on an allowlisted page still get registered generic CSS + notify-deny (excludeMatches matches the frame's own URL) — record as a limit or add a top-origin check.
Task 1.5: minor (deferred): notify-deny patches detectable (toString/name/length); Notification.permission still reports real state
Task 1.5: fix round 1 implementer DONE (e9dd4b6, parent 33dd88e handoff-only): 74/74, e2e 34/34, regression-checked. Re-review dispatched.
Task 1.5: fix round 1/5 (6 addressed, 0 open; commits 33dd88e..e9dd4b6)
Task 1.5: minor (deferred): page entries with trailing-dot host silently dropped (settings.ts:85); both-fail case stores only the retry's message (blocking.ts:55-58); a refused page allow rule still blocks My filters changes in the same apply
Task 1.5: complete (commits 55d7712..e9dd4b6 excl. 33dd88e handoff, review clean after round 1)
Task 1.6: dispatched (base e9dd4b6, opus, agent a9df5a686b283f29a); carries R6, '*' keys, lazy generic CSS read, cross-origin iframe limit to README
Task 1.6: implementer DONE (1f80fda): core 85/85, e2e 46/46 (12 new, mutation-checked), root 570 pass + typecheck. Scriptlet call shape is (source, args) not [source,...args] — e2e can't distinguish (1-arg scriptlet). Inject by documentIds; top URL map keyed by documentId + getFrame fallback. elemhide host loses that list's scriptlets; unhide/scriptletExcept cross-list; first-page-after-start scriptlets may be late (~20 ms parse of ~4 MB). Review dispatched (opus).
Task 1.6: review Needs fixes — I1 allowlisted frame inside non-allowlisted page still filtered per-page. Scriptlet shape (source,args) verified by reviewer against scriptlets.invoke + node probe (6,065 multi-arg calls depend on it).
- Ruling R17: widen the brief's "top frame URL" rule — inject.ts also skips a frame whose own URL is allowlisted (isAllowed(d.url)), matching the DNR allow rule and registered-CSS exclusions that already key on the frame's own URL; the per-site switch must turn off all blocking for that site wherever it is embedded — cost if wrong: embeds of an allowlisted site are never filtered even on pages where the owner might have wanted them filtered.
Task 1.6: fix round 1 sent: I1 + m2, m3, m4, m5, m6. FIX_BASE 1f80fda.
Task 1.6: carry to 1.8: cross-list unhide only reaches another list's generic selectors on hosts already in that list's genericExcept (build-time per list) — My filters `host#@#.sel` needs runtime genericExcept additions or per-page generic injection; $document exception drops every list's scriptlets but only its own list's CSS (inconsistent, errs toward blocking less). Prerender / BFCache untested.
