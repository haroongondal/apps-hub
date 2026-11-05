# Security fixes (mobile apps), 2026-11-06

## Resume prompt

Read `docs/handoffs/security-fixes.md` in the worktree `.claude/worktrees/security-fixes`
(branch `security-fixes`) completely first. Trust the verified facts below; don't redo that work.
Follow the same handoff contract (update the session log and current state as milestones land).
Continue from "Current state + exact next step".

## Goal and fixed constraints

The owner asked (2026-11-06) to fix, from the device-threat scan of the mobile apps: both Highs,
Medium #4, and every Low. Threat model: the owner is the only user; only external threats to the
phone count (other apps, files/links opened, same Wi-Fi, MITM, hostile relay, compromised server).
Not asked: Medium #3 (TunnelWall kill switch does nothing), #5 (signing key in GitHub secrets),
#6 (Deputy approval card hides the chat/page). Don't commit or push until the owner asks.

## Fix list

| # | App | Fix | Owner of the work |
|---|-----|-----|-------------------|
| H1 | TunnelWall | HTTPS-only relay list; remove vpngate.net cleartext; `remote-cert-tls server` + `verify-x509-name opengw.net name` | agent |
| H2 | Deputy | ask first: typing in browsers, taps on URL-looking labels, tap_at on empty space; verbs pair/forward/dial | agent |
| M4 | TunnelWall | allowlist of .ovpn directives (no writepid/log/etc.) | agent |
| L | TunnelWall firewall | per-uid rule on DNS queries; default-deny unresolved uid | agent |
| L | Deputy | cap/fence replayed memory; spoken task waits for Run; block com.haroon.strongroom | agent |
| L | Strongroom | clipboard clear survives process death; card unlock shows requester | agent |
| L | Strongroom sync branch | release drops INTERNET until BASE_URL set | done (uncommitted, in `.claude/worktrees/strongroom-sync`) |
| L | Store | compiled-in release id → package table checked before install | agent |
| L | PDF/Design editors | CSP on both mobile.html; test pins pdf.js isEvalSupported:false | agent |
| L | PDF editor, HomeNet | drop unused permissions; HomeNet allowBackup=false | agent |
| L | deps | decode-uri-component override if a Metro-safe fixed version exists | agent |

## Verified facts (don't re-derive)

- No app opens a listening socket in production code (only tests).
- Every VPN Gate relay (operator `public-vpn-*` and volunteer rows) presents Let's Encrypt leaf
  CN=opengw.net, SAN `*.opengw.net, opengw.net`, EKU serverAuth; chain YR2 → Root YR → ISRG Root X1.
  Every config's `<ca>` is ISRG Root X1; none of 40 sampled has verify-x509-name, remote-cert-tls,
  tls-auth or tls-crypt. Checked 2026-11-06 with openssl s_client.
- Deputy Policy.kt `standard()` lets plain typing and non-verb taps through without a gate (read it).
- GitHub secrets for the release key and RELEASE_TOKEN are set (created 2026-10-27); CI release job exists.
- Baseline `pnpm test` in the worktree: all packages green before changes.
- Gradle runs go through `scratchpad/gradle-lock.sh` (one build at a time; 16 GB machine).

## Session log

- 2026-11-06: scan done (5 read-only reviews + pnpm audit). Worktree created from main ec23cbd.
  Sync-branch INTERNET fix done and its manifest test passes (6/6). Five fix agents dispatched.
- Store done: `ANDROID_PACKAGES` in packages/store-manifest, used by App.tsx install() and tools/release;
  tests 5/5, 6/6, 10/10; Gradle store-installer + assembleDebug green. `.claude/rules/release-pipeline.md`
  updated (new app needs a Store release first).
- Deputy done: Policy gets `browsers` (DeviceAdapter.browsers()), browser typing / link taps / empty tap_at
  confirm; verbs pair/forward/dial; memory recall cuts labels to 40 chars and is its own message; mic fills the
  field only; Strongroom blocked. Gradle 239 tests green; SPEC/EVAL updated. Phone check: browser list on HyperOS.
- Strongroom done: ClipboardClearJob (JobScheduler, 30 s) + clear-on-focus with token check; unlock screen and
  fingerprint prompt name the requester (all fills). Gradle 280 tests green, release assembles.
  Merge note: strongroom-sync's manifest.test.ts expects exactly autofill + SyncJobService in the vault
  module; it must allow ClipboardClearJob when the branches meet.
- TunnelWall done: HTTPS-only source, cleartext refused (Android NSC base-config false, iOS ATS exceptions gone),
  identity directives injected (ICS parses them into mCheckRemoteCN/mExpectTLSCert), allowlist sanitizer also
  re-applied at connect for cached rows, block-content `<` lines dropped; firewall blocks uid<0 flows (ICMP too)
  and blocked uids' DNS (BlockAll). TS 32/32 + 108/108; Gradle green. Live relay leaf has KU digitalSignature +
  keyEncipherment and EKU serverAuth, so remote-cert-tls server will pass. Docs fixed: open_tunnel_vpn/AGENTS.md
  (OpenCode.md is a symlink to it), network-toolkit spec line on unknown flows.
  Phone checks before shipping: real relay connect; "Unknown app" flows in the firewall log; blocked app DNS.

- Editors done: same CSP in both mobile.html (no unsafe-eval), harness tests block outside requests;
  engine.test.ts pins isEvalSupported:false; PDF Editor + HomeNet permissions removed, HomeNet allowBackup=false.
  decode-uri-component 0.5.1 is ESM-only (breaks query-string 7 under Metro), so I patched 0.2.2 instead
  (`patches/`, `pnpm-workspace.yaml` patchedDependencies): linear decoder, same answers on upstream vectors,
  decodes more on 102/20000 random malformed inputs where the old one left valid escapes. PDF Editor got a `test`
  script + @types/node (same ^22.10.0 as other apps). A leftover `node test/mobile.mjs` (PID 13908) + headless
  Chrome from the editors agent is still running; its kill was denied, so it's left for the owner.
- Full `pnpm test`: 500 pass, 0 fail (baseline 483). `pnpm typecheck` exit 0. Gradle gates ran per app in each
  agent (all green).

- invariant-reviewer: (1) tap_at bypassed the new Deputy gates (hit() almost always returns a node, often an
  unlabelled root) — FIXED: tap_at confirms when target?.label == null and is in the link check; PolicyTest
  `tapAtAsksFirstOnALinkOrWhereNothingIsLabelled` failed first, now 239/239 green + assembleDebug; SPEC §6/§8.2
  updated. (2) stale "scoped cleartext" lines in .claude/agents/invariant-reviewer.md:61,
  .claude/agents/security-engineer.md:44, apps/open_tunnel_vpn/CLAUDE.md:24 — NOT edited (instruction files;
  a subagent's suggestion isn't authority), listed for the owner. (3) ANDROID_PACKAGES trade-off — documented
  in docs/app-store.md §3.
- Session restarted mid code-review (2026-11-06); leftover test process 13908 is gone.

- code-reviewer (resumed): approve with comments. Fixed: Deputy isLink reads childText only for tap_at (a row's
  preview URL no longer gates opening the chat; PolicyTest failed first, 239/239 + assembleDebug green, SPEC
  updated); sanitizer skips `client` inside blocks when choosing where to inject (new test failed first; 33/33;
  all 98 live rows unchanged); DESIGN.md clipboard window corrected (Doze can delay the job); PDF Editor
  @types/node aligned to ^22.10.0. Final `pnpm test` 501/0, typecheck 0.

## Current state + exact next step

All fixes in and verified, uncommitted in this worktree (plus the strongroom-sync worktree edit). Next: owner
decides on (a) the three stale instruction-file lines, (b) commit + PR, (c) the on-phone checks before any
release (real relay connect, firewall "Unknown app" flows and blocked-app DNS incl. whether BlockAll answers get
cached, Deputy browser list on HyperOS, clipboard clear after swipe, card-fill prompt, CSP with evaluateJavascript).
