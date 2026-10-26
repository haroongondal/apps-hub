---
name: review-invariants
description: Review a change against the hard platform, privacy and security rules of the apps-hub apps (NetLens scanning, OpenTunnel, the store pipeline) with the invariant-reviewer agent.
argument-hint: "[commit range, branch, or 'working tree']"
disable-model-invocation: true
context: fork
agent: invariant-reviewer
---

Review this change for broken rules: $ARGUMENTS

If no change is named above, review `git diff main...HEAD` together with the uncommitted changes in the
working tree. Follow your method and return your report in the format your instructions define.
