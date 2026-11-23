# Chrome Web Store upload

Builds a browser extension and uploads it to the Chrome Web Store through `chrome-webstore-upload-cli` (Web Store API v2).

```bash
node tools/webstore/publish.mjs sieve                # build, upload as a draft
node tools/webstore/publish.mjs strongroom --publish # build, upload, submit for review
node tools/webstore/publish.mjs sieve --no-build     # reuse apps/sieve/dist
node tools/webstore/publish.mjs strongroom --root=<checkout>  # build another checkout or worktree
```

- Upload only is the default. `--publish` submits the version for review; do it only on the owner's go.
- The item must already exist. The first upload, the listing, screenshots, privacy practices and permission justifications are done by hand in the developer dashboard.
- Each upload needs a higher `version` in the extension's `manifest.json` than the one in the store.
- `strongroom` builds `apps/strongroom-extension`, which exists on the `strongroom-extension*` branches until they merge.

## Secrets

Put these in the environment or in `tools/webstore/.env` (gitignored via `.env`):

| Variable | Where it comes from |
| --- | --- |
| `CLIENT_ID`, `CLIENT_SECRET` | OAuth client (type Desktop app) in a Google Cloud project with the Chrome Web Store API enabled |
| `REFRESH_TOKEN` | One OAuth consent as the developer account, scope `https://www.googleapis.com/auth/chromewebstore` |
| `PUBLISHER_ID` | Dashboard, Account |
| `SIEVE_EXTENSION_ID`, `STRONGROOM_EXTENSION_ID` | The item ID from each item's dashboard URL |
