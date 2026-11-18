# Bundled fonts

IBM Plex Sans and IBM Plex Mono, latin and latin-ext subsets, as `woff2`.

- Copyright © 2017 IBM Corp.
- Licensed under the SIL Open Font License 1.1 — <https://openfontlicense.org>
- Upstream: <https://github.com/IBM/plex>

They are vendored rather than fetched because the packaged Content-Security-Policy
is pinned to `'self'`, so a font CDN is unreachable at runtime.
