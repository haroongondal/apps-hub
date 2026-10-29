# OpenTunnel: country dropdown + "can't connect to any VPN"

## Resume prompt (2026-10-28)

Read `docs/handoffs/opentunnel-country-and-connect.md` completely first. Trust the
verified facts below and do not redo that work. Follow the same handoff contract
(update the session log and current state as milestones land). Continue from
"Current state + exact next step".

## Goal and fixed constraints

- User asked (2026-10-28): (1) a drop-down to select the country in OpenTunnel;
  (2) fix "unable to connect to any VPN" on their Android phone (wireless debugging on).
- Install on the phone only through the Store app, never `adb install`
  (memory `install-via-store-only`). adb is fine for logcat, screenshots, taps.
- Phone: Xiaomi 24116RACCG, Android 16, serial
  `adb-49kjmnuwonkffqzh-zHnffO (2)._adb-tls-connect._tcp` (the non-"(2)" one dropped).

## Verified facts (do not re-derive)

- Phone had OpenTunnel 1.1.0 (versionCode 4). Failing attempt: cached "US" relay;
  ics-openvpn notification looped "Connecting (TCP)" / "Waiting 2s seconds between
  connection attempt" until our 30 s timeout. Live VPN Gate list had no US relay.
- Network is fine: from the Mac (same Wi-Fi) 81/98 live relays answer an OpenVPN
  HARD_RESET (scratch probe); from the phone shell `toybox nc` reaches 219.100.37.x:443.
- Engine is fine: after a list refresh, tapping public-vpn-37 (219.100.37.1:443 tcp)
  gave "Connected: SUCCESS", tun0 10.233.36.81, exit `JP 219.100.37.233` via ip-api.
- Phone showed "Couldn't load the server list — VpnGateFetchException: all 3 sources
  failed (Aborted)" once; a later refresh succeeded (not reproduced on demand).
- RN 0.81 `fetch` = whatwg-fetch 3.6.20, resolves in `xhr.onload` (after the whole
  body), so core's `onHeaders` fired only after the 1.3 MB download, i.e. the download
  ran under the 15 s connect deadline. From this network HTTPS takes ~3.7 s, HTTP ~16 s
  (so the HTTP fallbacks could never succeed in the app).
- App reloaded the list only when the cache was empty (also true in build 3).
- Native probes (Kotlin + Swift) counted ECONNREFUSED as a live relay with RTT
  (copied from NetLens rule #2); the TS contract and the Node probe say null.
  A failed probe falls back to the listed ping in `computeFitnessScore`.
- No Kotlin changed between the working build 3 (a03ebb0) and 1.1.0.

- Emulator (root, ics binary run by hand with a tiny management responder that answers
  NEED-OK): of 5 reachable relays, 3 PUSH_REPLY and 2 AUTH_FAILED (vpn/vpn creds don't
  help). So some volunteer relays refuse this client by their own policy; client is fine.
- A fresh VPN Gate list still has ~half the KR relays dead from this network (refused,
  unreachable, timeout). VPN Gate returns a different subset on each fetch.
- Old ranking: a failed probe fell back to the listed ping (often 1-30 ms), so dead relays
  outranked measured ones (phone showed "vpn975520107 · 2 ms listed" above a measured one).
- Old UX: the big button after a failure, and after every app start (restored lastNodeId),
  retried the same relay.

## Decisions (with why)

- Refresh the relay list on every app open (cache still shown first): relays churn hourly.
- `apps/open_tunnel_vpn/src/data/vpngate-fetcher.ts`: XHR fetcher that calls
  `onHeaders` at readyState 2, injected in App.tsx. Core default fetcher kept for Node.
- Native probe: refused = no measurement (relay port closed = relay down), both platforms.
- Load all cached relays (dropped LIST_LIMIT 60): cache = one fetch (~100 rows), and the
  dropdown must offer every country.
- Country dropdown = inline expanding "Country" row at the top of the Servers group
  (kit has no dropdown). Filters the server sheet, the Scan/auto-select pool, the count
  pill; choosing another country clears a non-live activeNode from a different country.
  Not persisted across launches (not asked).
- `LatencyProber` sorts relays that answered the probe first, then by fitness (+ test).
- Failover: auto-select tries up to 3 best relays in order (`settled()` in tunnel-client.ts
  waits for connected/error/disconnected), skipping relays that already failed this session
  (`failedIds`, recorded by an effect on tunnel.state === 'error').
- Big button in the error state runs auto-select ("Tap to find another relay").
- lastNodeId label is restored only when the tunnel is still running (its documented purpose).
- Version 1.2.0.

## File map

- `apps/open_tunnel_vpn/App.tsx` — refresh on open, XHR fetcher, country state/filter.
- `apps/open_tunnel_vpn/src/ui/home-screen.tsx` — Country dropdown rows.
- `apps/open_tunnel_vpn/src/ui/format.ts` — `countryCode`, `countryOptions` (+ test).
- `apps/open_tunnel_vpn/src/data/vpngate-fetcher.ts` (+ `__tests__/vpngate-fetcher.test.ts`).
- `apps/open_tunnel_vpn/modules/open-tunnel-native/android/.../NativeTcpProbe.kt`
  (+ `src/test/.../NativeTcpProbeTest.kt`), `ios/OpenTunnelNativeModule.swift`.

## Session log

- s1 (2026-10-28): diagnosed on the phone (above). Implemented all decisions.
  `pnpm test` 167/167, `pnpm typecheck` exit 0, `:open-tunnel-native:testDebugUnitTest`
  2/2. `pnpm release open-tunnel` was blocked by the auto-mode permission classifier
  (production deploy): needs the user's go-ahead. Nothing committed.

- s1 later: ranking fix, failover, error-state button, lastNode restore fix. App tests pass,
  typecheck clean. Emulator: country dropdown works (97 relays, KR 30), fresh list in ~7 s.

- s1 end: emulator (local release build, shared key) — Korea selected, big button: connected
  to vpn610812005 in ~6 s, tun0 up, exit `KR 49.168.191.160`; disconnected after.
  `pnpm test` 169/169, `pnpm typecheck` exit 0, JVM 2/2, `:app:assembleRelease` exit 0,
  iOS simulator build exit 0 (Swift unchanged after that build).

- s2 (2026-10-29): auto-reconnect after a mid-session drop. User: "if a relay or auth error
  disconnects the VPN, connect to a new best relay after a cache refresh". App.tsx: on the switch
  connected/reasserting -> error, mark the relay failed, refetch the list, run the 3-try failover on
  it (falls back to the cached list if the refetch fails). Found on the emulator (API 35): ~5 s after
  the app's last foreground service stops, Android cuts its network in the background, so the
  refetch and probes died. Fix: OpenVpnEngine.fail() releases with EXTRA_HOLD when the tunnel was up;
  OpenTunnelVpnService then keeps its foreground service for up to 60 s (any new command cancels it).
  Verified on the emulator with a temporary hack (openvpn exit -> error, since removed): app in the
  background, kill openvpn -> new relay in 16 s, list refetched, no socket kill. pnpm test all green,
  typecheck exit 0, :open-tunnel-native:testDebugUnitTest + :app:assembleDebug exit 0. Not committed
  (branch deputy-phase-2 carries unrelated Deputy work).

## Current state + exact next step

- 2026-10-29: 1.2.0 is committed (c09cec4) and on the phone. The s2 change still needs a version bump
  and `pnpm release open-tunnel` (production deploy: needs the user's go-ahead), then an update
  through the Store on the phone.


- All changes uncommitted on `main`. Phone still on OpenTunnel 1.1.0 and was left
  CONNECTED to public-vpn-37 (Japan) from the s1 test; phone locked, adb can't stop it
  (service not exported): the user taps the big button to disconnect.
- Next: user allows/runs `pnpm release open-tunnel -m "Choose a country. The server list
  now refreshes every time you open the app, and failed relays are skipped automatically."`
  (auto-mode blocked it as a production deploy). Then update OpenTunnel through the Store
  on the phone and check: Country dropdown, big button connects in the chosen country.
- Not done: commit (user didn't ask), country choice not persisted across launches.
