# Signing and notarization

Why installers were refused, what fixes it, and how to verify a build before
shipping it.

## What was wrong

`electron-builder.yml` carried no signing configuration, and no certificate was
installed on the build machine. electron-builder does not fall back to ad-hoc
signing in that case — it logs a warning, **skips signing entirely**, and exits
0. Every artifact under `dist/` built before 2026-09-09 is therefore unsigned:

```
$ codesign --verify --deep --strict "dist/mac-universal/Autonomous Browsing.app"
… code object is not signed at all

$ syspolicy_check distribution "dist/mac-universal/Autonomous Browsing.app"
Codesign Error — File is not signed at all.  Severity: Fatal
```

There is no `Contents/_CodeSignature`, so nothing in `Contents/Resources` —
`app.asar`, the unpacked native modules, `updates/`, `.env` — is sealed. macOS
reports that bundle as **"'Autonomous Browsing' is damaged and can't be opened.
You should move it to the Trash"** once it carries a download quarantine flag,
and offers no "Open Anyway". On Windows the NSIS installer was likewise
unsigned, so SmartScreen shows **"Windows protected your PC — Unknown
publisher"**.

Discard those artifacts. They cannot be repaired in place.

## What the two build commands now do

| Command                  | macOS                                              | Windows                              |
| ------------------------ | -------------------------------------------------- | ------------------------------------ |
| `npm run dist`           | Developer ID signed, hardened runtime, notarized   | Authenticode signed                  |
| `npm run dist:local`     | ad-hoc signed, hardened runtime, **not** notarized | unsigned                             |
| `npm run dist:mac`       | universal `.dmg`, signed and notarized             | —                                    |
| `npm run dist:win`       | —                                                   | x64 NSIS `.exe`, Authenticode signed |
| `npm run dist:mac:local` | universal `.dmg`, ad-hoc, **not** notarized        | —                                    |
| `npm run dist:win:local` | —                                                   | x64 NSIS `.exe`, unsigned            |

`dist` and `dist:local` build for the host platform at the host architecture, so
on an Apple Silicon Mac `--win` would quietly produce an arm64 Windows build that
no ordinary PC can run. The four per-platform commands pin both target and arch,
which is what makes one Mac able to produce both installers.

`mac.forceCodeSigning` and `win.forceCodeSigning` are `true`, so `npm run dist`
now **fails** when a certificate is missing rather than quietly producing the
artifact that caused this. `dist:local` is the explicit opt-out, for developers
who want a runnable local bundle and nothing more.

`dist:local` output still fails Gatekeeper on another machine — ad-hoc signing
is not distribution. Its fatal defect is now only the missing notary ticket, so
the recipient gets the recoverable "unidentified developer" prompt (right-click
→ Open, or System Settings → Privacy & Security → Open Anyway) instead of
"damaged". Do not hand it to end users.

## Shipping macOS

**Buy:** Apple Developer Program membership ($99/yr), then create a **Developer
ID Application** certificate in the developer portal. A "Mac Development" or
"Apple Distribution" certificate is the wrong kind and electron-builder will
refuse it for a `mac` target.

**Then** create an App Store Connect API key (Users and Access → Integrations →
Keys, role Developer) and export the certificate as a `.p12`.

```sh
export CSC_LINK=/absolute/path/to/developer-id.p12   # or base64 of the file
export CSC_KEY_PASSWORD='…'
export APPLE_API_KEY=/absolute/path/to/AuthKey_XXXXXXXXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=00000000-0000-0000-0000-000000000000
npm run dist
```

An installed keychain identity works instead of `CSC_LINK`/`CSC_KEY_PASSWORD`;
electron-builder finds it on its own. The Apple ID alternative — `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` — also works but puts a password
that unlocks the whole account in the environment; prefer the API key.

Notarization is not a config flag: electron-builder runs it when one of those
env-var sets is present and **skips it with a warning** when none is. Read the
build log for `notarization successful` — its absence is the failure mode this
document exists to prevent.

`build/entitlements.mac.plist` is what makes the hardened runtime survivable:
Electron's V8 needs `allow-jit` and `allow-unsigned-executable-memory`, and
`disable-library-validation` is what lets the process load the `better-sqlite3`
`.node` out of `app.asar.unpacked`. It is used for the app and, via
`entitlementsInherit`, for the helper apps — electron-builder's auto-discovery
only finds a `mac` file, so the inherit path has to be named explicitly or the
helpers silently get electron-builder's own narrower template.

## Shipping Windows

**Buy** one of:

- **Azure Trusted Signing** (~$10/mo, requires an identity-validated
  organization or individual). Cheapest, no hardware token, and the `dotnet`
  signing CLI runs on macOS, so Windows artifacts can be signed from this
  machine. Configure `win.azureSignOptions` — it replaces `signtoolOptions`.
- **An OV/EV Authenticode certificate** from a CA. EV clears SmartScreen
  immediately; OV builds reputation over the first few hundred downloads and
  will keep warning until it does. Since June 2023 both ship on a hardware
  token or cloud HSM, which is why CI signing usually means Azure or a
  cloud-HSM plugin rather than a `.pfx`.

With a `.pfx` on disk:

```sh
export WIN_CSC_LINK=/absolute/path/to/cert.pfx
export WIN_CSC_KEY_PASSWORD='…'
npm run dist -- --win
```

electron-builder signs Windows binaries from macOS via `osslsigncode`; the
`signtoolOptions` in `electron-builder.yml` pin SHA-256 and an RFC-3161
timestamp so signatures outlive the certificate.

## Verifying before you ship

macOS — all three must pass:

```sh
codesign --verify --deep --strict --verbose=2 "dist/mac-universal/Autonomous Browsing.app"
codesign -dv "dist/mac-universal/Autonomous Browsing.app"   # want: flags=…(runtime), TeamIdentifier set, Sealed Resources present
xcrun stapler validate "dist/Autonomous Browsing-0.1.0-universal.dmg"
```

`syspolicy_check distribution <app>` reports every remaining blocker in one
pass and is the fastest way to tell a signing problem from a notarization one.

Windows:

```powershell
signtool verify /pa /v "Autonomous Browsing Setup 0.1.0.exe"
```

## Installing internally without buying a certificate

Neither OS inspects the app itself. Each checks a marker meaning "this came
from the internet", and that marker is written by the *downloading*
application, not by the OS — so a build that never passes through a browser
trips neither check. There is one script per platform:
`scripts/install-macos.sh` and `scripts/install-windows.ps1`. Each installs
from the downloaded artifact and clears its platform's marker on the way.

**Run it before opening the installer.** Whether a late run still helps differs
by platform:

| | Marker | Set by | Late run still works? |
| --- | --- | --- | --- |
| macOS | `com.apple.quarantine` | Safari, Chrome, Mail, Slack, AirDrop | Yes — the flag sits on the installed app and clears in place |
| Windows | Mark of the Web (`Zone.Identifier`) | browsers, Outlook, Teams | No — SmartScreen fires when `Setup.exe` runs, and installed files carry no marker |

macOS stamps quarantine onto files **as they are copied off a quarantined disk
image**, not while they sit inside it, so clearing the flag on the `.dmg` first
is what makes the installed copy clean — which is the order the script uses.
Ad-hoc signing is a prerequisite for any of this: the kernel kills unsigned
arm64 binaries whatever the quarantine state says, so build with
`npm run dist:local`.

Channels that set no marker at all, and so need no script: `curl`, `scp`,
`rsync`, a UNC or mapped network share, and a USB stick. Mark of the Web does
propagate through zip extraction on Windows, so zipping a browser-downloaded
installer does not launder it.

### One click

`install-macos.command` and `install-windows.cmd` are double-click wrappers
around the two scripts — a `.sh` opens a text editor on double-click and a
`.ps1` opens Notepad, so the wrappers are what make this one action. The `.cmd`
also passes `-ExecutionPolicy Bypass`, without which a downloaded `.ps1` is
refused by PowerShell whatever its marker says.

One double-click carries the whole sequence: clear the marker, install, launch
the app. The two platforms reach the launch differently — the macOS script
calls `open` itself (pass `--no-open` to stop it), while on Windows the NSIS
installer does it, because `runAfterFinish` defaults to `true`. Turning that
option off would silently cost Windows the last step.

### When the `.command` itself is rejected

Gatekeeper assessed the wrapper, because the wrapper was downloaded too. No
file the browser marked can clear its own marker — clearing it requires already
running. Putting the wrapper inside the `.dmg` does not dodge it either: a
quarantined disk image mounts its whole volume with the `quarantine` flag, so
everything on it is assessed even though no file there carries the attribute.

Three ways out, cheapest first.

**Send the wrapper down a channel that marks nothing.** `curl` writes only
`com.apple.provenance`, never quarantine, so hosting `install-macos.sh`
anywhere the team can reach turns the whole install into one paste that never
meets Gatekeeper:

```sh
curl -fsSL https://internal.example/install-macos.sh | bash
```

Nothing here has to be public. `curl -u`, a bearer token, a VPN-only host and a
time-limited S3 presigned URL all work, because what matters is that `curl`
rather than a browser wrote the file. `scp`, `rsync`, a mounted share, a USB
stick and a `git clone` are equally unmarked and need no hosting at all. Only
the browser marks. This is what the size asymmetry is for: the wrapper is a few
hundred bytes and can travel the clean route, while the 130 MB installer takes
whatever route is convenient and gets cleaned on arrival.

**Or approve the wrapper once by hand,** in System Settings → Privacy &
Security, where the blocked file is named with an Open Anyway button. That copy
is clear from then on, and the wrapper re-clears itself and the `.sh` on every
run — so it also recovers an execute bit stripped in transit, which is a
separate failure that looks identical from Finder.

**Or sign the app.** A Developer ID signature plus notarization is the only
thing that opens a browser-downloaded artifact on the first double-click, with
no dialog, for every user, permanently.

## Open issue: `.env` is bundled into the app

`extraResources` copies `.env` into `Contents/Resources/.env`, so
`AI_GATEWAY_API_KEY` ships inside every installer. Signing seals that file
against tampering; it does nothing to hide it — `app.asar` and the resources
directory are readable by anyone who installs the app. Any build distributed
outside the team leaks the gateway key.
