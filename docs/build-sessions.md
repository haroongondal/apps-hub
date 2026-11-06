# Build sessions: Scan, Reader and the Design Editor media tools

One block below = one new Claude Code chat. Open the chat in
`/Users/outsentia/Documents/apps-hub`, paste the block, and nothing else. The
session reads its own prelude and phase prompt from the docs. These docs are on
`main`, and that checkout may be on another branch that doesn't have them, so
the session makes its worktree first (rule 1) and reads every doc from there.

Plan: `docs/pdf-editor/MERGE.md`. Phase prompts: `docs/pdf-editor/scan/PROMPTS.md`,
`docs/pdf-editor/reader/PROMPTS.md`, `docs/design-editor/PROMPTS.md`. Progress is kept
in each feature's handoff (`docs/handoffs/pdf-editor-scan.md`, `pdf-editor-reader.md`,
`design-editor-media.md`), not here.

## Order

- **S0 first.** It records your decisions and puts these docs on `main`. Every
  phase stops if its approvals aren't recorded.
- **Track A (PDF Editor)** runs one session at a time, in order. Optional sessions
  are marked.
- **Track B (Design Editor)** is independent of Track A. A Track B session can run
  at the same time as a Track A session, because each works in its own worktree.
- **If a session ends mid-phase** (context full), it prints a resume prompt. Paste
  that into a new chat to finish the phase, then go on to the next block here.

| Session | Track | Work | Branch | Needs first |
| --- | --- | --- | --- | --- |
| S0 | both | Owner decisions; docs onto `main` | `docs-offline-tools` | none |
| A1 | PDF Editor | Scan Phase 1: Library foundation | `scan-phase-1` | S0 |
| A2 | PDF Editor | Scan Phase 2: camera and detection | `scan-phase-2` | A1 merged |
| A3 | PDF Editor | Scan Phase 3: pages and PDF | `scan-phase-3` | A2 merged |
| A4 | PDF Editor | Scan Phase 4: text recognition, searchable PDF | `scan-phase-4` | A3 merged |
| A5 | PDF Editor | Reader Phase 1: capture (no release) | `reader-phase-1-2` | A4 merged |
| A6 | PDF Editor | Reader Phase 2: reader view | `reader-phase-1-2` (same) | A5 |
| A7 | PDF Editor | Reader Phase 2b: highlights and notes | `reader-phase-2b` | A6 merged |
| A8 | PDF Editor | Reader Phase 3: pending and offline saves | `reader-phase-3` | A7 merged |
| A9 | PDF Editor | Reader Phase 4: EPUB and PDF export | `reader-phase-4` | A8 merged |
| A10 | PDF Editor | Reader Phase 5: listen on Android (no release) | `reader-phase-5-6` | A9 merged |
| A11 | PDF Editor | Reader Phase 6: listen everywhere | `reader-phase-5-6` (same) | A10 |
| A12 | PDF Editor | Scan Phase 5: hardening | `scan-phase-5` | A11 merged |
| A13 | PDF Editor | Reader Phase 7: import | `reader-phase-7` | A12 merged |
| A14 | PDF Editor | Scan Phase 6: iOS (optional) | `scan-phase-6` | A12 merged |
| A15 | PDF Editor | Reader Phase 8: iOS (optional) | `reader-phase-8` | A14 merged |
| B0 | Design Editor | Finish and ship the unmerged multi-page branch | `design-editor-phase-2` (exists) | S0 |
| B1 | Design Editor | Media Phase 1: media-core and the phone encoder spike | `design-media-phase-1` | S0 |
| B2 | Design Editor | Media Phase 2: Mac media tools | `design-media-phase-2` | B0 and B1 merged |
| B3 | Design Editor | Media Phase 3: engine extraction, mobile canvas | `design-media-phase-3` | B2 merged |
| B4 | Design Editor | Media Phase 4: Android media screens | `design-media-phase-4` | B3 merged |
| B5 | Design Editor | Media Phase 5: batch queue, background work | `design-media-phase-5` | B4 merged |
| B6 | Design Editor | Media Phase 6: iOS (optional) | `design-media-phase-6` | B5 merged |

S0 (2026-10-31) put the scanner before the reader (MERGE.md question A3), so
Scan Phases 2–4 are A2–A4 and the Reader starts at A5. S0 also added Reader
Phase 2b (highlights and notes) as A7. Branch every session from `main` after
the previous one is merged.

Shared files can conflict when both tracks are open: `pnpm-lock.yaml`,
`tools/release/src/apps.ts`, `packages/ui/src/tokens.ts`, `AGENTS.md` and
`docs/app-store.md`. Merge one PR at a time, and rebase the other branch before
its PR.

## How every session runs

Each session prompt points here. These rules cover the git and session flow
around the phase prompt.

1. **Worktree, never the main checkout.** The main checkout holds other work
   that isn't committed. Run `git fetch origin`, then:
   - a new branch: `git worktree add .claude/worktrees/<branch> -b <branch> origin/main`;
   - an existing branch: `git worktree add .claude/worktrees/<branch> <branch>`,
     or reuse that worktree if it is already there.

   Do this before reading any doc. The main checkout can be on a branch without
   these docs, so read this file, your handoff and the PROMPTS.md from the
   worktree (if the paths aren't in the checkout yet, `git show origin/main:<path>`
   gets you started).

   Work only in that worktree and run `pnpm install` there. Wherever the docs
   say "Project root: /Users/outsentia/Documents/apps-hub", read the worktree path.
   Never stash, reset or commit changes you didn't make.
2. **Handoff first.** Read the feature handoff named in your prompt completely
   before anything else. Trust its decisions and verified facts; don't redo
   them. Follow the handoff contract in `~/.claude/CLAUDE.md`. If the handoff
   says your phase is already under way, continue from its exact next step.
3. **Prerequisites.** Check the "Needs first" column for your session against
   `git log origin/main` and the handoff. If one isn't met, stop and say which.
4. **Instructions.** Read the PROMPTS.md named in your prompt. Do its "Prelude"
   block, then your phase block, as written.
5. **Owner gates.** Your phase may need a decision or a dependency approval that
   the handoff doesn't record. Ask me with AskUserQuestion, recommended option
   first. Record the answer, dated, under "Decisions made" in the handoff, then
   carry on.
6. **Verify.** Run the phase's verification commands and report their actual
   output, never predicted output. A failing command is reported as failing.
7. **Finish.** Update the handoff's session log and "Current state + exact
   next step". Name the next session id from the table above. Then ask me which
   of these I want:
   - **Release for a phone test:** the phase's own `pnpm release` line. Confirm
     the Cloudflare account first. The phone installs through the Store only.
   - **Ship:** the pr-shipper agent reviews, fixes and opens one PR into `main`.
     Merging it makes CI release the app.
   - **Stop here.**

   Never merge to `main` yourself. A session marked "(no release)" never ships;
   the next session continues on the same branch.
8. **Context.** At about 85% context, stop starting new work. Update the
   handoff, print its resume prompt in a fenced block for me, and end the turn.

## S0: decisions and docs onto main

```text
Build session S0: owner decisions for Scan, Reader and the Design Editor media tools, then put the planning docs on main. No app code.

1. Read docs/build-sessions.md and docs/pdf-editor/MERGE.md. Then read the "Open questions for the owner" section (§10) of docs/pdf-editor/scan/PRD.md, docs/pdf-editor/reader/PRD.md and docs/design-editor/PRD.md. Then read the dependency proposals: scan SPEC §2, reader SPEC §1.2 and design-editor SPEC §3.
2. Ask me every open question with AskUserQuestion: up to 4 per call, the docs' recommended option first, each with its one-line reason. Order: MERGE.md group A (shared), then Scan, Reader, Design Editor. For each feature, ask for dependency approval as one multi-select question.
3. Record each answer, dated, under "Decisions made" in the matching handoff: docs/handoffs/pdf-editor-scan.md, pdf-editor-reader.md or design-editor-media.md. A shared answer goes in every handoff it affects and in MERGE.md.
4. If an answer departs from a recommendation, update the PRD, SPEC and PROMPTS sections it changes, and the session table in docs/build-sessions.md. Examples: OpenCV instead of the Kotlin detector, the scanner before the reader, a minimum Android version. Tell me what you changed.
5. The docs are untracked files in the main checkout, and that checkout is on another branch with uncommitted work. Don't touch that work. Run: git fetch origin && git worktree add .claude/worktrees/docs-offline-tools -b docs-offline-tools origin/main. Copy in exactly these paths: docs/build-sessions.md, docs/pdf-editor/, docs/design-editor/, docs/handoffs/pdf-editor-scan.md, docs/handoffs/pdf-editor-reader.md, docs/handoffs/design-editor-media.md. Nothing else (strongroom, network-toolkit and superpowers docs belong to other sessions). Commit them there and use the pr-shipper agent to open the PR. These are docs only, so CI releases no app. Then delete the copied originals from the main checkout so there is one copy, but only after I confirm the PR is merged.
```

## Track A: PDF Editor

The order is the owner's choice from S0 (2026-10-31): the scanner (Scan Phases 2–4)
before the Reader.

### A1: Scan Phase 1, Library foundation

```text
Build session A1: PDF Editor, Scan Phase 1 (Library foundation).
Branch: scan-phase-1, new from main. Handoff: docs/handoffs/pdf-editor-scan.md.
Phase: docs/pdf-editor/scan/PROMPTS.md, its prelude, then "Phase 1".
Follow "How every session runs" in docs/build-sessions.md.
Reader builds on this Library: keep the contract in docs/pdf-editor/scan/SPEC.md §4 exactly. The Reader docs already map onto it (docs/pdf-editor/reader/SPEC.md §5).
Search normalises Arabic and Urdu from v1 (S0 decision, SPEC §4.3).
```

### A2: Scan Phase 2, camera and detection

```text
Build session A2: PDF Editor, Scan Phase 2 (Camera and detection).
Branch: scan-phase-2, new from main (A1 must be merged). Handoff: docs/handoffs/pdf-editor-scan.md.
Phase: docs/pdf-editor/scan/PROMPTS.md, its prelude, then "Phase 2".
Follow "How every session runs" in docs/build-sessions.md.
This phase removes the unused permissions, turns Android backup off and switches the app to arm64 only (decisions recorded in S0).
```

### A3: Scan Phase 3, pages and PDF

```text
Build session A3: PDF Editor, Scan Phase 3 (Pages and PDF).
Branch: scan-phase-3, new from main (A2 must be merged). Handoff: docs/handoffs/pdf-editor-scan.md.
Phase: docs/pdf-editor/scan/PROMPTS.md, its prelude, then "Phase 3".
Follow "How every session runs" in docs/build-sessions.md.
ScanStore.pageTexts(itemId) lands here; the Reader's read-aloud uses it later. Keep that name and its string[]-in-page-order shape.
```

### A4: Scan Phase 4, text recognition and searchable PDF

```text
Build session A4: PDF Editor, Scan Phase 4 (Text recognition and searchable PDF).
Branch: scan-phase-4, new from main (A3 must be merged). Handoff: docs/handoffs/pdf-editor-scan.md.
Phase: docs/pdf-editor/scan/PROMPTS.md, its prelude, then "Phase 4".
Follow "How every session runs" in docs/build-sessions.md.
```

### A5: Reader Phase 1, capture (no release)

```text
Build session A5: PDF Editor, Reader Phase 1 (Capture).
Branch: reader-phase-1-2, new from main (A4 must be merged). Handoff: docs/handoffs/pdf-editor-reader.md.
Phase: docs/pdf-editor/reader/PROMPTS.md, its prelude, then "Phase 1".
Follow "How every session runs" in docs/build-sessions.md.
Scan Phases 2–4 are already on main. Keep the app manifest as Scan left it (CAMERA, the tools:node="remove" entries, allowBackup="false", arm64 only) when you add the share filter.
This phase has no release. Don't ship; A6 continues on the same branch.
```

### A6: Reader Phase 2, reader view

```text
Build session A6: PDF Editor, Reader Phase 2 (Reader view).
Branch: reader-phase-1-2, existing (continue from A5). Handoff: docs/handoffs/pdf-editor-reader.md.
Phase: docs/pdf-editor/reader/PROMPTS.md, its prelude, then "Phase 2".
Follow "How every session runs" in docs/build-sessions.md.
This phase adds the sepia palette to packages/ui/src/tokens.ts. Rebuild the CSS (pnpm --filter @apps-hub/ui build:css) and keep the ui contrast test green for every brand.
This is the first Reader release. Before it, ask me the app's display name (S0 deferred it to here) and record the answer.
```

### A7: Reader Phase 2b, highlights and notes

```text
Build session A7: PDF Editor, Reader Phase 2b (Highlights and notes).
Branch: reader-phase-2b, new from main (A6 must be merged). Handoff: docs/handoffs/pdf-editor-reader.md.
Phase: docs/pdf-editor/reader/PROMPTS.md, its prelude, then "Phase 2b".
Follow "How every session runs" in docs/build-sessions.md.
```

### A8: Reader Phase 3, pending and offline saves

```text
Build session A8: PDF Editor, Reader Phase 3 (Pending and offline saves).
Branch: reader-phase-3, new from main (A7 must be merged). Handoff: docs/handoffs/pdf-editor-reader.md.
Phase: docs/pdf-editor/reader/PROMPTS.md, its prelude, then "Phase 3".
Follow "How every session runs" in docs/build-sessions.md.
```

### A9: Reader Phase 4, export as EPUB and PDF

```text
Build session A9: PDF Editor, Reader Phase 4 (Export as EPUB and PDF).
Branch: reader-phase-4, new from main (A8 must be merged). Handoff: docs/handoffs/pdf-editor-reader.md.
Phase: docs/pdf-editor/reader/PROMPTS.md, its prelude, then "Phase 4".
Follow "How every session runs" in docs/build-sessions.md.
Exports carry highlights and notes (S0 decision, Reader SPEC §8.5).
```

### A10: Reader Phase 5, listen on Android (no release)

```text
Build session A10: PDF Editor, Reader Phase 5 (Listen on Android).
Branch: reader-phase-5-6, new from main (A9 must be merged). Handoff: docs/handoffs/pdf-editor-reader.md.
Phase: docs/pdf-editor/reader/PROMPTS.md, its prelude, then "Phase 5".
Follow "How every session runs" in docs/build-sessions.md.
This phase has no release. Don't ship; A11 continues on the same branch.
```

### A11: Reader Phase 6, listen everywhere

```text
Build session A11: PDF Editor, Reader Phase 6 (Listen everywhere).
Branch: reader-phase-5-6, existing (continue from A10). Handoff: docs/handoffs/pdf-editor-reader.md.
Phase: docs/pdf-editor/reader/PROMPTS.md, its prelude, then "Phase 6".
Follow "How every session runs" in docs/build-sessions.md.
Scan read-aloud reads ScanStore.pageTexts (Scan Phase 3) and needs the OCR text from Scan Phase 4. Check that both are on main.
```

### A12: Scan Phase 5, hardening

```text
Build session A12: PDF Editor, Scan Phase 5 (Hardening).
Branch: scan-phase-5, new from main (A11 must be merged). Handoff: docs/handoffs/pdf-editor-scan.md.
Phase: docs/pdf-editor/scan/PROMPTS.md, its prelude, then "Phase 5".
Follow "How every session runs" in docs/build-sessions.md.
The phone sweep covers the whole app, Reader included. Log Reader failures in docs/handoffs/pdf-editor-reader.md instead of fixing them here.
```

### A13: Reader Phase 7, import

```text
Build session A13: PDF Editor, Reader Phase 7 (Import from Pocket, Instapaper and bookmarks).
Branch: reader-phase-7, new from main (A12 must be merged). Handoff: docs/handoffs/pdf-editor-reader.md.
Phase: docs/pdf-editor/reader/PROMPTS.md, its prelude, then "Phase 7".
Follow "How every session runs" in docs/build-sessions.md.
S0 recorded that I have a bookmarks file, an Instapaper CSV and a Pocket export from before Oct 2025, so this phase runs. Ask me for the files when the phone test needs them; never commit them.
```

### A14 (optional): Scan Phase 6, iOS

```text
Build session A14: PDF Editor, Scan Phase 6 (iOS). Optional.
Branch: scan-phase-6, new from main (A12 must be merged). Handoff: docs/handoffs/pdf-editor-scan.md.
Phase: docs/pdf-editor/scan/PROMPTS.md, its prelude, then "Phase 6 (optional): iOS".
Follow "How every session runs" in docs/build-sessions.md.
There is no paid Apple account: the gate is the simulator build, with no Store release.
```

### A15 (optional): Reader Phase 8, iOS

```text
Build session A15: PDF Editor, Reader Phase 8 (iOS). Optional.
Branch: reader-phase-8, new from main (A14 must be merged). Handoff: docs/handoffs/pdf-editor-reader.md.
Phase: docs/pdf-editor/reader/PROMPTS.md, its prelude, then "Phase 8 (optional): iOS".
Follow "How every session runs" in docs/build-sessions.md.
There is no paid Apple account: the gate is the simulator build, with no Store release.
```

## Track B: Design Editor

### B0: finish the multi-page Design Editor branch

```text
Build session B0: finish and ship the unmerged Design Editor branch design-editor-phase-2 (multi-page designs, bundled fonts, real PDF text).
Worktree: git fetch origin && git worktree add .claude/worktrees/design-editor-phase-2 design-editor-phase-2 (reuse it if it exists). Handoff: docs/handoffs/design-editor-phase-2.md on that branch.
Follow "How every session runs" in docs/build-sessions.md, points 1, 2, 6, 7 and 8. There is no PROMPTS.md: the handoff's "Current state and next step" is the task.
Its last state: e2e green, waiting for my hand check. Run pnpm --filter design-editor test:e2e, start the app for me (pnpm --filter design-editor start), and walk me through the hand check the handoff lists. Fix what I find. When I say ship, rebase on main and use the pr-shipper agent. The Design Editor isn't a Store app, so merging releases nothing.
```

### B1: Media Phase 1, media-core and the phone encoder spike

```text
Build session B1: Design Editor media tools, Phase 1 (media-core and the Android encoder spike).
Branch: design-media-phase-1, new from main. Handoff: docs/handoffs/design-editor-media.md.
Phase: docs/design-editor/PROMPTS.md, its prelude, then "Phase 1".
Follow "How every session runs" in docs/build-sessions.md.
This phase registers the new Store app (release id design-editor) and releases from this branch for the phone spike. Ship only after the spike results are in the handoff.
```

### B2: Media Phase 2, Mac media tools

```text
Build session B2: Design Editor media tools, Phase 2 (Mac media tools).
Branch: design-media-phase-2, new from main (B0 and B1 must be merged). Handoff: docs/handoffs/design-editor-media.md.
Phase: docs/design-editor/PROMPTS.md, its prelude, then "Phase 2".
Follow "How every session runs" in docs/build-sessions.md.
The Mac editor on main is now multi-page (file format v2, from B0). The media window must not break its e2e or its autosave.
```

### B3: Media Phase 3, engine extraction and the mobile canvas

```text
Build session B3: Design Editor media tools, Phase 3 (engine extraction and the mobile canvas).
Branch: design-media-phase-3, new from main (B2 must be merged). Handoff: docs/handoffs/design-editor-media.md.
Phase: docs/design-editor/PROMPTS.md, its prelude, then "Phase 3".
Follow "How every session runs" in docs/build-sessions.md.
Extract the multi-page editor that is on main (file format v2, page strip, bundled fonts), not the single-page one the SPEC describes. Update SPEC §14 where it assumes one page.
```

### B4: Media Phase 4, Android media screens

```text
Build session B4: Design Editor media tools, Phase 4 (Android media screens).
Branch: design-media-phase-4, new from main (B3 must be merged). Handoff: docs/handoffs/design-editor-media.md.
Phase: docs/design-editor/PROMPTS.md, its prelude, then "Phase 4".
Follow "How every session runs" in docs/build-sessions.md.
```

### B5: Media Phase 5, batch queue and background work

```text
Build session B5: Design Editor media tools, Phase 5 (batch queue and background work).
Branch: design-media-phase-5, new from main (B4 must be merged). Handoff: docs/handoffs/design-editor-media.md.
Phase: docs/design-editor/PROMPTS.md, its prelude, then "Phase 5".
Follow "How every session runs" in docs/build-sessions.md.
```

### B6 (optional): Media Phase 6, iOS

```text
Build session B6: Design Editor media tools, Phase 6 (iOS). Optional.
Branch: design-media-phase-6, new from main (B5 must be merged). Handoff: docs/handoffs/design-editor-media.md.
Phase: docs/design-editor/PROMPTS.md, its prelude, then "Phase 6 (optional): iOS".
Follow "How every session runs" in docs/build-sessions.md.
There is no paid Apple account: the gate is the simulator build, with no Store release.
```
