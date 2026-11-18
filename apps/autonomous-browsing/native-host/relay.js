#!/usr/bin/env node
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ENDPOINT =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\outsentia-automation'
    : path.join(os.homedir(), '.outsentia-automation.sock');

// Chrome discards a native host's stderr; the only symptom is "native host has exited".
const LOG = path.join(os.homedir(), '.outsentia-automation.log');
const log = (...parts) => {
  try {
    fs.appendFileSync(LOG, `${new Date().toISOString()} [${process.pid}] ${parts.join(' ')}\n`);
  } catch {}
};

process.on('uncaughtException', (error) => {
  log('UNCAUGHT', error.stack || String(error));
  process.exit(1);
});
process.on('exit', (code) => log('exit', code));

log('start', 'argv=' + JSON.stringify(process.argv.slice(1)), 'endpoint=' + ENDPOINT);

let sock = null;
let backlog = [];

function toChrome(obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
  log('-> chrome', body.length + 'b');
}

function connect() {
  sock = net.connect(ENDPOINT);
  sock.setEncoding('utf8');

  sock.on('connect', () => {
    log('socket connected');
    for (const message of backlog) sock.write(JSON.stringify(message) + '\n');
    backlog = [];
  });

  let buffer = '';
  sock.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.trim()) {
        try {
          toChrome(JSON.parse(line));
        } catch (error) {
          log('bad json from app', error.message);
        }
      }
      newline = buffer.indexOf('\n');
    }
  });

  sock.on('error', (error) => log('socket error', error.code || error.message));
  sock.on('close', () => {
    log('socket closed, retrying in 1s');
    sock = null;
    setTimeout(connect, 1000);
  });
}

function toApp(obj) {
  if (sock && !sock.destroyed && sock.readyState === 'open') {
    sock.write(JSON.stringify(obj) + '\n');
    log('-> app', obj.type || obj.id || '?');
    return;
  }
  backlog.push(obj);
  log('backlogged', obj.type || obj.id || '?');
}

let pending = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk]);
  for (;;) {
    if (pending.length < 4) return;
    const length = pending.readUInt32LE(0);
    if (pending.length < 4 + length) return;
    const body = pending.subarray(4, 4 + length).toString('utf8');
    pending = pending.subarray(4 + length);
    try {
      toApp(JSON.parse(body));
    } catch (error) {
      log('bad json from chrome', error.message);
    }
  }
});

process.stdin.on('end', () => {
  log('stdin ended — chrome closed the port');
  process.exit(0);
});

connect();
