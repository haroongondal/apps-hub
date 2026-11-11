// Phone proof only (Task 6c, ruling R25): the Worker's `handle` over node:https with the node:sqlite D1 fake, on 127.0.0.1.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getAccount } from './db.ts';
import { handle } from './index.ts';
import { d1FromNodeSqlite } from './__tests__/d1-fake.ts';

const USAGE = `usage: node --disable-warning=ExperimentalWarning tools/vault-api/src/local-https.ts <dir> [port, default 8743]
  <dir> is outside the repo and holds key.pem and cert.pem; the server keeps vault.db and setup-token.txt there. Make the cert with a named curve
  (Android's TLS refuses explicit EC parameters, LibreSSL's default):
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -pkeyopt ec_param_enc:named_curve -nodes -days 7 \\
    -subj /CN=strongroom-local -addext subjectAltName=IP:127.0.0.1 -keyout <dir>/key.pem -out <dir>/cert.pem
  A device reaches it through \`adb -s <serial> reverse tcp:<port> tcp:<port>\` and a debug build made with
  -PstrongroomSyncUrl=https://127.0.0.1:<port> -PstrongroomSyncCa=<dir>/cert.pem`;
const [dir, port = '8743'] = process.argv.slice(2);
if (!dir) throw new Error(USAGE);

const dbFile = join(dir, 'vault.db');
const fresh = !existsSync(dbFile);
const sqlite = new DatabaseSync(dbFile);
const migrations = new URL('../migrations/', import.meta.url);
if (fresh) for (const f of readdirSync(migrations).filter((n) => /^\d{4}_.*\.sql$/.test(n)).sort()) sqlite.exec(readFileSync(new URL(f, migrations), 'utf8'));

const tokenFile = join(dir, 'setup-token.txt');
if (!existsSync(tokenFile)) writeFileSync(tokenFile, randomBytes(20).toString('hex'), { mode: 0o600 });
const publicUrl = process.env.PUBLIC_URL ?? `https://127.0.0.1:${port}`;
const env = { DB: d1FromNodeSqlite(sqlite), SETUP_TOKEN: readFileSync(tokenFile, 'utf8').trim(), PUBLIC_URL: publicUrl };

// Test rig: <dir>/clock-offset-ms (read on every request) shifts the server clock; <dir>/mail-fail present makes the mailer throw; mail goes to <dir>/mail.log; <dir>/drop-reply loses PUT replies (below).
const now = () => Date.now() + (existsSync(join(dir, 'clock-offset-ms')) ? Number(readFileSync(join(dir, 'clock-offset-ms'), 'utf8').trim()) || 0 : 0);
const mail = {
  async send(to: string, subject: string, text: string) {
    if (existsSync(join(dir, 'mail-fail'))) throw new Error('fake mailer: mail-fail switch is on');
    appendFileSync(join(dir, 'mail.log'), `${JSON.stringify({ at: new Date(now()).toISOString(), to, subject, text })}\n`);
  },
};

// For the log only: which secret signed a request (the Worker decides access itself).
async function roleOf(auth: string | undefined): Promise<string> {
  const presented = /^Bearer (\S+)$/.exec(auth ?? '')?.[1];
  if (!presented) return 'none';
  if (presented === env.SETUP_TOKEN) return 'setup';
  const a = await getAccount(env.DB);
  const hash = createHash('sha256').update(Buffer.from(presented, 'base64')).digest('base64');
  return a?.loginHash === hash ? 'login' : a?.readHash === hash ? 'read' : a?.recoveryHash === hash ? 'recovery' : 'unknown';
}

const tls = { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
createServer(tls, async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const h of ['authorization', 'content-type']) if (req.headers[h]) headers.set(h, String(req.headers[h]));
  const role = await roleOf(req.headers.authorization);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const response = await handle(new Request(`${publicUrl}${req.url}`, { method: req.method, headers, body: hasBody ? Buffer.concat(chunks) : undefined }), env, { now, mail });
  const body = Buffer.from(await response.arrayBuffer());
  // Test rig: <dir>/drop-reply present makes a PUT /v1/account do its work and then lose the reply (the socket closes with no answer).
  // <dir>/drop-reply-once does the same for one PUT and then removes itself.
  const once = req.method === 'PUT' && existsSync(join(dir, 'drop-reply-once'));
  if (once) unlinkSync(join(dir, 'drop-reply-once'));
  if (once || (req.method === 'PUT' && existsSync(join(dir, 'drop-reply')))) {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${role} -> ${response.status}, REPLY DROPPED`);
    return void req.socket.destroy();
  }
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.writeHead(response.status).end(body);
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${role} -> ${response.status} (${body.length} bytes)`);
})
  .on('tlsClientError', (e) => console.log(`${new Date().toISOString()} TLS handshake failed: ${e.message}`))
  .listen(Number(port), '127.0.0.1', () => console.log(`vault-api on https://127.0.0.1:${port}, db ${dbFile}${fresh ? ' (new)' : ''}`));
