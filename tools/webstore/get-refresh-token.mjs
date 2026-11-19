import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = join(dirname(fileURLToPath(import.meta.url)), '.env');
try { process.loadEnvFile(envFile); } catch { /* the file is optional */ }
const { CLIENT_ID, CLIENT_SECRET } = process.env;
if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set CLIENT_ID and CLIENT_SECRET in tools/webstore/.env first.');
  process.exit(2);
}

const state = randomBytes(16).toString('hex');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/') return res.writeHead(404).end();
  const code = url.searchParams.get('code');
  if (url.searchParams.get('state') !== state || !code) return res.writeHead(400).end('Bad request');
  const body = new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: redirect, grant_type: 'authorization_code' });
  const token = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body })).json();
  res.end(token.refresh_token ? 'Done. You can close this tab.' : 'No refresh token. See the terminal.');
  server.close();
  if (!token.refresh_token) {
    console.error('Google returned no refresh token:', token.error_description ?? token.error ?? 'unknown error');
    process.exit(1);
  }
  appendFileSync(envFile, `\nREFRESH_TOKEN=${token.refresh_token}\n`);
  console.log('Saved REFRESH_TOKEN to tools/webstore/.env');
});

let redirect = '';
server.listen(0, '127.0.0.1', () => {
  redirect = `http://127.0.0.1:${server.address().port}`;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirect, response_type: 'code', state,
    scope: 'https://www.googleapis.com/auth/chromewebstore', access_type: 'offline', prompt: 'consent',
  });
  console.log('Opening the browser. If it does not open, visit:\n' + auth);
  try { execFileSync('open', [auth.href]); } catch { /* the URL is printed above */ }
});
