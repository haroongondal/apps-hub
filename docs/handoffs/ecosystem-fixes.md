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

## Stream results (from the stream reports in `fix-work/reports/`, written 2026-11-25; branch tips at 20:40, re-run `git rev-parse` before use)

Every branch is cut from origin/main `964e19ab`, has no push and no attribution line, and every phone check is "not run" (full steps in `docs/handoffs/phone-checks.md`). Gate numbers are the streams' own real output; the docs stream re-ran only the doctor and the merge probe (below).

| Stream | Branch (tip) | Items | Result | Gates the stream reported |
|---|---|---|---|---|
| A release safety | `fix/release` (9e45b16d) | A1 plan then `--yes`; A2 schema check and `--accept-newer-data`; A3 `rolledBackFrom` and Store row; A4 CI failure | DONE all four. A4: the failure on the #87 merge (run 45426964968) was a real version race, not a flaky test | release 72 pass, store-manifest 10, store 24, root 3333 pass, typecheck clean (the schema rule was simplified in round 4: any missing registered file is `unknown`) |
| C1 AI hub v3 | `fix/ai-hub` (f06e5f70) | `raw`, `toolChoice`, images in chat, `reasoningEffort`, `service` pin (beyond the brief), v2 compatibility | DONE; own security review: 0 critical, high or medium, 2 low, both fixed | hub JVM 142, ai-hub-client Kotlin 12 and ts 13, ai-hub ts 9, app-link-contract 139, root 3299 pass; `:app:assembleDebug` not re-run after the last fix |
| C2 Deputy on the hub | `fix/deputy-hub` (abc96c02, contains `fix/ai-hub`) | hub first, own key once as fallback, one service per run | DONE; own security review 1 medium (fixed); code review follow-up (unknown model priced at a Pro ceiling, plain "too long" message) | Deputy JVM 372 pass, deputy ts 25, root 3300 pass |
| B Deputy | `fix/deputy` (85abbf53) | `finish()` after a replaced proposal; checks of no re-download, saved-files report, 429 wait | DONE; the three checks already had tests | Deputy JVM 350 pass, deputy ts 24 |
| B Halo | `fix/halo` (cffc941f) | `gate.cancel()` through `RereadSlot`; link-switch copy | DONE | halo-engine 214, notch-island 128, halo ts 140 |
| B HomeNet | `fix/homenet` (b5a60c74) | `useHomeWatch` controller, serial update chain | DONE; regression audit: accepted deletion of one brittle source-text test (the unlock path goes on the phone list) | core 376, netlens 1 |
| B Inflow | `fix/inflow` (2dbe94b8) | refresher, hub routing and health consent wiring tests; pass rows in the briefing cards line | DONE | inflow-core JVM 867, inflow ts 152 |
| B TunnelWall | `fix/tunnelwall` (b2c3256b) | kill switch and shield window tests (`KillSwitch.afterEstablish`, `TunnelLinkStore`) | DONE; the `holdBlock` edge is pinned, not fixed; owner finding below | JVM 223 (app plus module), open-tunnel-core 45, ts 155 |
| D Strongroom | `fix/strongroom` (e924043c) | optional `expiresOn` on a pass; Wi-Fi networks as QR passes | DONE additively (no vault format change); security fix for the edit rule and NFC | strongroom-core 190, strongroom ts 116, extension unit 139, Gradle 679 JVM pass |
| E OCR | `fix/ocr` (fefca1f0) | Arabic and Urdu, language choice in Nexus Scan text | DONE; accuracy measured on synthetic pictures only, not on a phone | text-ocr 9, library-core 121, pdf-editor-mobile 223, Gradle text-ocr 11 and pdf-scan 59 |
| F Design Editor | `fix/design-editor` (6758adf3) | C7 brand kit from an image | Already on main (4fc78b36); only a wiring test (3 tests) added; Gradle skipped (no native change) | design-editor-mobile 154 |
| H docs | `fix/docs` | H1, H2, H4 research, this file, G, H3 | see below | doctor, probe merge |

Not seen when this was written: the results of the scoped invariant re-review of `fix/release` and the independent code review of `fix/deputy-hub` (the coordinator had them running); read the coordinator's `fix-work/progress.md` for them.

## G1. `expo-doctor` (run 2026-11-25 from `fix-docs`)

**Plain `pnpm doctor` is not this script.** In pnpm 12 it is pnpm's own check ("Versions, Cache directory, Registry connectivity, Install smoke test": all passed, 1 warning about Corepack). It does not run `expo-doctor`. The root script is `pnpm run doctor` (`pnpm -r --if-present run doctor`), and only four apps carry a `doctor` script. `AGENTS.md` and `CLAUDE.md` now say `pnpm run doctor`; `.claude/agents/repo-verifier.md` and `.claude/skills/upgrading-dependencies/SKILL.md` still say `pnpm doctor` (listed under "Docs still to fix").

Baseline, origin/main `964e19ab` (this worktree before any fix): `pnpm -r --no-bail --if-present run doctor` exits 1 (ELIFECYCLE in 4 packages). Every app is **16/18 checks passed**, and the two failures are identical everywhere, so nothing is new: (1) "Check for common project setup issues": the `android` and `ios` directories of local Expo modules are gitignored (the repo's pattern is too general for this check; the repo commits those module directories on purpose, see CLAUDE.md "Each app's android/ is a committed Expo prebuild"); (2) "Check for app config fields that may not be synced in a non-CNG project": the apps contain committed native folders and also have prebuild fields in `app.json`.

| App | Has a `doctor` script | Baseline (origin/main) | On its branch(es) |
|---|---|---|---|
| HomeNet `apps/netlens` | yes | 16/18 | `fix/homenet` 16/18 |
| TunnelWall `apps/open_tunnel_vpn` | yes | 16/18 (matches the 16/18 baseline the TunnelWall stream also saw) | `fix/tunnelwall` 16/18 |
| Nexus `apps/pdf-editor-mobile` | yes | 16/18 | `fix/ocr` 16/18 |
| Design Editor mobile `apps/design-editor-mobile` | yes | 16/18 | `fix/design-editor` 16/18; `fix/ocr` 16/18 (shares `text-ocr`) |
| Deputy `apps/deputy` | no (ran the binary from `apps/netlens` inside its folder) | 16/18 | `fix/deputy` 16/18; `fix/deputy-hub` 16/18 (adds the `ai-hub-client` workspace dependency) |
| Inflow `apps/inflow` | no (same way) | 16/18 | `fix/inflow` 16/18; `fix/ocr` 16/18 |
| Halo `apps/halo` | no (same way) | 16/18 | `fix/halo` 16/18 |
| Strongroom `apps/strongroom` | no (same way) | 16/18 | `fix/strongroom` 16/18 |
| AI hub `apps/ai-hub` | no (same way) | 16/18 | `fix/ai-hub` 16/18 |
| Store `apps/store` | no (same way) | 16/18 | `fix/release` 16/18 |
| Clipboard `apps/clipboard` | no (same way) | 16/18 | no branch touches it |
| autonomous-browsing, sieve, strongroom-extension, pdf-editor-desktop, design-editor (Mac) | not Expo apps | not run | not run |

Same two failures on every row (checked: `grep '✖'` over every log). No branch changed the result. The "not synced" and "gitignored" failures predate the fixes; fixing them is outside this wave (would change `.gitignore` and the CNG strategy: owner decision, not taken).

## Merge probe (read-only, in a throwaway worktree that was then removed)

Method: `git worktree add --detach .../fix-merge-probe`, then `git merge --no-commit --no-ff` of the twelve branches in the planned order, one commit each (conflicts resolved with `--ours` only to keep going), then the worktree was removed.

- Onto origin/main `964e19ab` (where the branches were cut): **all 12 merges clean, no conflict**, including `AGENTS.md` (Strongroom, OCR, deputy-hub and docs each edit different paragraphs) and `docs/handoffs/deputy.md` (both Deputy branches add text in different places).
- Onto the current origin/main `8631d144` (after #110): **one conflict**, `apps/inflow/package.json`, in the `test` script. Main's #110 added `src/__tests__/autoReceipts.test.ts`, `fix/inflow` added `src/__tests__/health-consent.test.ts`: keep both names in the one line. Nothing else conflicts.
- On the merged tree (all 12 branches onto `8631d144`, `fix/inflow`'s test line resolved to main's side so its `health-consent.test.ts` did not run): `pnpm install --frozen-lockfile --prefer-offline` passed (the lockfile edits of `fix/deputy-hub` and the `fix/ocr` package changes agree), `pnpm -r --no-bail --workspace-concurrency=2 --if-present run typecheck` exit 0 with 0 `error TS`, and `pnpm -r --no-bail --workspace-concurrency=2 test` exit 0 with 3374 passing and 0 failing across 34 packages. No Gradle was run on the merged tree.
- The probe merged the tips in the Stream results table (`fix/release` e7d18ccf and `fix/deputy-hub` abc96c02 were the newest commits when it ran). Streams were still adding commits, so re-probe once more right before the real merges; the probe script is nothing more than the loop "`git merge --no-commit --no-ff <branch>`, list conflicted files, commit, next" in the order of the PR plan.

## PR plan

One PR per branch (the owner pushes; nothing is pushed). Order, with the release each one needs afterwards (`pnpm release <id>`, only on the owner's go, merge with `[skip ci]` per owner memory):

| Order | Branch | Merge note | Releases (id) | Why this place |
|---|---|---|---|---|
| 1 | `fix/release` | tooling, manifest field, Store row | `store` | Store must carry the "Rolled back from" row and the health screen before anything is checked in it |
| 2 | `fix/ai-hub` | | `ai-hub` | The hub must be on the phone before any hub path or link can be phone-tested |
| 3 | `fix/deputy-hub` | contains `fix/ai-hub`; merges as two extra commits after step 2 | `deputy` | Needs the v3 hub |
| 4 | `fix/deputy` | | (same Deputy release) | |
| 5 | `fix/halo` | | `halo` | |
| 6 | `fix/homenet` | | `netlens` | |
| 7 | `fix/inflow` | resolve `apps/inflow/package.json` (keep both test files) | `inflow` | Reads Strongroom pass rows |
| 8 | `fix/tunnelwall` | | `open-tunnel` | |
| 9 | `fix/strongroom` | | `strongroom` (and reload the unpacked extension) | |
| 10 | `fix/ocr` | | `pdf-editor` (Nexus); Inflow and Design Editor mobile grow about 1.8 MB at their next release | |
| 11 | `fix/design-editor` | a test only | none | |
| 12 | `fix/docs` | last: its AGENTS.md text says the hub is apiVersion 3 and Deputy calls it | none | |

Release order for the phone checks: Store, AI hub, Deputy, then Halo, HomeNet, Inflow, TunnelWall, Strongroom, Nexus (details and the checks each unlocks: `docs/handoffs/phone-checks.md`).

## Docs still to fix (docs and code that still disagree; not fixed here)

Fixed in this pass (on `fix/docs`): the AGENTS.md AI hub paragraph (apiVersion 3, hub-only apps, Deputy), the AGENTS.md HomeNet sentence (controller), `pnpm doctor` in `AGENTS.md` and `CLAUDE.md`, the app-link-contract README (Nexus is its own app, Inflow is wired to the release signing, so signing findings (a) and (b) were stale; finding (c) about AI hub had already been corrected by the earlier docs pass), the ecosystem.md ledger.

Still open:

1. `.claude/agents/repo-verifier.md` line 25 and `.claude/skills/upgrading-dependencies/SKILL.md` lines 20 and 39 say `pnpm doctor`; it should be `pnpm run doctor`. Not edited: these are agent and skill instructions, outside the docs scope of this stream.
2. `apps/pdf-editor-mobile/AGENTS.md` is the stock Expo template: it says `npx expo install`, "if `ios/` and `android/` do not exist they are generated" and "never create or edit them by hand", while the repo uses pnpm and commits each app's `android/` (CLAUDE.md). It also names Expo Router and EAS, which this app and the Store flow do not use. The root AGENTS.md and CLAUDE.md win; consider replacing the file.
3. `apps/open_tunnel_vpn/AGENTS.md` (rule 3, the kill-switch boundary) matches the code (`KillSwitch`, `TunnelLinkStore`): no disagreement found. The new owner finding (`startTunnel` ignores `holdBlock`'s result) is in no doc but this file and `phone-checks.md`; once decided, put it into `docs/handoffs/network-toolkit.md`.
4. `docs/handoffs/deputy.md` still has the E2 section "Result: not feasible with AI hub apiVersion 2. Deputy stays on its own keys." (around line 1680) without a pointer to the new "AI hub first" section that `fix/deputy-hub` appended at the end. History, but a reader of the middle of the file is misled.
5. `docs/handoffs/ai-hub.md` line 90 says "No app uses it yet" in a note written before the hub had callers; three apps are hub-only and Deputy is hub-first on `fix/deputy-hub`.
6. `AGENTS.md` "Verification Commands" has no native gate lines for AI hub, Clipboard, the Store and the text-ocr module. The hub gate needs an init script that includes `ai-hub-client` (see `packages/ai-hub-client/README.md`); its exact command was not written into the root file because it was not run from there.
7. `docs/handoffs/ecosystem.md` keeps its first-wave history; this pass only added bracketed notes and the new final section, so older sentences about "no owner go yet", "Deputy not wired to the hub" and "apps keep own keys" still read as history in the middle of the file.
8. `docs/app-store.md` line 149 ("`--rollback` without `--dry-run` builds and publishes") is true on main and false on `fix/release`, which rewrites that section; nothing to do after the merge, but do not edit it separately.
9. `docs/handoffs/design-editor-media.md` and `network-toolkit.md` carry phone-check lists that this wave's `phone-checks.md` condenses; if a list is changed in one place, change it in the other (no tool enforces it).
10. The HomeNet first-wave phone list was not kept in the repo (the handoff points at "the C4 report" and "the P4 report" outside it); `phone-checks.md` rebuilds it from the AGENTS.md paragraph, so it may differ from the original reports.

## OWNER DECISIONS (final list, collected from all stream reports and the coordinator ledger)

Recommended answer first where there is one. Nothing below was decided by the docs stream.

### Release safety (stream A)
1. A1: rollback prints the plan and needs `--yes` to build and publish. Built (my call, ecosystem decision 18). Recommended: keep.
2. A2: `--accept-newer-data`, built and marked: lets a rollback through when the phone's data is newer than the target's schema, still needs `--yes`, never deletes anything (recovering would mean clearing app storage). Keep or drop? Dropping means deleting the flag, one branch in `schemaNotice` and one doc paragraph. Related (my calls, say if you disagree): the check compares against the release published on the phone (HEAD only as a fallback), "cannot tell" refuses like "newer", `--dry-run` stays as a no-op alias, and a Nexus rollback to before `scan-core` or `knowledge-core` existed needs `--accept-newer-data` (every registered database file that is missing at a commit while the app exists reads "cannot tell"; a first-add and marker-search rule was tried and broken three times in review, so the simplest safe rule won: false refusals are possible, false OKs are not). Residual: a chain of accepted rollbacks (c2 to c1 to c0) forgets c2 once the manifest entry is replaced again.
3. Write-once APK keys in `tools/store-api` (a Worker deploy): the real CI failure on the #87 merge (run 45426964968, 2026-11-24 15:33) was two releases publishing the same `versionCode` (pdf-editor 25) while the first was still building; the loser overwrote the winner's APK key and the manifest kept the winner's hash. A guard that re-reads the manifest before upload is built (`assertVersionStillFree`) and shrinks the window to the upload time; the proper fix is refusing a PUT to an existing `apps/*/android/<n>.apk` key. Recommended: do it (needs the owner's Worker deploy, confirm the Cloudflare account first).

### AI: which apps are hub-only and which fall back (stream C)
4. State today (read from AGENTS.md and the reports): **hub-only** (no key of their own, owner decision 2026-11-24, #91 to #93): Nexus, Inflow, Design Editor phone. **Hub first with the own key as a fallback**: Deputy, on `fix/deputy-hub` only (on main Deputy uses its own key only). The Design Editor Mac app keeps its own keys. HomeNet, TunnelWall, Halo, Clipboard, Strongroom and the Store have no AI call. Decision: should Deputy go hub-only too (drop the own-key fallback and the requirement of an own key to Run)? As built, the own key is still needed to Run (setup unchanged) and takes over only before the hub has answered once in a run.
5. Deputy pricing: the brief said "not counted"; built differently (my call): a hub step is priced by the reply's model, and an unknown model at a high ceiling (Gemini 3 Pro's published prices, since the model id is free text) so the cost limits still trip. Say if you want a "not counted" label instead.
6. `maxTokens` 4096 per Deputy hub step (my call). The hub `service` pin (groq or gemini; a pinned request never falls back) is a request field beyond the brief, kept because Gemini's thought signatures in a replayed history are refused by Groq. The hub now rejects a non-`data:image/` picture on every version (a deliberate tightening, my call). Say if any of the three should go.
7. Unverified on a real key: Groq-produced history later served by Gemini (key exhaustion, or a Groq step then a picture step) may be refused for missing thought signatures; Deputy pins Gemini for a whole run to avoid it. Binder carries a 512 KB request as about 800 KB: close to the 1 MB per-process limit (the hub's known open item).

### Strongroom (stream D)
8. Accept that an older build editing a dated pass saves it without the date (neither old decoder keeps unknown keys, and shipped code cannot change), or update the phone and the extension together before using dates. Built additively. Recommended: update both together.
9. Inflow reading `pass` expiry rows: BUILT on `fix/inflow` (counts only, wording "N cards and passes expire this month", my call). Nothing to decide unless you want other wording.
10. Not built, on purpose (a secret would cross apps or need a new native field): a Wi-Fi "Copy password" button, and the TunnelWall and HomeNet links to a Strongroom Wi-Fi entry. Say if you want either.

### OCR (stream E)
11. Size: Nexus grows by about 1.72 MiB (measured on the debug APK, deflated 1,806,493 bytes); Design Editor mobile and Inflow share the module and grow by about 1.8 MB each at their next release (not measured). Option: split the models so only Nexus ships `ara` and `urd`.
12. The confidence filter stays at 40 for every language; a nearly right Arabic line scoring 30 to 40 is dropped (one of four test pictures lost half its lines). Lower it for Arabic and Urdu only if the phone shows the same.
13. Urdu Nastaliq reads poorly (CER 37 to 52 percent on synthetic pictures); the wording says clear printed text and to check the result. Nothing to do unless you want a different engine.
14. CV photo import, Design Editor Copy text and Inflow receipts stay English-only (only Scan text has the language choice); no language auto-detect and no "Arabic and Urdu together" choice. OCR text feeds nothing in Nexus (the Library normalisation is proven by a test, not a screen), and the notices screen for Leptonica, IJG and libpng is still open.

### TunnelWall
15. Pre-existing finding (not changed): `OpenTunnelVpnService.startTunnel` (about line 194) calls `if (armed) holdBlock()` and ignores the result. Path: armed, block held, an engine started since and failed before its own `establish()`, owner switches relay, `holdBlock`'s `establish()` fails: the old block is closed, "not blocking" is published, the service is NOT torn down and the new engine starts, so traffic can leave unprotected until it establishes. Options: (a) call `failStart` when `holdBlock` returns false while armed (recommended: it already holds or ends correctly); (b) keep the old fd and do not publish "not blocking" (risks claiming a block an established engine already replaced); (c) both, with engine-established tracking.

### Docs and housekeeping
16. Remote branches: approve or edit the 37 "merged by squash" deletions (the `git push origin --delete` block in H1 above) and the clean merged-worktree removals (H2). Nothing was deleted.
17. `extension-email-login`: two commits after PR #36 are not on main (the email sign-in walk in `apps/strongroom-extension/test/e2e.mjs` and the deploy facts: migration 0003 applied to live D1, Worker version c3685565). Port them, or leave the branch.
18. `model-host`: Model Host A (recommended in its handoff: stop for this phone, keep the bench), B (build the Picker only) or C (one hour on the MNN-LLM runtime). The branch stays until you answer. `autopilot` (closed PR #46, superseded by #52) can go.
19. Local only: `photo-search` has 6 unpushed handoff-doc commits newer than main's file; `notebox/baseline-single` (12 commits, no remote) is probably superseded by Inflow; uncommitted work sits in the `nexus`, `extension-email-login`, `strongroom-extension`, `sieve` and `photo-search` worktrees.
20. Parked minors (none blocks a merge): Halo test nits (`links.test.ts` line 79 a vacuous `doesNotMatch`, line 89 a regex on implementation text, `LinkTimingTest` lines 79 to 86 a misnamed test); Strongroom `Wifi.kt` line 23 trims U+001C to U+001F and U+FEFF differently from JavaScript (cosmetic, one line); HomeNet residual: two overlapping saves where the first fails leaves the latest ref at the pre-first value (not reachable with controls disabled) and the deleted brittle source test on the BackgroundChecks unlock path goes on the phone list; AI hub: no direct test of `Msg.hasImage` with an object type (the second guard) and a replay refused if a provider ever returns a non-text, non-image content part; Deputy hub: a hub dying mid-call can make step 1 reach both Gemini (via the hub) and the own provider (both owner-configured); Design Editor: its Gradle gate was skipped (no native change), the owner may want it before any release; 3 older lint errors remain.
21. Security reviews: `fix/ai-hub`, `fix/deputy-hub` and `fix/strongroom` were reviewed; `fix/ocr` was not (nothing new leaves the phone; one new input, validated natively and tested); Strongroom's share now carries pass names when "Show names" is on (the owner's existing opt-in, same switch as cards).

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
- `docs/handoffs/phone-checks.md` (new, docs stream): every phone check still not run, per app, in order, with the merge and release order the checks need.
- `docs/handoffs/ecosystem.md`: updated by the docs stream (merged PRs #75 to #111, bracketed notes where the fixes made a statement false, new final section).

## Session log

- 2026-11-25 (coordinator): wave dispatched from origin/main `964e19ab`; baseline test and typecheck recorded; first-wave streams running in parallel, one worktree each (ledger in `fix-work/progress.md`).
- 2026-11-25 (docsa): H1, H2 and H4 research done; this file created; commit "Handoff: ecosystem fixes ledger, branch and worktree classification" on `fix/docs`. No remote branch, worktree or tag was deleted or pushed.
- 2026-11-25 (docsb): G1 doctor run (every app 16/18, same two failures as the baseline), G2 `phone-checks.md` written (all checks NOT RUN, phone untouched), G3 ecosystem.md brought up to what merged and the first wave's now-false statements annotated, H3 docs pass (AGENTS.md AI hub and HomeNet sentences, `pnpm run doctor`, app-link-contract README signing and Nexus sentences), stream results, merge probe (clean on `964e19ab`; one conflict on `8631d144`), PR plan, "Docs still to fix" and the final owner decision list added to this file.

## Current state and exact next step

State (2026-11-25, end of the session): every stream is committed on its `fix/*` branch and has had its reviews; all 12 worktrees are clean and no commit carries a Co-Authored-By or Generated-with line. Final tips: release 9e45b16d, ai-hub f06e5f70, deputy 85abbf53, deputy-hub abc96c02 (contains ai-hub), halo cffc941f, homenet b5a60c74, inflow 2dbe94b8, tunnelwall b2c3256b, strongroom e924043c, ocr fefca1f0, design-editor 6758adf3, docs (this branch). Reviews: code-reviewer on every stream, invariant-reviewer on HomeNet, TunnelWall and release (release needed four rounds; the final rule is the simplest safe one), security-engineer on the hub, Strongroom and (inside its stream) Deputy-on-hub, regression-auditor on every fix wave and on each stream's own commits (all CLEAN or UNTESTED with no incidental change; "UNTESTED" means the auditor could not run Gradle, the stream's own Gradle counts are in "Stream results"). The requirements-verifier mapped every item to evidence. Not done: OCR got no security review (nothing new leaves the phone), put-if-absent APK keys in `tools/store-api` (Worker deploy), the TunnelWall `startTunnel` finding (owner option a/b/c), every phone check, any push, PR, merge or release. Parked minors are in the owner decisions list. The coordinator ledger is `fix-work/progress.md`.

Next, in order:

1. Coordinator, only when the owner says go: re-run `git rev-parse` for the tips and the merge probe against the then-current origin/main (it moved to `8631d144` during the session; the one known conflict is `apps/inflow/package.json`, keep both test entries).
2. Owner: answer the OWNER DECISIONS list above (items 1 to 3 and 15 change code or a Worker; the rest are choices).
3. Owner: approve (or edit) the H1 group a `git push origin --delete` block and the H2 removal blocks; decide on class b and c rows (`extension-email-login`, `model-host`, `autopilot`) and on the Model Host A/B/C question; look at the REAL and REVIEW worktrees (uncommitted work in `nexus`, `extension-email-login`, `strongroom-extension`, `sieve`, `photo-search`).
4. Owner's go for any merge, release or deploy; hub first, then Deputy (C1 before C2).

- 2026-11-25 (coordinator, end of session): all streams closed; regression audits and the requirements check done; final tips above in "Current state".
