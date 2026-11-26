// Runs the WebAuthn fingerprint check in an extension window: a service worker has no WebAuthn, and a content script would use the web page's origin.
// The window is opened by background.ts with ?mode=enroll|verify&req=<nonce>[&cred=<id>] and answers with a fingerprintResult message.
const params = new URLSearchParams(location.search);
const mode = params.get('mode');
const req = params.get('req') ?? '';
const text = document.getElementById('text')!;
const closeButton = document.getElementById('close') as HTMLButtonElement;

const b64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));
// The same salt every time, so the same fingerprint always derives the same 32-byte secret.
const salt = async () => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('strongroom/ext/prf')));

async function prfFor(credentialId: Uint8Array): Promise<string | undefined> {
  const a = (await navigator.credentials.get({
    publicKey: {
      rpId: location.hostname, challenge: random(32), userVerification: 'required',
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      extensions: { prf: { eval: { first: await salt() } } },
    } as PublicKeyCredentialRequestOptions,
  })) as PublicKeyCredential | null;
  const first = (a?.getClientExtensionResults() as { prf?: { results?: { first?: ArrayBuffer } } } | undefined)?.prf?.results?.first;
  return first && first.byteLength >= 32 ? b64(first) : undefined;
}

async function enroll() {
  const created = (await navigator.credentials.create({
    publicKey: {
      rp: { id: location.hostname, name: 'Strongroom' },
      user: { id: random(16), name: 'Strongroom', displayName: 'Strongroom' },
      challenge: random(32),
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      extensions: { prf: {} },
    } as PublicKeyCredentialCreationOptions,
  })) as PublicKeyCredential | null;
  if (!created) throw new Error('No credential was made.');
  const prfOn = (created.getClientExtensionResults() as { prf?: { enabled?: boolean } }).prf?.enabled === true;
  text.textContent = prfOn ? 'Touch the sensor once more to finish.' : 'Done.';
  // A second touch reads the secret; without PRF the fingerprint only gates fills.
  const prf = prfOn ? await prfFor(new Uint8Array(created.rawId)).catch(() => undefined) : undefined;
  return { credentialId: b64(created.rawId), ...(prf && { prf }) };
}

async function verify() {
  const id = params.get('cred');
  if (!id) throw new Error('No fingerprint is set up.');
  return { prf: await prfFor(unb64(id)) };
}

async function run() {
  text.textContent = 'Waiting for your fingerprint…';
  try {
    const result = mode === 'enroll' ? await enroll() : await verify();
    await chrome.runtime.sendMessage({ type: 'fingerprintResult', req, ok: true, ...result });
  } catch (e) {
    const name = e instanceof Error ? e.name : 'Error';
    text.textContent = name === 'NotAllowedError'
      ? 'The fingerprint was not accepted, or the check was cancelled.'
      : `The fingerprint check did not work (${name}). Use your master password instead.`;
    closeButton.hidden = false;
    await chrome.runtime.sendMessage({ type: 'fingerprintResult', req, ok: false });
  }
}

closeButton.onclick = () => window.close();
void run();
