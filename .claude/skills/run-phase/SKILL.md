---
name: run-phase
description: Execute one numbered implementation phase of an apps-hub app (NetLens phases in docs/netlens/PROMPTS.md, OpenTunnel phases in apps/open_tunnel_vpn/.opencode/commands/phase<N>.md) - check the previous phase is done, build exactly this phase with the right agents, run its verification commands, and check it against the phase's requirements. One phase per session, strictly in order.
argument-hint: "<netlens|opentunnel> <phase number>"
disable-model-invocation: true
---

Run this phase: $ARGUMENTS

## 1. Find the phase

| App | Phase text | Requirements and design |
|---|---|---|
| `netlens` | `docs/netlens/PROMPTS.md`, the `## Phase <N>` section and the prelude | `docs/netlens/PRD.md` (the FR, NFR and AC ids the phase names), `docs/netlens/SPEC.md` |
| `opentunnel` | `apps/open_tunnel_vpn/.opencode/commands/phase<N>.md` | `apps/open_tunnel_vpn/AGENTS.md`, and any plan the phase file names (`apps/open_tunnel_vpn/docs/phase2-plan.md` for phase 2) |

If the app or number is missing or the phase does not exist, stop and ask. Read the root `AGENTS.md`,
the phase text and every document it names, in full, before anything else.

## 2. Check the order

Phases run strictly in order, one per session. Find the state:

```bash
git log --oneline | grep -iE 'phase [0-9]'
git status --short
```

and the status section of the app's docs (`apps/open_tunnel_vpn/AGENTS.md` "Platform Setup
Status"). If the previous phase has no commit saying it was verified, or uncommitted work in the tree
belongs to a different phase, stop and tell the user what you found. Do not start a later phase to
"get ahead", and do not finish an earlier one silently.

## 3. Plan

Turn the phase text into numbered acceptance criteria, keeping its words and its PRD ids, plus its
verification commands as criteria of their own. Show them to the user with the split of work:

- pure TypeScript (packages, the app's `src/`): `product-engineer`
- anything in `apps/*/modules/*`, `android/`, `ios/`, manifests, services or extensions:
  `native-module-engineer`

Give each agent the criteria it owns, the documents to read and the hard rules that apply. Native work
the TS depends on goes first. For a small phase, do it yourself under the same instructions.

## 4. Build and verify

Dispatch the agents, then run the phase's own verification commands yourself, exactly as the phase
text gives them (with `JAVA_HOME` and `ANDROID_HOME` from `AGENTS.md`), and quote real output. A
command that cannot run (the iOS packet tunnel target not created yet, no device) is reported as not
run, with the reason; it is never reported as passing.

Then dispatch `requirements-verifier` with the acceptance criteria verbatim, and `invariant-reviewer`
over the working tree. Fix what they find within the phase's scope and verify again.

## 5. Stop

Report: each criterion as met, partial, not met or unverified with its evidence; the verification
output; review findings and what was done about them; blockers; what needs a real device. Do not start
the next phase and do not commit. If every criterion is met, suggest `/ship-pr` or a commit titled
`Phase <N> verified: <summary>` so the next run of this skill can find it.
