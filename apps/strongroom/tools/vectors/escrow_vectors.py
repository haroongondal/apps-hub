"""Computes the escrow section of vault-vectors.json without Strongroom's own code.

Requires only cryptography (AES-GCM); HKDF-SHA-256 comes from account_key_vectors.py, which writes
it out from RFC 5869 with hmac and hashlib. Dev-time oracle only, never a project dependency; run it
from a throwaway venv:

  python3 -m venv /tmp/v && /tmp/v/bin/pip install argon2-cffi cryptography
  /tmp/v/bin/python apps/strongroom/tools/vectors/escrow_vectors.py [--write]

(argon2-cffi is needed only because the sibling script imports it at the top.)
"""

import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.insert(0, str(Path(__file__).resolve().parent))
from account_key_vectors import VECTORS, hkdf  # noqa: E402

LABEL = 'strongroom/v1/escrow'
CODE = bytes(range(0x50, 0x64))  # 20 fixed bytes: the emailed code
RECOVERY_KEY = bytes(range(0x70, 0x84))
ACCOUNT_KEY = bytes(range(0x90, 0xA4))
NONCE = bytes(range(0xB0, 0xBC))  # 12 fixed bytes

NOTE = (
    "A 20-byte email code, recovery key and account key, and a fixed 12-byte nonce. "
    "blob = nonce || AES-256-GCM(key = HKDF-SHA-256(ikm = code, no salt, info = UTF-8 label, 32 bytes), "
    "plaintext = recoveryKey || accountKey (40 bytes), aad = UTF-8 label) with its 16-byte tag appended. "
    "Computed by apps/strongroom/tools/vectors/escrow_vectors.py (own HKDF, cryptography AES-GCM), not by Strongroom's code."
)


def main() -> None:
    key = hkdf(CODE, LABEL)
    blob = NONCE + AESGCM(key).encrypt(NONCE, RECOVERY_KEY + ACCOUNT_KEY, LABEL.encode())
    assert len(blob) == 12 + 40 + 16
    section = {
        'note': NOTE,
        'label': LABEL,
        'code': CODE.hex(),
        'recoveryKey': RECOVERY_KEY.hex(),
        'accountKey': ACCOUNT_KEY.hex(),
        'nonce': NONCE.hex(),
        'blob': blob.hex(),
    }
    print(json.dumps(section, indent=4))
    if '--write' in sys.argv:
        v = json.loads(VECTORS.read_text())
        v['escrow'] = section
        VECTORS.write_text(json.dumps(v, indent=4) + '\n')
        print(f'wrote {VECTORS}')


if __name__ == '__main__':
    main()
