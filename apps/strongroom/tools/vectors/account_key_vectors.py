"""Computes the accountKey section of vault-vectors.json without Strongroom's own code.

Requires argon2-cffi (Argon2id, low-level hash_secret_raw) and cryptography (AES-GCM, only to
seal the vector's passwordWrap). HKDF-SHA-256 is written out below from RFC 5869 with hmac and
hashlib, so the result depends on neither @noble/hashes nor BouncyCastle. Dev-time oracle only,
never a project dependency; run it from a throwaway venv:

  python3 -m venv /tmp/v && /tmp/v/bin/pip install argon2-cffi cryptography
  /tmp/v/bin/python apps/strongroom/tools/vectors/account_key_vectors.py [--write]

It first re-derives the file's existing password, recovery and passwordWrap vectors and stops if
any differ; then it prints the accountKey section, and with --write stores it in the file.
"""

import base64
import hashlib
import hmac
import json
import sys
import unicodedata
from pathlib import Path

from argon2.low_level import Type, hash_secret_raw
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

VECTORS = Path(__file__).resolve().parents[2] / 'modules/strongroom-vault/android/src/test/resources/vault-vectors.json'
ACCOUNT_KEY = bytes(range(0x30, 0x44))  # 20 fixed bytes
PASSWORD_WRAP_AAD = 'strongroom/v1/password-wrap'

NOTE = (
    "The password, salt, kdf, vaultKey and recovery key above, plus a 20-byte account key. "
    "mixedMasterKey = HKDF-SHA-256(ikm = password.masterKey, salt = key, info = UTF-8 'strongroom/v1/account', 32 bytes). "
    "wrapKey, loginToken and readToken are HKDF-SHA-256 of mixedMasterKey with no salt and info "
    "'strongroom/v1/wrap', 'strongroom/v1/login' and 'strongroom/v1/read'. "
    "loginTokenHash is standard padded Base64 of SHA-256(loginToken). "
    "passwordWrap seals vaultKey under wrapKey. header is the exact flagged Header JSON: "
    "\"accountKey\": true is its last field and recoveryWrap is unchanged, because the recovery path ignores the account key. "
    "Computed by apps/strongroom/tools/vectors/account_key_vectors.py (argon2-cffi, own HKDF), not by Strongroom's code."
)


def hkdf(ikm: bytes, info: str, salt: bytes = b'', length: int = 32) -> bytes:
    prk = hmac.new(salt or bytes(32), ikm, hashlib.sha256).digest()  # RFC 5869: no salt means HashLen zeros
    okm, block = b'', b''
    for i in range(1, -(-length // 32) + 1):
        block = hmac.new(prk, block + info.encode() + bytes([i]), hashlib.sha256).digest()
        okm += block
    return okm[:length]


def argon2id(password: str, salt: bytes, kdf: dict) -> bytes:
    secret = unicodedata.normalize('NFC', password).encode()
    return hash_secret_raw(secret, salt, kdf['iterations'], kdf['memoryKiB'], kdf['parallelism'], 32, Type.ID)


def seal(key: bytes, nonce: bytes, plaintext: bytes, aad: str) -> bytes:
    return nonce + AESGCM(key).encrypt(nonce, plaintext, aad.encode())


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def main() -> None:
    v = json.loads(VECTORS.read_text())
    salt, kdf, vault_key = bytes.fromhex(v['salt']), v['kdf'], bytes.fromhex(v['vaultKey'])
    recovery_key = bytes.fromhex(v['recovery']['key'])
    nonce = bytes.fromhex(v['passwordWrap']['nonce'])

    master = argon2id(v['password']['text'], salt, kdf)
    wrap = hkdf(master, 'strongroom/v1/wrap')
    existing = {
        'password.masterKey': master.hex(),
        'password.wrapKey': wrap.hex(),
        'password.loginToken': hkdf(master, 'strongroom/v1/login').hex(),
        'recovery.wrapKey': hkdf(recovery_key, 'strongroom/v1/wrap').hex(),
        'recovery.loginToken': hkdf(recovery_key, 'strongroom/v1/login').hex(),
        'passwordWrap.sealed': seal(wrap, nonce, vault_key, PASSWORD_WRAP_AAD).hex(),
    }
    ok = True
    for name, got in existing.items():
        section, field = name.split('.')
        same = got == v[section][field]
        ok &= same
        print(f"{'match' if same else 'DIFFERS'}  {name}  {got}")
    if not ok:
        sys.exit('The oracle does not reproduce the existing vectors; nothing computed.')

    mixed = hkdf(master, 'strongroom/v1/account', salt=ACCOUNT_KEY)
    account_wrap = hkdf(mixed, 'strongroom/v1/wrap')
    login = hkdf(mixed, 'strongroom/v1/login')
    sealed = seal(account_wrap, nonce, vault_key, PASSWORD_WRAP_AAD)
    header = dict(v['header'])  # keeps the field order; passwordWrap is replaced in place
    header['passwordWrap'] = b64(sealed)
    header['accountKey'] = True
    section = {
        'note': NOTE,
        'key': ACCOUNT_KEY.hex(),
        'mixedMasterKey': mixed.hex(),
        'wrapKey': account_wrap.hex(),
        'loginToken': login.hex(),
        'readToken': hkdf(mixed, 'strongroom/v1/read').hex(),
        'loginTokenHash': b64(hashlib.sha256(login).digest()),
        'passwordWrap': {'aad': PASSWORD_WRAP_AAD, 'nonce': nonce.hex(), 'sealed': sealed.hex()},
        'header': header,
    }
    print(json.dumps(section, indent=4))
    if '--write' in sys.argv:
        v['accountKey'] = section
        VECTORS.write_text(json.dumps(v, indent=4) + '\n')
        print(f'wrote {VECTORS}')


if __name__ == '__main__':
    main()
