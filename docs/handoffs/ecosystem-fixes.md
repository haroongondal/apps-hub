# Ecosystem fixes (2026-11-25): ledger, branch and worktree classification

Wave 2 of the ecosystem work: close the gaps the wave 1 audits and reviews left (ecosystem.md "Wave 4c" and the owner's 2026-11-25 prompt). Orchestrated by the coordinator session; one worktree and branch per stream. This file is the handoff for the whole wave. The coordinator keeps "Session log" and "Current state" up to date; the H1/H2/H4 facts below were collected by the docs-research agent (`docsa`) on 2026-11-25 against origin/main `964e19ab` and are read-only findings: nothing was deleted, pushed or removed.

## Resume prompt

(Dated 2026-11-25. Paste into a new chat if the coordinator session ends.)

You are the coordinator of the ecosystem fixes wave in /Users/outsentia/Documents/apps-hub. Never switch branches or edit in that main checkout (it holds other sessions' work). Read docs/handoffs/ecosystem-fixes.md completely first, then the stream reports in /Users/outsentia/Documents/apps-hub-wt/fix-work/reports/ and the briefs `COMMON.md` and `brief-*.md` in the same folder. Trust the verified facts below and do not redo that work: the test baseline, the branch classification (H1) and the worktree classification (H2) are done. Follow the same contract: each stream works only in `/Users/outsentia/Documents/apps-hub-wt/fix-<stream>` on branch `fix/<stream>`; commit by pathspec with no Co-Authored-By and no "Generated with" line; NEVER push, open a PR, merge, release or deploy, delete a remote branch, worktree or tag without the owner's go; phone checks stay "not run" and go on the phone list; install through the Store only; run tests as `pnpm -r --no-bail --workspace-concurrency=2 test`. Then continue from "Current state and exact next step" below.

## Goal and fixed constraints

Goal: fix and finish the items the first ecosystem wave left open, with no new features and no new apps: release safety (A1), AI hub apiVersion 3 and Deputy on the hub (C1, C2), missing tests for Halo, Deputy, Inflow, HomeNet and TunnelWall (B), Strongroom additive pieces (D), offline OCR in Arabic and Urdu (E), Design Editor brand kit from an image (F), then a documentation pass, the doctor run and the phone-checks list (G, H3), plus the housekeeping facts here (H1 remote branches, H2 local worktrees, H4 the stale main checkout).

Fixed constraints (full list in `fix-work/COMMON.md`, every agent has it):

- Git: commit on `fix/*` branches only; never push, PR, merge, release, deploy, or delete a remote branch, worktree or tag. No Co-Authored-By and no "Generated with" line (owner memory `no-claude-attribution`).
- Phone: real phone only; install through the Store only; no stream touches the phone in this run, every phone check is "not run" and listed.
- Never run Electron e2e (design-editor, pdf-editor-desktop).
- AI providers: no OpenAI or Anthropic; Groq (gpt-oss-120b, Whisper) and Gemini only, through AI hub or the app's own fallback key.
- HomeNet: no ARP or `ip neigh`; TCP RST means host alive; bounded sweeps (Semaphore(64), at most a /24); multicast lock around mDNS and SSDP; FOSS only.
- Never wipe user data (vault, clipboard history, Inflow archive).
- UI: `@apps-hub/ui` only, plain words, sentence case.
- TypeScript: erasable only, `.ts` imports, every new `*.test.ts` added to its package's `test` script.
- Native contract changes touch the TS contract, the adapter, Kotlin and (where the app has iOS) Swift; check APIs against compileSdk 36.
- New dependencies: licence audit and the `upgrading-dependencies` skill.
- Privacy: any new flow that sends personal data off the phone or to another app is opt-in, written into that app's AGENTS.md paragraph, and reviewed by security-engineer. READER RULE and SENDER RULE in ecosystem.md stay true.
- Disk is tight (about 20 GiB): delete a worktree's Gradle output when its stream finishes; never `gradlew --stop`; at most 3 Gradle builds at once across agents (locks in `fix-work/locks`, rules in `fix-work/GRADLE.md`).

## Decisions made (with why)

| # | Decision | Why |
|---|---|---|
| E1 | A1: `pnpm release <app> --rollback` prints the plan and stops; it builds and publishes only with `--yes`. (my call) | Today it publishes unless `--dry-run`, so a mistyped rollback ships. |
| E2 | C: the hub's per-call log stays counts plus error kind only; no prompt, reply or key text. (my call) | Keeps the "hub holds the keys, logs nothing personal" promise; failure detail is the shape of the reply, not its content (0.1.4, #109). |
| E3 | Worktrees at `/Users/outsentia/Documents/apps-hub-wt/fix-<stream>`, branch `fix/<stream>`, all cut from origin/main `964e19ab`. | One checkout per stream; the main checkout holds other sessions' uncommitted work. |
| E4 | Test runs use `pnpm -r --no-bail --workspace-concurrency=2 test`. | Plain `pnpm test` at default concurrency dies of load on this Mac (library-core and pdf-editor-mobile timing flakes, then the bail kills the rest). |
| E5 | H1 and H2 only classify and write commands; the owner approves any deletion. | Brief rule: deleting branches and worktrees is the owner's call. |
| E6 | A remote branch counts as "merged by squash" only when its PR is MERGED **and** the branch tip equals the PR's head commit (nothing was added after the PR was cut), or when file-by-file comparison shows its content on main. (my call) | `git diff origin/main...<b>` is never empty for these branches because main moved on after the merge; tip = PR head is the stronger proof. |
| E7 | The pruned fetch shows 42 unmerged remote branches, not the ~49 in the brief. | `git fetch origin --prune` removed branches already deleted on GitHub (`ai-hub`, `fix/text-ocr-null-bounds`, `nexus-cv-via-ai-hub`, `nexus-cv`, `nexus-place-reminders`, `release-upload-retries`, `strongroom-google-capture`, and others). |

## Evidence already verified (do not re-derive)

- Baseline on origin/main `964e19ab` (AI hub 0.1.5, #111), taken by the coordinator before any stream started: `pnpm -r --no-bail --workspace-concurrency=2 test` exit 0, per-package counts in `/Users/outsentia/Documents/apps-hub-wt/fix-work/baseline-summary.txt` (33 lines, every package `fail=0`; for example `packages/core` 368, `packages/sieve-core` 420, `apps/pdf-editor-mobile` 223, `apps/inflow` 149, `apps/open_tunnel_vpn` 155); typecheck exit 0 with 0 `error TS` (`fix-work/baseline-typecheck.log`, 51 of 52 workspace projects in scope). Full log: `fix-work/baseline-test.log`.
- Known flakes on main: pdf-editor-mobile "decodes in linear time", library-core "answers in under 300 ms" (fail under load, pass alone); Design Editor `CleanupTest` is load-sensitive.
- Remote state after `git fetch origin --prune` (2026-11-25): 63 remote heads including main; 20 are plain ancestors of origin/main, 42 are not. Of the 42: 37 are merged work (class a), 4 hold real unmerged work (class b), 1 is superseded (class c). 112 PRs exist (`gh pr list --state all`).
- The two open PRs on main are #110 (`fix/inflow-receipt-dupes`) and #112 (`inflow/ai-results-cleanup`), both Inflow; their branches and worktrees are live.
- Of PRs #74 to #112 only #90 (closed unmerged, replaced by #91) and the two open ones (#110, #112) are not merged; the ecosystem wave PRs #75 to #87 (`eco/*`) are merged and their branches are ancestors of origin/main.
- No worktree directory is missing: `git worktree prune --dry-run -v` printed nothing, so `git worktree prune` had nothing to do and was not run.
- `lsof -d cwd` shows live processes only in `apps-hub` (main, 45 process working directories there) and in `fix-strongroom`, `fix-halo`, `fix-tunnelwall`. `coord status` listed three edit claims, all labelled "Ecosystem wave fix and finish", on files in `fix-halo` and `fix-homenet`; no device claim.
- ecosystem.md "Reuse table" and this recon agree: `tunnelwall-firewall` is on main as #14 (a superset), `photo-search` only has handoff doc commit `5a53d05a` unmerged.

## H1. Remote branches not merged into origin/main (42)

Counts: class a (merged by squash) **37**, class b (real unmerged work) **4**, class c (abandoned or superseded) **1**.

How to read the evidence: "Ahead" is `git rev-list --count origin/main..<b>`. "`git cherry` N/M" is M commits compared by patch id with main, N of them not found: for a squashed multi-commit PR N stays high even though the whole PR is on main, so it is not proof on its own. "tip = PR head" means the branch tip sha equals the PR's `headRefOid`, so the squash commit contained everything the branch has. The merge commits were checked to be ancestors of origin/main. Sorted oldest first.

| Branch | Last commit | Ahead | Class | Evidence | Note |
|---|---|---|---|---|---|
| `tunnelwall-firewall` | 2026-11-02 | 32 | a | `git cherry` 32/32; No PR of its own. Content landed as #14 (`firewall-release`, one squash commit 5d2de26f): 41 of the 53 files it touched are byte-identical on main, 12 differ and main holds the later superset (privateDns, data-use period picker). Same finding as the Reuse table in ecosystem.md | TunnelWall firewall dev branch (32 commits, Nov 1-2) |
| `design-canvas-perf` | 2026-11-04 | 1 | a | `git cherry` 0/1; PR #19 merged 2026-11-04 as ec23cbd1, tip = PR head | Design Editor mobile canvas: fix the freeze on zoom, pinch and pan |
| `design-media-phase-3` | 2026-11-04 | 2 | a | `git cherry` 2/2; PR #18 merged 2026-11-04 as 70517614, tip = PR head | Design Editor: the engine and the phone-side Design Editor (Phase 3) |
| `model-host` | 2026-11-06 | 1 | b | `git cherry` 1/1; PR #27 CLOSED unmerged. Holds `tools/model-bench`, the design spec, Phase 0 plan and handoff; none of those paths exist on main. Owner decision A/B/C still unanswered (see H4) | Model Host Phase 0: on-device LLM benchmark (tools/model-bench, spec, plan, handoff) |
| `security-fixes` | 2026-11-06 | 9 | a | `git cherry` 9/9; PR #21 merged 2026-11-06 as 1f91a6f1, tip = PR head | Security fixes: TunnelWall relay trust, Deputy injection gate, hardening across the apps |
| `strongroom-export` | 2026-11-06 | 1 | a | `git cherry` 0/1; PR #26 merged 2026-11-06 as 1b0035e8, tip = PR head | Strongroom 0.3.0: export all, delete one import, delete all |
| `strongroom-sync` | 2026-11-06 | 49 | a | `git cherry` 48/48; PR #22 merged 2026-11-06 as 2d446dd5, tip = PR head | Strongroom 0.2.0: Chrome extension and sync through your own vault server |
| `strongroom-sync-followup` | 2026-11-06 | 4 | a | `git cherry` 4/4; PR #25 merged 2026-11-06 as 8003e43d, tip = PR head | Strongroom 0.2.1: card fill on Chrome checkout pages |
| `strongroom-mobile-email-recovery` | 2026-11-11 | 33 | a | `git cherry` 33/33; PR #30 merged 2026-11-11 as f6187963, tip = PR head | Strongroom: opt-in email recovery on the phone |
| `inflow/stage-4b` | 2026-11-16 | 84 | a | `git cherry` 83/83; PR #35 merged 2026-11-16 as d1b61eae, tip = PR head | Inflow: capture, SMS and money, Gmail, AI, WhatsApp media (stages 1-4b) [skip ci] |
| `extension-email-login` | 2026-11-17 | 20 | b | `git cherry` 20/20; PR #36 merged at 2804274b; 2 later commits (e0a7c655, 7f586732) are NOT in main: the email sign-in walk in `apps/strongroom-extension/test/e2e.mjs` (+56 lines, 91/91 PASS then; main has no such walk) and `docs/handoffs/email-login.md` facts (migration 0003 applied to live D1, Worker version c3685565 deployed from this branch 2026-11-17, mail destination still to verify). The branch e2e.mjs is older than main's, so port the walk by hand | Strongroom: email sign-in e2e walk and deploy notes |
| `photo-search` | 2026-11-17 | 27 | a | `git cherry` 26/26; PR #38 merged 2026-11-16 as 4247eedf, tip = PR head | Find a photo: on-device photo search in Design Editor |
| `photo-search-floor` | 2026-11-17 | 4 | a | `git cherry` 4/4; PR #40 merged 2026-11-17 as 45df9751, tip = PR head | Find a photo: short searches find matches again |
| `autopilot` | 2026-11-18 | 2 | c | `git cherry` 2/2; PR #46 CLOSED. Plan file is identical on main; spec and handoff exist on main in later revisions (stage 1 shipped as #52). Nothing unique left | Autopilot design and stage 1 plan (older copies) |
| `strongroom-passes` | 2026-11-18 | 28 | a | `git cherry` 26/26; PR #48 merged 2026-11-18 as 3613f291, tip = PR head | Strongroom: passes (barcode and NFC-tag cards) |
| `design-editor-groq` | 2026-11-19 | 1 | a | `git cherry` 0/1; PR #53 merged 2026-11-18 as be92890c, tip = PR head | Design with AI: Groq instead of Anthropic |
| `fix/lockfile-halo` | 2026-11-19 | 1 | a | `git cherry` 1/1; No PR. Its one change (Halo importer loses autopilot-contract, Inflow importer gains it) is already in origin/main pnpm-lock.yaml | Lockfile regenerate after Halo 0.6.0 |
| `homenet-toolbox` | 2026-11-19 | 51 | a | `git cherry` 50/50; PR #47 merged 2026-11-18 as e5264f05, tip = PR head | HomeNet: router dashboard, device remotes, who's home (draft) |
| `image-tools` | 2026-11-19 | 135 | a | `git cherry` 129/129; PR #50 merged 2026-11-18 as 354af6d9, tip = PR head | feat(design-editor): quick edits, gallery clean-up and ONNX telemetry removal |
| `nexus-gemini-groq` | 2026-11-19 | 1 | a | `git cherry` 0/1; PR #54 merged 2026-11-18 as baa0a1be, tip = PR head | Nexus: Gemini and Groq instead of OpenAI |
| `inflow/receipts` | 2026-11-20 | 1 | a | `git cherry` 0/1; PR #61 merged 2026-11-19 as cff47c0a, tip = PR head | Inflow: find a receipt in the gallery and attach it to a transaction [skip ci] |
| `multi-key-ai` | 2026-11-20 | 4 | a | `git cherry` 3/3; PR #57 merged 2026-11-19 as ed1515ae, tip = PR head | Several AI keys with fallback in Design Editor, Inflow and Nexus; Gemini in Design Editor |
| `nexus-keep-out` | 2026-11-20 | 1 | a | `git cherry` 0/1; PR #62 merged 2026-11-20 as c3b6a309, tip = PR head | Nexus: keep documents out of the knowledge base [skip ci] |
| `nexus-keep-out-fix` | 2026-11-20 | 1 | a | `git cherry` 0/1; PR #63 merged 2026-11-23 as 68006565, tip = PR head | Nexus: stop AI calls for an item excluded mid-stage [skip ci] |
| `ai-hub-store` | 2026-11-23 | 1 | a | `git cherry` 0/1; PR #71 merged 2026-11-23 as 1ba92561, tip = PR head | Store: know AI hub, and register it for release |
| `ai-hub-ui-fixes` | 2026-11-23 | 2 | a | `git cherry` 0/2; PR #70 merged; its second commit (5c21b5ae) is a copy of #71 (ai-hub-store), `git cherry` 0 of 2 unmerged | AI hub: plain error text, switch alignment, dialog buttons |
| `ai-hub-aq-keys` | 2026-11-24 | 1 | a | `git cherry` 0/1; PR #73 merged 2026-11-24 as 0bcfba05, tip = PR head | AI hub 0.1.1: accept Gemini AQ. keys |
| `ci-worklets-fix` | 2026-11-24 | 1 | a | `git cherry` 0/1; PR #72 merged 2026-11-24 as cd66c004, tip = PR head | PDF Editor: fix the release build (drop the Worklets copy step) |
| `free-songs-first-list` | 2026-11-24 | 1 | a | `git cherry` 0/1; PR #88 merged 2026-11-24 as 4a464594, tip = PR head | Design Editor: free songs panel opens on popular songs |
| `free-songs-key-hint` | 2026-11-24 | 1 | a | `git cherry` 0/1; PR #89 merged 2026-11-24 as dedc90fa, tip = PR head | Design Editor: say plainly that free songs need a free key |
| `compose-fps-cap-only-when-needed` | 2026-11-25 | 1 | a | `git cherry` 0/1; PR #106 merged 2026-11-24 as da47045c, tip = PR head | Make a video: only drop frames from clips faster than the video's rate |
| `fix/inflow-receipt-dupes` | 2026-11-25 | 1 | b | `git cherry` 1/1; PR #110 OPEN, tip = PR head, 1 commit not in main | Inflow: merge one transfer's two bank texts, find payment screenshots |
| `free-songs-license-url` | 2026-11-25 | 1 | a | `git cherry` 0/1; PR #99 merged 2026-11-24 as 45704968, tip = PR head | Free songs: read Freesound's real license format so songs are not all dropped |
| `free-songs-music-hint` | 2026-11-25 | 1 | a | `git cherry` 0/1; PR #102 merged 2026-11-24 as 40b504de, tip = PR head | Free songs: open on music, and say when a song is being added |
| `hub-embed-parse` | 2026-11-25 | 1 | a | `git cherry` 0/1; PR #111 merged 2026-11-25 as 964e19ab, tip = PR head | AI hub 0.1.5: read embeddings replies that leave index out |
| `hub-failure-detail` | 2026-11-25 | 1 | a | `git cherry` 0/1; PR #109 merged 2026-11-25 as 83f818d3, tip = PR head | AI hub 0.1.4: log the shape of an unreadable reply |
| `inflow/ai-results-cleanup` | 2026-11-25 | 1 | b | `git cherry` 1/1; PR #112 OPEN, tip = PR head, 1 commit not in main | Inflow: say that picked Autopilot chats are sent to the AI |
| `nexus-build-fix` | 2026-11-25 | 1 | a | `git cherry` 0/1; PR #107 merged 2026-11-24 as a3d21573, tip = PR head | PDF Editor: fix the release build where libworklets.so is not linked |
| `nexus-cv-import` | 2026-11-25 | 1 | a | `git cherry` 0/1; PR #104 merged 2026-11-24 as 7d47e617, tip = PR head | Nexus: import an existing CV to start a new one |
| `nexus-cv-scroll` | 2026-11-25 | 1 | a | `git cherry` 0/1; PR #108 merged 2026-11-24 as 0ecc56b0, tip = PR head | Nexus: keep the New CV page scrollable after importing a long CV |
| `reel-stills-no-framedrop` | 2026-11-25 | 1 | a | `git cherry` 0/1; PR #105 merged 2026-11-24 as 2da3edba, tip = PR head | Design Editor: fix making a reel from photos |
| `store-big-upload` | 2026-11-25 | 2 | a | `git cherry` 1/1; PR #101 merged 2026-11-24 as 4b1fd024, tip = PR head | Store: upload big APKs in parts so Cloudflare stops answering 413 |

Class a also contains these exceptions to the plain rule: `ai-hub-ui-fixes` (extra commit duplicates #71), `tunnelwall-firewall` (no PR of its own, content is #14) and `fix/lockfile-halo` (no PR, change already in main). The remote `photo-search` is safe to delete (class a), but the 6 handoff-doc commits that were never pushed (newer than main's `docs/handoffs/photo-search.md`) live only in the local `photo-search` worktree, see H2. Class b notes: `extension-email-login` should be looked at by the Strongroom owner before deletion (its e2e walk and deploy notes are not on main); `model-host` waits on the A/B/C decision in H4. Class c: `autopilot`.

Branches that were already gone from GitHub before this fetch: `ai-hub` (#66 merged), `fix/text-ocr-null-bounds` (#68 merged), `nexus-cv-via-ai-hub` (#90 closed unmerged, replaced by the merged `hub-only/nexus`, #91). Nothing to delete.

### Commands for the owner (NOT run)

Group a: 37 branches whose work is on main. Review the table, then run:

```bash
git push origin --delete \
  tunnelwall-firewall \
  design-canvas-perf \
  design-media-phase-3 \
  security-fixes \
  strongroom-export \
  strongroom-sync \
  strongroom-sync-followup \
  strongroom-mobile-email-recovery \
  inflow/stage-4b \
  photo-search \
  photo-search-floor \
  strongroom-passes \
  design-editor-groq \
  fix/lockfile-halo \
  homenet-toolbox \
  image-tools \
  nexus-gemini-groq \
  inflow/receipts \
  multi-key-ai \
  nexus-keep-out \
  nexus-keep-out-fix \
  ai-hub-store \
  ai-hub-ui-fixes \
  ai-hub-aq-keys \
  ci-worklets-fix \
  free-songs-first-list \
  free-songs-key-hint \
  compose-fps-cap-only-when-needed \
  free-songs-license-url \
  free-songs-music-hint \
  hub-embed-parse \
  hub-failure-detail \
  nexus-build-fix \
  nexus-cv-import \
  nexus-cv-scroll \
  reel-stills-no-framedrop \
  store-big-upload
```

Group c (superseded, owner decides; delete only after a look at the table row):

```bash
git push origin --delete \
  autopilot
```

Branches that are plain ancestors of origin/main (20: eco/*, fix/inflow-*, hub-only/*): already merged, listed only so nothing is overlooked. Several back local worktrees in H2, so do these after the worktree removals:

```bash
git push origin --delete \
  eco/ai-hub \
  eco/autonomous-browsing \
  eco/base \
  eco/clipboard \
  eco/deputy \
  eco/design-editor \
  eco/halo \
  eco/homenet \
  eco/inflow \
  eco/nexus \
  eco/store \
  eco/strongroom \
  eco/tunnelwall \
  fix/inflow-ask-cap \
  fix/inflow-batch-cap \
  fix/inflow-hub-log-kind \
  fix/inflow-hub-reason \
  hub-only/design-editor \
  hub-only/inflow \
  hub-only/nexus
```

Do NOT delete group b (`extension-email-login`, `fix/inflow-receipt-dupes`, `inflow/ai-results-cleanup`, `model-host`) without the owner's decision.

## H2. Local worktrees (71)

Sources: `git worktree list` (under `/Users/outsentia/Documents/apps-hub/.claude/worktrees`, `/Users/outsentia/Documents/apps-hub-wt`, and three scratchpad paths under `/private/tmp/claude-501`). Dirty = `git -C <wt> status --short | wc -l`. No directory is missing, so nothing was pruned.

Classes: MAIN = the owner's main checkout; LIVE-FIX = this wave's stream worktrees (not touched); OPEN-PR = branch has an open PR; MERGED-ANC = clean, tip is an ancestor of origin/main; MERGED-SQ = clean, merged by squash (tip = PR head or inside PR #59 `combined/main-work`); REVIEW = work is merged but the worktree holds uncommitted files, owner looks before removing; REAL = unique or uncommitted source/work; UNCLEAR = owner decides.

| Worktree | Branch | Tip | Last commit | Dirty files | Class | Note |
|---|---|---|---|---|---|---|
| `apps-hub` | `main` | 226a9470 | 2026-11-10 | 84 | MAIN | owner's main checkout, stale branch (see H4); never touched |
| `scratchpad/release-de-inflow` | `DETACHED` | 1ba92561 | 2026-11-23 | 0 | MERGED-ANC | detached on a commit that is on main; scratchpad of another session, confirm that session is over |
| `scratchpad/release-aihub` | `DETACHED` | 1ba92561 | 2026-11-23 | 0 | MERGED-ANC | detached on a commit that is on main; scratchpad of another session, confirm that session is over |
| `scratchpad/main-check` | `DETACHED` | 6981cf70 | 2026-11-23 | 0 | MERGED-ANC | detached on a commit that is on main; scratchpad of another session, confirm that session is over |
| `apps-hub-wt/ai-hub` | `ai-hub-store` | 36618eb3 | 2026-11-23 | 0 | MERGED-SQ | ai-hub-store, PR #71 |
| `apps-hub-wt/autopilot` | `autopilot` | 69909490 | 2026-11-18 | 0 | MERGED-SQ | superseded: PR #46 closed, content on main via #52 (class c) |
| `apps-hub-wt/ci-worklets-fix` | `ci-worklets-fix` | 1d23a1ee | 2026-11-24 | 0 | MERGED-SQ | PR #72, tip = PR head |
| `apps-hub-wt/compose-fps-cap` | `compose-fps-cap-only-when-needed` | dc163761 | 2026-11-25 | 0 | MERGED-SQ | PR #106, tip = PR head |
| `apps-hub-wt/eco-ai-hub` | `eco/ai-hub` | 60875260 | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-autonomous-browsing` | `eco/autonomous-browsing` | 87105433 | 2026-11-23 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-base` | `eco/base` | 3b6bbadc | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-clipboard` | `eco/clipboard` | a7328d11 | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-deputy` | `eco/deputy` | 11f36c75 | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-design-editor` | `eco/design-editor` | d8596fd8 | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-halo` | `eco/halo` | f5101650 | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-homenet` | `eco/homenet` | de113818 | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-inflow` | `eco/inflow` | e91af87e | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-nexus` | `eco/nexus` | 779a8bb6 | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-store` | `eco/store` | 80356e9f | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-strongroom` | `eco/strongroom` | 09bd96cd | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/eco-tunnelwall` | `eco/tunnelwall` | d731878b | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main; the eco PR is merged. List only (owner rule) |
| `apps-hub-wt/fix-ai-hub` | `fix/ai-hub` | 964e19ab | 2026-11-25 | 10 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/fix-deputy` | `fix/deputy` | 964e19ab | 2026-11-25 | 3 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/fix-deputy-hub` | `fix/deputy-hub` | 964e19ab | 2026-11-25 | 0 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/fix-design-editor` | `fix/design-editor` | 964e19ab | 2026-11-25 | 0 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/fix-docs` | `fix/docs` | 964e19ab | 2026-11-25 | 0 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/fix-halo` | `fix/halo` | 964e19ab | 2026-11-25 | 6 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/fix-homenet` | `fix/homenet` | 964e19ab | 2026-11-25 | 7 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/fix-inflow` | `fix/inflow` | 964e19ab | 2026-11-25 | 6 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/fix-ocr` | `fix/ocr` | 964e19ab | 2026-11-25 | 0 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/fix-release` | `fix/release` | 964e19ab | 2026-11-25 | 0 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/fix-strongroom` | `fix/strongroom` | 964e19ab | 2026-11-25 | 10 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/fix-tunnelwall` | `fix/tunnelwall` | 964e19ab | 2026-11-25 | 7 | LIVE-FIX | this run's stream worktree; never touched |
| `apps-hub-wt/free-songs` | `design-editor-free-songs` | cff47c0a | 2026-11-20 | 0 | MERGED-ANC | tip is an ancestor of origin/main |
| `apps-hub-wt/free-songs-first-list` | `free-songs-first-list` | f4754b62 | 2026-11-24 | 0 | MERGED-SQ | PR #88, tip = PR head |
| `apps-hub-wt/free-songs-key-hint` | `free-songs-key-hint` | 5385c9ef | 2026-11-24 | 0 | MERGED-SQ | PR #89, tip = PR head |
| `apps-hub-wt/free-songs-license-url` | `free-songs-license-url` | 9096d6a5 | 2026-11-25 | 0 | MERGED-SQ | PR #99, tip = PR head |
| `apps-hub-wt/free-songs-music-hint` | `free-songs-music-hint` | e61428b9 | 2026-11-25 | 0 | MERGED-SQ | PR #102, tip = PR head |
| `apps-hub-wt/halo` | `halo` | 08cc2769 | 2026-11-18 | 2 | REVIEW | tip inside merged PR #55; uncommitted: edge-visualizer.md edit and a stage-5 plan doc |
| `apps-hub-wt/halo-release-070` | `release/halo-0.7.0` | ebfde018 | 2026-11-23 | 0 | MERGED-ANC | tip is an ancestor of origin/main |
| `apps-hub-wt/hub-failure-detail` | `hub-embed-parse` | 0e9a29c5 | 2026-11-25 | 0 | MERGED-SQ | PR #111, tip = PR head |
| `apps-hub-wt/hubonly-design-editor` | `hub-only/design-editor` | 480343eb | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main (hub-only PRs merged) |
| `apps-hub-wt/hubonly-inflow` | `fix/inflow-batch-cap` | 40bc059d | 2026-11-25 | 0 | MERGED-ANC | tip is an ancestor of origin/main (hub-only PRs merged) |
| `apps-hub-wt/hubonly-nexus` | `hub-only/nexus` | f4fbb898 | 2026-11-24 | 0 | MERGED-ANC | tip is an ancestor of origin/main (hub-only PRs merged) |
| `apps-hub-wt/inflow` | `inflow/post-release` | 940e9263 | 2026-11-20 | 16 | REVIEW | branch inflow/post-release is merged (#42, #61 cover its extra commit); 16 untracked files (fix-*-brief.md and other briefs) |
| `apps-hub-wt/inflow-ai-cleanup` | `inflow/ai-results-cleanup` | c6e6671e | 2026-11-25 | 0 | OPEN-PR | PR #112 open |
| `apps-hub-wt/inflow-receipt-dupes` | `fix/inflow-receipt-dupes` | 1df68e49 | 2026-11-25 | 0 | OPEN-PR | PR #110 open |
| `apps-hub-wt/ml-on-main` | `ml-on-main` | 14a36433 | 2026-11-20 | 0 | MERGED-SQ | tip is inside PR #59 (combined/main-work), clean |
| `apps-hub-wt/nexus-build-fix` | `nexus-build-fix` | b176b51a | 2026-11-25 | 0 | MERGED-SQ | PR #107, tip = PR head |
| `apps-hub-wt/nexus-cv-import` | `nexus-cv-import` | 9711b110 | 2026-11-25 | 0 | MERGED-SQ | PR #104, tip = PR head |
| `apps-hub-wt/nexus-cv-scroll` | `nexus-cv-scroll` | 5cd3a81c | 2026-11-25 | 0 | MERGED-SQ | PR #108, tip = PR head |
| `apps-hub-wt/nexus-keep-out` | `DETACHED` | 68006565 | 2026-11-23 | 2 | REVIEW | detached on a commit on main; uncommitted: nexus.md edit and nexus-cv-import.md handoff |
| `apps-hub-wt/nexus-keep-out-fix` | `nexus-keep-out-fix` | e76ea1d6 | 2026-11-20 | 0 | MERGED-SQ | PR #63, tip = PR head |
| `apps-hub-wt/nexus-release` | `DETACHED` | 4a464594 | 2026-11-24 | 0 | MERGED-ANC | detached on a commit that is on main |
| `apps-hub-wt/notch-edge` | `halo-notch-edge` | f8cc04b6 | 2026-11-23 | 2 | REVIEW | tip is an ancestor of origin/main; uncommitted: pnpm-lock.yaml and notch-edge-features.md |
| `apps-hub-wt/notch-halo` | `notch-halo` | 0f56afc8 | 2026-11-19 | 1 | REVIEW | PR #55 merged, tip = PR head; one untracked doc notch-edge-features.md (same name as in notch-edge) |
| `apps-hub-wt/notebox-baseline` | `notebox/baseline-single` | b96b3ea6 | 2026-11-13 | 0 | UNCLEAR | local only, 12 commits, no PR, no remote copy: Notebox stage 1 (Notebox became Inflow, #35). Likely superseded; owner decides |
| `apps-hub-wt/reel-stills` | `reel-stills-no-framedrop` | fa371fc7 | 2026-11-25 | 0 | MERGED-SQ | PR #105, tip = PR head |
| `apps-hub-wt/store-big-upload` | `store-big-upload` | a00edfef | 2026-11-25 | 0 | MERGED-SQ | PR #101, tip = PR head |
| `apps-hub/.claude/worktrees/deputy-make-video` | `deputy-make-video` | de6160fd | 2026-11-06 | 1 | REVIEW | tip = PR #23 head; one tracked edit to docs/handoffs/strongroom-sync.md (same 1-line patch in 4 worktrees) |
| `apps-hub/.claude/worktrees/design-media-phase-4` | `design-media-phase-4` | 995e7b38 | 2026-11-06 | 1 | REVIEW | tip = PR #24 head; same 1-line strongroom-sync.md edit |
| `apps-hub/.claude/worktrees/extension-email-login` | `extension-email-login` | e0a7c655 | 2026-11-17 | 8 | REAL | 8 tracked edits incl. popup.ts, e2e.mjs, strongroom recovery-flow.ts and tests (uncommitted source); branch also 2 commits beyond #36, see H1 |
| `apps-hub/.claude/worktrees/image-tools` | `image-tools` | 298071b9 | 2026-11-19 | 1 | MERGED-SQ | tip = PR #50 head; only an untracked __pycache__ |
| `apps-hub/.claude/worktrees/nexus` | `nexus` | 89c06b76 | 2026-11-19 | 24 | REAL | 19 tracked + 5 untracked uncommitted files (knowledge-core, library-core, place-reminders module); its 1 extra commit is a copy of #54 |
| `apps-hub/.claude/worktrees/photo-search` | `photo-search` | 5a53d05a | 2026-11-18 | 0 | REAL | local only: 6 handoff-doc commits (newer than main's photo-search.md, e.g. builds 12-14, ORT telemetry fix) not on any remote; ecosystem.md Reuse table also lists 5a53d05a as the only unmerged piece |
| `apps-hub/.claude/worktrees/sieve` | `sieve` | 47c7ea47 | 2026-11-08 | 7 | REAL | live Sieve work: manifest.json, sieve.md edits and untracked store/ assets; tip is inside PR #59 |
| `apps-hub/.claude/worktrees/sieve-phase-2` | `sieve-phase-2` | 4878e445 | 2026-11-17 | 1 | REVIEW | tip is inside PR #59; one untracked doc sieve-run-2-close.md |
| `apps-hub/.claude/worktrees/strongroom-ext-security` | `strongroom-extension-security` | 464fd71e | 2026-11-16 | 1 | REVIEW | merged #29 plus a 0.2.0 version-bump commit that main has since passed; same 1-line strongroom-sync.md edit |
| `apps-hub/.claude/worktrees/strongroom-extension` | `strongroom-extension` | c3da09cc | 2026-11-05 | 11 | REAL | tip is on origin/strongroom-sync (merged #22); 5 tracked edits and 6 untracked files (store workflow, scripts, store assets, PHASE-2-PLAN.md): uncommitted work |
| `apps-hub/.claude/worktrees/strongroom-google-capture` | `strongroom-google-capture` | a46c6934 | 2026-11-23 | 0 | MERGED-SQ | tip = PR #69 head, clean |
| `apps-hub/.claude/worktrees/strongroom-sync` | `strongroom-sync-followup` | 8a1b8dd5 | 2026-11-06 | 3 | REVIEW | branch strongroom-sync-followup = PR #25 head; 1-line strongroom-sync.md edit and 2 untracked extension-security plan/spec docs |

Counts by class: MERGED-ANC 22 (13 are `eco-*`, listed only), MERGED-SQ 18, REVIEW 10, REAL 5, LIVE-FIX 12, OPEN-PR 2, UNCLEAR 1, MAIN 1.

### Commands for the owner (NOT run)

Only clean, merged worktrees are in these blocks. Review, REAL, UNCLEAR, OPEN-PR, LIVE-FIX and MAIN worktrees are deliberately left out. `eco-*` lines are included only because their tips are in origin/main (PRs #75 to #87 merged); this run does not touch them.

```bash
cd /Users/outsentia/Documents/apps-hub
# 1. Clean, tip is an ancestor of origin/main (plain -d works).
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-ai-hub" && git branch -d eco/ai-hub
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-autonomous-browsing" && git branch -d eco/autonomous-browsing
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-base" && git branch -d eco/base
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-clipboard" && git branch -d eco/clipboard
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-deputy" && git branch -d eco/deputy
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-design-editor" && git branch -d eco/design-editor
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-halo" && git branch -d eco/halo
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-homenet" && git branch -d eco/homenet
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-inflow" && git branch -d eco/inflow
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-nexus" && git branch -d eco/nexus
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-store" && git branch -d eco/store
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-strongroom" && git branch -d eco/strongroom
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/eco-tunnelwall" && git branch -d eco/tunnelwall
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/free-songs" && git branch -d design-editor-free-songs
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/halo-release-070" && git branch -d release/halo-0.7.0
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/hubonly-design-editor" && git branch -d hub-only/design-editor
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/hubonly-inflow" && git branch -d fix/inflow-batch-cap
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/hubonly-nexus" && git branch -d hub-only/nexus
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/nexus-release"

# 2. Clean, merged by squash (tip equals the merged PR head, or is inside #59): -d refuses, so -D, each backed by the evidence in the table.
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/ai-hub" && git branch -D ai-hub-store
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/autopilot" && git branch -D autopilot
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/ci-worklets-fix" && git branch -D ci-worklets-fix
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/compose-fps-cap" && git branch -D compose-fps-cap-only-when-needed
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/free-songs-first-list" && git branch -D free-songs-first-list
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/free-songs-key-hint" && git branch -D free-songs-key-hint
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/free-songs-license-url" && git branch -D free-songs-license-url
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/free-songs-music-hint" && git branch -D free-songs-music-hint
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/hub-failure-detail" && git branch -D hub-embed-parse
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/ml-on-main" && git branch -D ml-on-main
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/nexus-build-fix" && git branch -D nexus-build-fix
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/nexus-cv-import" && git branch -D nexus-cv-import
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/nexus-cv-scroll" && git branch -D nexus-cv-scroll
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/nexus-keep-out-fix" && git branch -D nexus-keep-out-fix
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/reel-stills" && git branch -D reel-stills-no-framedrop
git worktree remove "/Users/outsentia/Documents/apps-hub-wt/store-big-upload" && git branch -D store-big-upload
# image-tools holds only an untracked tools/quick-edits-bench/__pycache__, so it needs --force
git worktree remove --force "/Users/outsentia/Documents/apps-hub/.claude/worktrees/image-tools" && git branch -D image-tools
git worktree remove "/Users/outsentia/Documents/apps-hub/.claude/worktrees/strongroom-google-capture" && git branch -D strongroom-google-capture

# 3. Scratchpad worktrees of other sessions (detached, clean, on main). Run only after those sessions have ended.
git worktree remove "/private/tmp/claude-501/-Users-outsentia--claude-spares-spare-PV8XMt/adb41183-d4ce-4a38-8757-1555542c696a/scratchpad/release-de-inflow"
git worktree remove "/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/76c40ff9-ac87-4d43-83f0-60dbff6eace5/scratchpad/release-aihub"
git worktree remove "/private/tmp/claude-501/-Users-outsentia-Documents-apps-hub/c4501f29-d911-4d69-9e86-4ac5f937ba4f/scratchpad/main-check"
```

Local branches that have no worktree were not audited.

## H4. The stale main checkout (facts only; nothing touched)

Read-only queries on `/Users/outsentia/Documents/apps-hub` on 2026-11-25:

- `git branch --show-current`: `main` (not `model-host`; earlier handoffs said it sat on `model-host`, that is no longer true).
- `git status --short | wc -l`: **84** (30 `M`, 3 `MM`, 51 `??`): other sessions' uncommitted work.
- `git rev-list --count main..origin/main`: **387** commits behind. `origin/main..main`: 1 commit, `226a9470` "Strongroom: suggest a strong password on signup forms" (2026-11-10), not on origin under that subject. Its content is on main in later form (`PasswordGenerator.kt` and its test are byte-identical; the other four files were changed again afterwards), so nothing is lost by ignoring it. Merge base with origin/main is `93f21a16` (2026-11-06).
- The Model Host decision is **unanswered**. From `git show origin/model-host:docs/handoffs/model-host.md` ("Current state + exact next step", Phase 0 done on the phone 2026-11-06): **A (recommended)** stop Model Host for this phone, Deputy stays on the cloud, keep the bench and the results; **B** build the Picker only (Kev-0.8B text-only, `-t 2 -c 4096`, 0.35 gate; about 9 s per pick, 2.8 GB RAM, overrides the spec's 2 s and 16/20 bar); **C** spend one hour trying the MNN-LLM runtime on the same phone (needs the phone and the queue). Picker, Deputy-with-screenshot and Thinker all failed the bar on the owner's Redmi Note 14 Pro 4G. Branch `model-host` (PR #27 closed) still holds the unmerged bench, spec, plan and handoff, so it stays until the owner answers.

## File map

- This file: `docs/handoffs/ecosystem-fixes.md` (branch `fix/docs`). Previous wave: `docs/handoffs/ecosystem.md` (not edited here; the H3 pass edits it later).
- Workspace outside the repo: `/Users/outsentia/Documents/apps-hub-wt/fix-work/` with `COMMON.md`, `GRADLE.md`, `brief-*.md`, `baseline-summary.txt`, `baseline-test.log`, `baseline-typecheck.log`, `progress.md`, `locks/`, `reports/<stream>.md`.
- Streams (worktree, branch, brief):

| Stream | Worktree | Branch | Brief |
|---|---|---|---|
| A release safety | `fix-release` | `fix/release` | `brief-release.md` |
| B-Halo | `fix-halo` | `fix/halo` | `brief-halo.md` |
| B-Deputy | `fix-deputy` | `fix/deputy` | `brief-deputy.md` |
| B-Inflow | `fix-inflow` | `fix/inflow` | `brief-inflow.md` |
| B-TunnelWall | `fix-tunnelwall` | `fix/tunnelwall` | `brief-tunnelwall.md` |
| B-HomeNet | `fix-homenet` | `fix/homenet` | `brief-homenet.md` |
| C1 AI hub v3 | `fix-ai-hub` | `fix/ai-hub` | `brief-ai-hub.md` |
| C2 Deputy on hub | `fix-deputy-hub` | `fix/deputy-hub` | `brief-deputy-hub.md` |
| D Strongroom | `fix-strongroom` | `fix/strongroom` | `brief-strongroom.md` |
| E OCR | `fix-ocr` | `fix/ocr` | `brief-ocr.md` |
| F Design Editor brand kit | `fix-design-editor` | `fix/design-editor` | `brief-design-editor.md` |
| H1/H2/H4 docs research | `fix-docs` | `fix/docs` | `brief-docs-a.md` |

- Source docs for the research: `docs/handoffs/ecosystem.md` (Reuse table), `docs/handoffs/model-host.md` (on `origin/model-host` only).

## Session log

- 2026-11-25 (coordinator): wave dispatched from origin/main `964e19ab`; baseline test and typecheck recorded; first-wave streams running in parallel, one worktree each (ledger in `fix-work/progress.md`).
- 2026-11-25 (docsa): H1, H2 and H4 research done; this file created; commit "Handoff: ecosystem fixes ledger, branch and worktree classification" on `fix/docs`. No remote branch, worktree or tag was deleted or pushed.

## Current state and exact next step

State: H1, H2 and H4 facts are recorded above and committed on `fix/docs` (not pushed). The coordinator keeps this section current as streams report.

Next, in order:

1. Coordinator: collect each stream's report from `fix-work/reports/<stream>.md`, add one line each to the session log.
2. H3 docs pass (a later agent): edit ecosystem.md and the per-app AGENTS.md paragraphs from the stream reports; fill the phone-checks list (every phone check is "not run").
3. Owner: approve (or edit) the H1 group a `git push origin --delete` block and the H2 removal blocks; decide on class b and c rows (`extension-email-login`, `model-host`, `autopilot`) and on the Model Host A/B/C question; look at the REAL and REVIEW worktrees (uncommitted work in `nexus`, `extension-email-login`, `strongroom-extension`, `sieve`, `photo-search`).
4. Owner's go for any merge, release or deploy; hub first, then Deputy (C1 before C2).
