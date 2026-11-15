#!/usr/bin/env python3
"""Generates otp-vectors.json for OtpTest (DESIGN §15.1).

The RFC 6238 appendix-B rows are copied from the RFC text, fetched from
https://www.rfc-editor.org/rfc/rfc6238.txt on 2026-11-15. The 6-digit rows,
the period edges and the base32 encodings are recomputed here with an
independent implementation (hmac + struct + base64), the argon2-cffi
precedent from Task 12 (U3).

Run from apps/strongroom:  python3 tools/vectors/otp_vectors.py
Writes modules/strongroom-vault/android/src/test/resources/otp-vectors.json.
"""
import base64
import hashlib
import hmac
import json
import struct
from pathlib import Path

DIGESTS = {"sha1": hashlib.sha1, "sha256": hashlib.sha256, "sha512": hashlib.sha512}

# The three test secrets of RFC 6238 appendix B: the ASCII string
# "12345678901234567890" repeated to 20 / 32 / 64 bytes.
SECRETS = {
    "sha1": ("12345678901234567890" * 4)[:20],
    "sha256": ("12345678901234567890" * 4)[:32],
    "sha512": ("12345678901234567890" * 4)[:64],
}

# Table 1 of RFC 6238, transcribed from the fetched text (8 digits, X = 30).
RFC_ROWS = [
    (59, "94287082", "46119246", "90693936"),
    (1111111109, "07081804", "68084774", "25091201"),
    (1111111111, "14050471", "67062674", "99943326"),
    (1234567890, "89005924", "91819424", "93441116"),
    (2000000000, "69279037", "90698825", "38618901"),
    (20000000000, "65353130", "77737706", "47863826"),
]


def totp(secret: bytes, t: int, period: int, digits: int, digest: str) -> str:
    counter = t // period
    h = hmac.new(secret, struct.pack(">Q", counter), DIGESTS[digest]).digest()
    off = h[-1] & 0x0F
    binary = ((h[off] & 0x7F) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
    return str(binary % 10**digits).zfill(digits)


def b32(secret: bytes) -> str:
    return base64.b32encode(secret).decode().rstrip("=")


def main() -> None:
    secrets = {name: b32(text.encode()) for name, text in SECRETS.items()}
    rfc = [
        {"t": t, "sha1": sha1, "sha256": sha256, "sha512": sha512}
        for t, sha1, sha256, sha512 in RFC_ROWS
    ]
    # The same six times, 6 digits, recomputed independently.
    six = [
        {"t": row["t"], "digest": digest, "code": totp(SECRETS[digest].encode(), row["t"], 30, 6, digest)}
        for row in rfc
        for digest in ("sha1", "sha256", "sha512")
    ]
    # Period edges: the counter boundary and two non-default periods, 6 digits.
    edges = [
        {"period": period, "t": t, "code": totp(SECRETS["sha1"].encode(), t, period, 6, "sha1")}
        for period, t in [(30, 0), (30, 29), (30, 59), (30, 60), (30, 89), (30, 90), (15, 45), (120, 240)]
    ]
    doc = {
        "note": "RFC 6238 appendix B (https://www.rfc-editor.org/rfc/rfc6238.txt, fetched 2026-11-15); "
        "6-digit and period-edge rows recomputed independently by tools/vectors/otp_vectors.py. "
        "Secrets are the RFC's ASCII strings, base32 without padding.",
        "secrets": secrets,
        "rfc6238": rfc,
        "sixDigit": six,
        "periodEdges": edges,
    }
    out = Path(__file__).resolve().parents[2] / "modules/strongroom-vault/android/src/test/resources/otp-vectors.json"
    out.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
