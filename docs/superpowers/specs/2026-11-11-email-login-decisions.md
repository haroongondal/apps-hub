# Email-code sign-in: decisions (2026-11-11)

Builds on `docs/superpowers/specs/2026-11-11-email-login-design-DRAFT.md`. Owner decisions:

1. **Parallel guessing:** failed logins are serialised by a Durable Object. One failed attempt runs at a time, each keeps the existing backoff, and nothing locks the owner out. Blocks a parallel online guesser without a lockout.
2. **Wait before a new device gets in:** a variable `SIGNIN_WAIT_HOURS`, default `0` (off) for development. Set it to 24 later to add a cancellable wait. The code path exists with the wait off.
3. **Sign-in blob is separate from the escrow blob.** The escrow blob holds the recovery key and the account key, so a blob plus the emailed code would open the vault with no master password. The sign-in blob holds only the account key, sealed under `HKDF(code, "strongroom/v1/signin")`.
4. **Notice on every new-device sign-in:** the owner gets an email whenever a device asks to sign in, with the device's name and time, so an unexpected request is visible.

Scope of this branch: Worker only (tools/vault-api). The extension and phone follow in later tasks.
