---
name: threat-model
description: Threat-model a proposed feature or design, audit an area, or check release readiness, with the security-engineer agent.
argument-hint: "[feature, design document or area to examine]"
disable-model-invocation: true
context: fork
agent: security-engineer
---

Examine this: $ARGUMENTS

If it is a proposed feature or design, produce a threat model. If it names existing code or an area,
audit it. If it mentions a release, signing, secrets or permissions, run the release-readiness check.
Return your report in the format your instructions define.
