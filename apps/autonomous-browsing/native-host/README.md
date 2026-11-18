# Native messaging host

Chrome launches `relay.js` as a child process over stdio. Because the Electron
app runs independently, the relay does not contain any logic — it pumps
native-messaging frames to and from a local socket the Electron app listens on.

```
Chrome ⇄ (stdio, 4-byte LE length + JSON) ⇄ relay.js ⇄ (newline JSON) ⇄ Electron app
```

## Endpoint

| Platform      | Path                                       |
| ------------- | ------------------------------------------ |
| macOS / Linux | `~/.outsentia-automation.sock` (mode 0600) |
| Windows       | `\\.\pipe\outsentia-automation`            |

Under `$HOME` rather than `/tmp` so another local user cannot pre-create or
squat the path. The server lives in `src/main/automation/extension-bridge.ts`
and is started from `src/main/index.ts`; it unlinks a stale socket before
listening and is closed on `before-quit`.

## Installing the host manifest

`relay.js` must be executable (`chmod +x`) and `path` must be **absolute**.

On macOS, `path` must also point **outside `~/Documents` and `~/Desktop`**.
Chrome is denied the exec there and reports only `Native host has exited`, with
the host never running and nothing reaching its log. `npm run install:host`
therefore writes the shim to
`~/Library/Application Support/com.cd.browser.automation/`; the shim then runs
`relay.js` from the repo, which Node is still allowed to read. Replace
`REPLACE_WITH_EXTENSION_ID` with the ID assigned by the Chrome Web Store — this
is what stops any other extension from opening the channel.

| Platform | Destination                                                                                                                                         |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.cd.browser.automation.json`                                                   |
| Linux    | `~/.config/google-chrome/NativeMessagingHosts/com.cd.browser.automation.json`                                                                       |
| Windows  | registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.cd.browser.automation` whose default value is the absolute path to the JSON file |

On Windows, Node is usually not on PATH for a Chrome-spawned process — point
`path` at a `.bat` shim or at the packaged Electron binary running in Node mode.

## Protocol

Requests carry an `id`; the reply echoes it. App → extension:

| Message                                       | Effect                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `{type:'start', id}`                          | Adopts the active tab as the target and shows the banner.                                    |
| `{type:'step', id, step}`                     | Runs one step. `step` is an `ActionStep` from `src/shared/types.ts`, already param-resolved. |
| `{type:'snapshot', id}`                       | Captures screenshot + DOM for the Claude loop.                                               |
| `{type:'pause', reason?}` / `{type:'resume'}` | Hold and release from the app side.                                                          |
| `{type:'stop'}`                               | Clears the target and hides the banner.                                                      |

Extension → app:

| Message                                 | Meaning                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `{id, ok, value?, error?}`              | Step finished. `value` carries `extract` text.                                                               |
| `{id, ok, held:true, error}`            | Step **refused** — a CAPTCHA or sensitive field was on the page. Not a failure; retry after the hold clears. |
| `{id, ok, url, title, screenshot, dom}` | Snapshot result; `screenshot` is a JPEG data URL.                                                            |
| `{type:'paused', reason, auto}`         | `auto:true` = the extension tripped it; `auto:false` = user clicked Pause.                                   |
| `{type:'resumed'}`                      | User cleared the blocker.                                                                                    |
| `{type:'target-closed'}`                | Target tab closed mid-run.                                                                                   |

## Steps

The extension executes the same `ActionStep` union the app persists in SQLite,
so saved routines need no translation: `navigate`, `click`, `type` (with
`submit`), `select`, `wait`, `scroll`, `screenshot`, `extract`.

`navigate` and `screenshot` are handled in `background.js` (tabs API); the rest
run in `content.js`. The kinds are a fixed allowlist there. Do not extend the
protocol to accept JavaScript strings from the app — remotely-hosted code is
grounds for Chrome Web Store removal.
