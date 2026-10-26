---
name: qa
description: Test a change the way users experience it - on an attached Android device or emulator, the iOS simulator, or the store Worker's tests - with the qa-engineer agent.
argument-hint: "[change or feature to test, acceptance criteria]"
disable-model-invocation: true
context: fork
agent: qa-engineer
---

Test this change: $ARGUMENTS

If nothing is named above, test the uncommitted changes plus `git diff main...HEAD`. Use the devices
and simulators already attached; do not install builds on a real device unless the request above says
so. Return your report in the format your instructions define.
