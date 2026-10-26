---
name: ship-pr
description: Review, fix and ship the current work as a GitHub pull request into main with the pr-shipper agent (baseline, reviewer panel, fixes under a behaviour-preservation contract, verification, gh CLI).
argument-hint: "[what to ship, e.g. 'the NetLens ping engine' or paths] [dry run]"
disable-model-invocation: true
---

Ship this work as a pull request: $ARGUMENTS

1. **The work.** From `git status --short --untracked-files=all`, decide which paths belong to it.
   If the request above does not make that clear, ask the user. Everything else in the tree is left
   alone; say which files you are leaving out.
2. **The requirements.** Collect what the user asked for, in their words, from this conversation,
   plus any acceptance criteria, PRD ids (FR, NFR, AC) or phase prompt. If you cannot find them, ask.
3. **Dispatch `pr-shipper`** in the foreground with: the exact paths of the work, the requirements
   verbatim, and `dry run` if the user asked for one. Pass no attribution: the agent adds no
   `Co-Authored-By` trailer, and Claude is never the author or committer of its commits. It records
   a baseline, runs its reviewer panel, fixes what survives triage, re-audits its fixes, verifies,
   and opens the PR with `gh`, or stops at a gate.
4. Relay its report: the verdict (READY, NO SUITE, OPEN QUESTIONS, BLOCKED or DRY RUN), the PR link,
   behaviour changes, baseline against final, deferred and rejected findings, CI state, and anything
   that needs the user's decision.
5. **No verdict line means BLOCKED** (it crashed, ran out of room or stopped midway). Then show the
   user what may have been left behind: `git worktree list`,
   `gh pr list --repo haroongondal/apps-hub --author @me --state open`,
   and `git ls-remote --heads origin` (a branch pushed before `gh pr create` failed).
