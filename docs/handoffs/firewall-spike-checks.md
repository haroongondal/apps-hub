# Firewall spike: the three open checks (owner's phone)

Run on the **Firewall spike build 3** (build 2 cannot do check 3: it ignores a start with no
action). Do all three checks on build 3 so the battery nights use one build. Results go into
`docs/handoffs/firewall-spike-results.md` and amend the design's Reboot, DNS and Risks sections.

How to report: in the spike, tap **Copy log**, paste it into the chat. The log shows the last
200 lines.

## 1. Private DNS: Automatic (about 5 minutes)

1. Settings, search "Private DNS", choose **Automatic**.
2. Spike: **Start firewall** (accept the VPN prompt if it appears).
3. Open Chrome and load three or four sites; refresh Gmail.
4. Spike: **Copy log**.

Pass: the sites load, and the log has `private dns: blocked DNS-over-TLS to the tun DNS from uid
... (logged once)` plus `dns <site> status=... via ...` lines, with no crash (the status line
says RUNNING).
Fail: sites don't load, there are no `dns` lines, or the firewall stops.

## 2. Private DNS: Strict (about 5 minutes)

1. Spike: **Stop firewall**. Settings, Private DNS, **Private DNS provider hostname**, enter
   `dns.google`.
2. Spike: **Start firewall**. Load the same sites.
3. Spike: **Copy log**.

Expected, from the design (this check confirms or refutes it): the sites load; there are no
`dns <site>` lines for websites because Android sends its own DNS-over-TLS; the log shows flows
to the provider's address on port 853 with verdict Exit. Set Private DNS back to your usual
setting afterwards.

## 3. Always-on after a reboot (about 5 minutes)

1. Spike: **Stop firewall**. Settings, Network, VPN, the gear next to "Firewall spike", turn on
   **Always-on VPN**. Leave "Block connections without VPN" **off**.
2. Reboot. Unlock. **Do not open the spike app.**
3. Look at the status bar for the VPN key icon and at Settings, VPN, for which session is
   connected. Then open the spike and **Copy log**.

Pass: the log has `onStartCommand action=null` and then `started:`; the system picked the
firewall's service.
Interesting fail: no `onStartCommand` line and no VPN after the reboot. The package declares
four services with the `android.net.VpnService` filter (the firewall, `OpenTunnelVpnService`,
WireGuard's and ics-openvpn's); the system picked another one. That changes the design (only the
firewall service would keep the filter, or the controller starts it from a boot receiver).

Turn Always-on off when done.

## 4. Battery, two nights

Same phone, same Wi-Fi, not charging, both nights started at the same level (80% or more),
screen off for 8 hours, same Do Not Disturb setting. Write down the battery percentage at bedtime
and when you wake up.

- Night A: **Start firewall**, check the spike notification is there, screen off.
- Night B: **Stop firewall**, the spike stays installed, screen off.

Pass: night A drains 3 points or fewer than night B.

Read it as an upper bound. The spike writes one log line to a file for every flow and rewrites
the file when it passes 256 KB; the real build batches into SQLite. A pass here means the real
build passes. A miss of a few points does not by itself fail the engine: report both numbers and
I'll judge it.
