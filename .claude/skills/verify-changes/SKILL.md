---
name: verify-changes
description: Run the TS tests and typecheck for the affected packages, the native Android/iOS gates when native code changed, or the full matrix, with the repo-verifier agent, and get a short pass/fail report.
argument-hint: "[changed | full | native [app] | <package or test file>]"
disable-model-invocation: true
context: fork
agent: repo-verifier
---

Verify the repository. Scope: $ARGUMENTS

If no scope is given above, use `changed` against `main`. Return your report in the format your
instructions define.
