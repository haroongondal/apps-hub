import { fromBase64, hkdf, open, seal, toBase64, utf8 } from 'strongroom-core';
import type { KV } from './service.ts';

// Keeps the vault key on this computer so autofill works without an unlock. The key is sealed under a
// non-extractable AES-GCM key in IndexedDB (device mode), or under a key derived from a fingerprint's
// WebAuthn PRF output (fingerprint mode). A copy of chrome.storage.local alone cannot open it; someone
// who holds the whole browser profile (storage and IndexedDB) can, in device mode. That is the trade-off.
export type KeyStore = { get(): Promise<CryptoKey | undefined>; put(k: CryptoKey): Promise<void> };
export type DeviceKeys = { vaultKey: Uint8Array; loginToken?: Uint8Array };
export interface DeviceVault {
  saveKeys(k: DeviceKeys, prf?: Uint8Array): Promise<void>;
  loadKeys(prf?: Uint8Array): Promise<DeviceKeys | null>;
  clearKeys(): Promise<void>;
  mode(): Promise<'none' | 'device' | 'fingerprint'>;
  protect(prf: Uint8Array): Promise<void>;
  unprotect(prf: Uint8Array): Promise<void>;
  saveAccountKey(k: Uint8Array): Promise<void>;
  loadAccountKey(): Promise<Uint8Array | null>;
}

type Mode = 'device' | 'fingerprint';
const KEYS = 'deviceKeys';
const ACCOUNT = 'accountKeySealed';
const KEYS_AAD = utf8('strongroom/ext/device-keys');
const ACCOUNT_AAD = utf8('strongroom/ext/account-key');
const NONCE = 12;

// WebCrypto with the non-extractable key directly (core's seal takes raw key bytes). Layout nonce || ciphertext || tag.
async function wrapSeal(key: CryptoKey, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(NONCE));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new Uint8Array(aad), tagLength: 128 }, key, new Uint8Array(plaintext)));
  return Uint8Array.from([...iv, ...ct]);
}
async function wrapOpen(key: CryptoKey, sealed: Uint8Array, aad: Uint8Array): Promise<Uint8Array | null> {
  if (sealed.length < NONCE + 16) return null;
  try {
    const params = { name: 'AES-GCM', iv: new Uint8Array(sealed.slice(0, NONCE)), additionalData: new Uint8Array(aad), tagLength: 128 };
    return new Uint8Array(await crypto.subtle.decrypt(params, key, new Uint8Array(sealed.slice(NONCE))));
  } catch {
    return null;
  }
}

const encode = (k: DeviceKeys) => utf8(JSON.stringify({ v: toBase64(k.vaultKey), t: k.loginToken && toBase64(k.loginToken) }));
const decode = (b: Uint8Array): DeviceKeys | null => {
  try {
    const j = JSON.parse(new TextDecoder().decode(b));
    return { vaultKey: fromBase64(j.v), ...(j.t ? { loginToken: fromBase64(j.t) } : {}) };
  } catch {
    return null;
  }
};

export function createDeviceVault(area: KV, keys: KeyStore): DeviceVault {
  const wrapper = async () => {
    const k = await keys.get();
    if (!k) throw new Error('No device key available');
    return k;
  };
  const entry = async (): Promise<{ mode: Mode; sealed: string } | null> => {
    try {
      const j = JSON.parse((await area.get(KEYS)) ?? 'null');
      return j && (j.mode === 'device' || j.mode === 'fingerprint') && typeof j.sealed === 'string' ? j : null;
    } catch {
      return null;
    }
  };
  const write = (mode: Mode, sealed: Uint8Array) => area.set(KEYS, JSON.stringify({ mode, sealed: toBase64(sealed) }));
  const fp = (prf: Uint8Array) => hkdf(prf, 'strongroom/ext/fingerprint');
  const sealKeys = async (mode: Mode, k: DeviceKeys, prf?: Uint8Array) =>
    write(mode, mode === 'device' ? await wrapSeal(await wrapper(), encode(k), KEYS_AAD) : await seal(fp(prf!), encode(k), KEYS_AAD));

  const self: DeviceVault = {
    async mode() {
      return (await entry())?.mode ?? 'none';
    },
    async loadKeys(prf) {
      const e = await entry();
      if (!e) return null;
      try {
        const sealed = fromBase64(e.sealed);
        if (e.mode === 'device') {
          const plain = await wrapOpen(await wrapper(), sealed, KEYS_AAD);
          return plain && decode(plain);
        }
        const plain = prf && (await open(fp(prf), sealed, KEYS_AAD));
        return plain ? decode(plain) : null;
      } catch {
        return null;
      }
    },
    async saveKeys(k, prf) {
      const e = await entry();
      if (e?.mode === 'fingerprint') {
        if (prf) await sealKeys('fingerprint', k, prf);
        return;
      }
      await sealKeys('device', k);
    },
    clearKeys: () => area.remove(KEYS),
    // One entry holds the sealed copy, so replacing it is the write-new-then-drop-old step: no moment with both or neither.
    async protect(prf) {
      const k = (await entry())?.mode === 'device' ? await self.loadKeys() : null;
      if (k) await sealKeys('fingerprint', k, prf);
    },
    async unprotect(prf) {
      const k = (await entry())?.mode === 'fingerprint' ? await self.loadKeys(prf) : null;
      if (k) await sealKeys('device', k);
    },
    async saveAccountKey(k) {
      await area.set(ACCOUNT, toBase64(await wrapSeal(await wrapper(), k, ACCOUNT_AAD)));
    },
    async loadAccountKey() {
      const s = await area.get(ACCOUNT);
      if (!s) return null;
      try {
        return await wrapOpen(await wrapper(), fromBase64(s), ACCOUNT_AAD);
      } catch {
        return null;
      }
    },
  };
  return self;
}

// IndexedDB is only touched when called, so this module imports under node.
const openDb = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('strongroom-device', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const done = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export const idbKeyStore: KeyStore = {
  // Creates the wrapper on first use. The key is made before the transaction (awaiting inside one would close it),
  // and the get-then-put runs in one readwrite transaction so two contexts cannot each store a different key.
  async get() {
    const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const db = await openDb();
    try {
      const store = db.transaction('keys', 'readwrite').objectStore('keys');
      const existing = await done<CryptoKey | undefined>(store.get('wrapper'));
      if (existing) return existing;
      await done(store.put(fresh, 'wrapper'));
      return fresh;
    } finally {
      db.close();
    }
  },
  async put(k) {
    const db = await openDb();
    try {
      await done(db.transaction('keys', 'readwrite').objectStore('keys').put(k, 'wrapper'));
    } finally {
      db.close();
    }
  },
};
