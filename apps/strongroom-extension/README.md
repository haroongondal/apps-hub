# Strongroom for Chrome

Fills and saves logins from a vault encrypted in this browser profile. Manifest V3, Chrome 127 or later, Mac and Windows. With sync, it signs in with your master password and account key and syncs with the phone through your own vault server; only encrypted data leaves the browser. A build without the vault server's address (the default until it is deployed) has no sync and keeps the vault separate from the phone's (see `docs/handoffs/strongroom-sync.md`).

## Install (unpacked)

```bash
pnpm install
pnpm --filter strongroom-extension build      # writes apps/strongroom-extension/dist
```

Chrome → `chrome://extensions` → turn on Developer mode → Load unpacked → pick the `dist` folder. Pin the Strongroom icon, open it, create your master password (at least 12 characters), and write down the recovery key it shows once. Rebuild and press the reload arrow on the extension card after any code change.

## What it does

- **Fill:** click a login field on a site you saved a login for and pick the suggestion. Nothing fills until you click.
- **Save:** after you sign in on a site with a new or changed password, the toolbar icon shows a badge. Open it and choose Save or Update.
- **Import:** Google Password Manager export (CSV), once. Delete the file afterwards; it is plain text.
- **Locks** after 5 minutes without use, on browser restart, and with the Lock button.

Not in this version: cards and notes in the UI, change master password, new recovery key, clipboard auto-clear, Firefox.

## Develop

```bash
pnpm --filter strongroom-extension test        # service logic, node --test
pnpm --filter strongroom-extension typecheck
pnpm --filter strongroom-extension test:e2e    # real Chromium; needs playwright-core and a Chromium
```

`test:e2e` reads `PLAYWRIGHT_CORE` (path to playwright-core's `index.mjs`), `CHROMIUM_PATH` and `SHOTS` (screenshot folder) from the environment; the defaults are this Mac's.
