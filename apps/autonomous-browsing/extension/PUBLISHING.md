# Publishing the extension

How the extension gets a Chrome Web Store listing, and how local development
ends up using the *same* extension id as production. Read
[native-host/README.md](native-host/README.md) for what the id is then used for.

---

## Why the id decides everything

The native-host manifest names exactly one extension in `allowed_origins`:

```json
"allowed_origins": ["chrome-extension://<32-letter-id>/"]
```

That single line is what stops any other extension on the machine from opening
the control channel and driving the user's browser. It is the trust boundary,
not a configuration detail.

An unpacked extension's id is derived from the absolute path of its directory,
so it differs per machine and per checkout. A Web Store extension's id is
derived from a key Google generates. Left alone, those two ids never match —
which is why dev and production would otherwise need separate wiring.

They can be made to match. The rest of this document is that procedure.

## The ordering problem

You cannot pick the production id, and you cannot know it before uploading.
*Pack extension* in `chrome://extensions` produces a local `.pem`, but the Web
Store ignores it and generates its own key on first upload.

So the sequence is fixed: **publish first, then point local development at the
id you were given.** Publishing an unlisted draft is enough — it is not a
public launch, and it yields a real id and key.

## 1. Build the zip

```
cd extension && zip -r ../extension.zip . -x '.*'
```

`manifest.json` must sit at the root of the archive, not inside a nested
folder. The `version` field must be strictly higher than any version you have
uploaded before; the Store rejects a re-upload of the same number.

## 2. Create the item

One-time $5 developer registration fee, then
[chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
→ **New item** → upload the zip.

Set visibility to **Unlisted** for this first pass. Unlisted items are still
reviewed and still get a permanent id, but they do not appear in search and
require the direct link to install. Switch to Public later, when the extension
is actually ready for users — that visibility change is reviewed again.

## 3. Expect review to focus on the permissions

[extension/manifest.json](extension/manifest.json) requests `<all_urls>` host
permissions plus `nativeMessaging`, `scripting`, `activeTab`, `storage`, and
`alarms`. That combination — read/write any page, and talk to a local binary —
is the high-scrutiny end of the review queue. Budget days, and sometimes weeks.

You will need a single-purpose statement, a per-permission justification, and
data-use disclosures. Two policies matter more than the rest here:

| Policy | What keeps this extension compliant |
| --- | --- |
| No remotely hosted code | Step kinds are a fixed allowlist in [extension/content.js](extension/content.js). The protocol never carries JavaScript strings from the app. Adding such a step is grounds for removal, not a review note. |
| Native messaging hosts must be local | The relay only ever connects to a socket under `$HOME` ([native-host/relay.js](native-host/relay.js)). |

## 4. Harvest the id and the key

Once the item is published (unlisted is fine), install it on your own machine
from the item's URL. Chrome writes the public key into the installed copy of
the manifest — that is the value you need:

```
ls ~/Library/Application\ Support/Google/Chrome/Default/Extensions/
cat ~/Library/Application\ Support/Google/Chrome/Default/Extensions/<id>/<version>/manifest.json
```

The directory name *is* the id. Inside, `"key": "MIIBIjANBgkqhkiG9w0BAQEF..."`
is the base64 DER public key.

| Platform | Installed-extension directory |
| --- | --- |
| macOS | `~/Library/Application Support/Google/Chrome/<profile>/Extensions/` |
| Linux | `~/.config/google-chrome/<profile>/Extensions/` |
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data\<profile>\Extensions\` |

`<profile>` is `Default` unless you installed into a secondary Chrome profile.

## 5. Pin the id for local development

Add the harvested key to [extension/manifest.json](extension/manifest.json):

```json
{
  "manifest_version": 3,
  "key": "MIIBIjANBgkqhkiG9w0BAQEF...",
  "name": "Automation Pause Control",
  ...
}
```

Commit it. It is a public key, not a secret — the private half stays with
Google and is what signs Store updates.

Chrome now derives the unpacked extension's id from `key` rather than from its
directory path, so **Load unpacked** on `extension/` produces the Store id.
Verify on `chrome://extensions` that the id matches the Store item before
trusting it.

One thing to confirm rather than assume: that the Store accepts a manifest that
already carries a matching `key` on your *next* upload. It should, and many
published extensions ship one, but test it on a version number you are willing
to burn.

## What dev and prod look like afterwards

| | Local development | Production |
| --- | --- | --- |
| Extension | Load unpacked from [extension/](extension/) | Installed from the Store |
| Extension id | From `key` — same value | From `key` — same value |
| `allowed_origins` | Identical | Identical |
| `relay.js` | From the repo checkout | From the packaged app's resources |

The id row is the point: one hardcoded id in the app satisfies both, so there
is no per-developer configuration and no branch that only production exercises.

**Do not use the Store build itself for development.** Store installs are
read-only and auto-update, so every change to `background.js` or `content.js`
would become a review round-trip. Keep the unpacked load — you only borrowed
the Store's *identity*, not its build.

## Shipping updates

Bump `version` in the manifest, rebuild the zip, upload as a new version,
submit for review. Once approved, Chrome picks it up on its own update check
(roughly every five hours); `chrome://extensions` → **Update** forces it.

Extension updates and app updates are independent release trains. Anything that
changes the protocol between them — see the message tables in
[native-host/README.md](native-host/README.md) — has to survive an old
extension talking to a new app, and the reverse.

## When the channel does not come up

The extension surfaces `chrome.runtime.lastError` from `connectNative`. The
message tells you which of the three things is wrong:

| Message | Cause |
| --- | --- |
| `Specified native messaging host not found.` | No manifest in that browser's `NativeMessagingHosts` directory — wrong browser, wrong profile, or the installer never ran. |
| `Access to the specified native messaging host is forbidden.` | The manifest exists but its `allowed_origins` does not match this extension's id. This is the id-mismatch signal — check it before suspecting anything else. |
| `Native host has exited.` | The manifest was found and the host would not run: on macOS most often the exec denial under `~/Documents` or `~/Desktop`, otherwise a missing interpreter or a relay crash. |
