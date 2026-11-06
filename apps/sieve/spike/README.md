# Sieve spike

Throwaway Phase 0 spike: can a Chrome extension download YouTube streams? Load this folder unpacked, open a video,
click the action, then **Run all** and **Save results**. `node apps/sieve/spike/run.mjs` drives the same buttons in a
fresh profile. Results go in `docs/handoffs/sieve.md` under "Spike results".

## Vendored: yt-dlp ejs (signature and `n` solver, strategy S3)

- Source: <https://github.com/yt-dlp/ejs>, release `0.8.0` (published 2026-03-17, the latest release on 2026-11-06).
  yt-dlp master on 2026-11-06 pins the same version (`yt_dlp/extractor/youtube/jsc/_builtin/vendor/_info.py`; last
  change to that folder `7e3644cf`, 2026-10-26).
- Files in `vendor/`, release assets copied byte for byte:

| File | SHA-256 |
|---|---|
| `yt.solver.core.js` | `ca259e4e3cdd37d92fc266d9af08d4fd66da8479e240f4d984f29da402c22ead` |
| `yt.solver.lib.js` | `770831df5c46474fbff06732315b28f4fb090e427ca669a51da61e2457d41c82` |

  Both SHA-256 values equal the release's asset digests, and the SHA3-512 of each equals the hash yt-dlp pins in `_info.py`.
- Licences: ejs is Unlicense. `yt.solver.lib.js` bundles meriyah 6.1.4 (ISC, Copyright (c) 2019 and later, KFlash
  and others) and astring 1.9.0 (MIT, Copyright (c) 2015, David Bonnet); their licence texts are in the file's header.

### How it is called

The ejs README documents installation and runtimes only. The contract below comes from `src/yt/solver/main.ts` at the
`0.8.0` tag and from yt-dlp's glue (`ejs.py`, `_construct_stdin`):

- Glue: run `yt.solver.lib.js` (defines `lib`), then `Object.assign(globalThis, lib)`, then `yt.solver.core.js`
  (defines `jsc`, which reads `meriyah` and `astring` as globals).
- Input: `jsc({ type: 'player', player: <player JS text>, output_preprocessed: false, requests: [{ type: 'sig', challenges: [s, …] }, { type: 'n', challenges: [n, …] }] })`.
- Output: `{ type: 'result', responses: [...] }`, one response per request in order: `{ type: 'result', data: { <challenge>: <solution> } }`
  or `{ type: 'error', error }`. It throws if the player script has an unexpected shape.
- Challenges: `sig` takes the `s` value of a `signatureCipher` and returns the plain signature, which goes on the URL as
  `&<sp or "signature">=<encoded solution>`. `n` takes the URL's `n` value and returns its replacement.

### Where it runs

`jsc` evals the player script, which extension pages forbid, so `solver.html` is a sandbox page (manifest `sandbox`).
`spike.js` keeps it in a hidden iframe and calls `solve(playerJsText, { sig, n })` through `postMessage`; both ends
check `event.source`. `spike.js` has to target the iframe with `'*'` (a sandbox page's origin is opaque), and the reply
targets the extension's origin. The page solves in a fresh blob worker per request, not in the page itself: ejs's setup line
`globalThis.location = new URL("https://www.youtube.com/watch?v=yt-dlp-wins")` (meant for node and deno) navigated a
sandbox page away when tried, but does nothing in a worker. The default sandbox CSP blocks blob workers
(`child-src 'self'`), so the manifest sets `sandbox allow-scripts; script-src 'self' 'unsafe-eval'; worker-src blob:; default-src 'none'`,
which also leaves the player code no network access.

Raw stream URLs and ciphers live in `chrome.storage.session` under `streams:<strategy>` (solved ones under
`streams:S3`, for Task 0.4), so they never reach disk and are gone when the browser closes. **Save results**, the
summaries and `run.mjs` read the `probe:` keys in `chrome.storage.local` only, and `run.mjs` fails if a stream URL or
cipher shows up in them. **Run all** clears both first. S3 Range-checks every solved URL (4 at a time), each next to a
control that uses the raw challenges, and a class passes only when every one of its formats answers 206.

## Downloads (Q1 and Q2, the last step of Run all, stored as `probe:DL`)

`spike.js` picks streams from the `streams:` records, joined by itag to the probe's `bitrate` and `contentLength`. Raw URLs
that still carry an `n` are skipped (S3 holds the solved copy). Per height, the highest-bitrate stream that answers a Range
request wins. Downloads are sequential 10 MiB `Range` requests (60 s each, one retry on a network error; a non-206 answer
or a short chunk fails the stream):

- A link baseline first: 25 MB from `speed.cloudflare.com` (else 10 MB from `proof.ovh.net`), so a slow link is not read as throttling.
- The audio (itag 251, else 140) and the 1080p video, in full. Q1: every byte arrived and the first bytes are `ftyp` at offset 4 or `1A 45 DF A3`. Q2: speed is at least 5x the format's `bitrate` (its peak rate, so the ratio errs low).
- The top height above 1080p, if there is one: only its first 100 MiB plus the last 1 MiB (a 206 with the right byte count proves the end is reachable). It is marked `partial` and never claims Q1.

`probe:DL` holds itag, height, mimeType, byte counts, timings, the first 16 bytes as hex and the verdict, never a URL or a body.
`run.mjs` sizes its wait from the byte count the page announces (at a 1 MB/s floor, capped at 30 minutes).
