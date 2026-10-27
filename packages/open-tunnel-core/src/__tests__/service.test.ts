/**
 * VpnGateService test suite (node --test).
 * The Dart suite deliberately avoided the network; the TS port keeps that
 * rule but covers the fetcher seam: source ordering, fallback on failed or
 * empty sources, the VpnGateFetchException contract, and — against a local
 * loopback HTTP server — the default platform fetcher end to end.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  defaultVpnGateFetcher,
  VpnGateFetchException,
  VpnGateService,
} from '../vpngate-service.ts';
import { csvRow, HEADER_LINE, ovpnConfig } from './fixtures.ts';

function fixtureBody(rows: readonly string[]): string {
  return ['*vpn_servers', HEADER_LINE, ...rows, '', '*'].join('\n') + '\n';
}

/** Builds an AbortSignal-aware fetcher from a canned per-URL reaction. */
function fetcherFrom(
  reactions: Record<string, AsyncIterable<Uint8Array> | Error>,
) {
  return async (url: string, request: { signal: AbortSignal }) => {
    void request;
    const reaction = reactions[url] ?? new Error(`unexpected source ${url}`);
    if (reaction instanceof Error) throw reaction;
    return reaction;
  };
}

function bodyFromText(text: string): AsyncIterable<Uint8Array> {
  return (async function* () {
    // Two chunks prove the line splitter stitches chunk boundaries together.
    const bytes = Buffer.from(text, 'utf8');
    const mid = Math.floor(bytes.length / 2);
    yield bytes.subarray(0, mid);
    yield bytes.subarray(mid);
  })();
}

const sourceA = 'https://www.vpngate.net/api/iphone/';
const sourceB = 'http://www.vpngate.net/api/iphone/';

/** Delay raced against the abort signal: resolves, or rejects 'Aborted'. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Streams `text` in two chunks `gapMs` apart, honouring the abort signal;
 * `stallAfterYields` hangs (until aborted) after that many chunks — the
 * streamless-platform shape where a download is long and can stall.
 */
function streamBody(
  text: string,
  gapMs: number,
  stallAfterYields?: number,
): (url: string, request: { signal: AbortSignal }) => Promise<AsyncIterable<Uint8Array>> {
  return async (_url, request) => {
    const bytes = Buffer.from(text, 'utf8');
    const mid = Math.floor(bytes.length / 2);
    let yielded = 0;
    return (async function* () {
      for (const part of [bytes.subarray(0, mid), bytes.subarray(mid)]) {
        if (yielded > 0) await abortableDelay(gapMs, request.signal);
        yield part;
        yielded += 1;
        if (stallAfterYields !== undefined && yielded >= stallAfterYields) {
          await abortableDelay(10_000, request.signal);
        }
      }
    })();
  };
}

const TWO_NODE_BODY = fixtureBody([
  csvRow({ ip: '219.100.37.110', ovpnConfig: ovpnConfig({ port: 1195 }) }),
  csvRow({
    host: 'public-vpn-9',
    ip: '219.100.37.9',
    ovpnConfig: ovpnConfig({ port: 443, proto: 'tcp' }),
  }),
]);

test('first source wins when it yields rows', async () => {
  const service = new VpnGateService({
    fetcher: fetcherFrom({ [sourceA]: bodyFromText(TWO_NODE_BODY) }),
    sources: [sourceA, sourceB],
  });
  const nodes = await service.fetchNodes();
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0]!.ip, '219.100.37.110');
  assert.equal(nodes[1]!.port, 443);
});

test('falls back to the next source on failure or empty bodies', async () => {
  const service = new VpnGateService({
    fetcher: fetcherFrom({
      [sourceA]: bodyFromText(''), // empty body ⇒ failed source
      [sourceB]: bodyFromText(TWO_NODE_BODY),
    }),
    sources: [sourceA, sourceB],
  });
  const nodes = await service.fetchNodes();
  assert.equal(nodes.length, 2);
});

test('a body with zero usable rows is a failed source', async () => {
  const service = new VpnGateService({
    fetcher: fetcherFrom({
      [sourceA]: bodyFromText('*vpn_servers\n*\n'),
      [sourceB]: bodyFromText(TWO_NODE_BODY),
    }),
    sources: [sourceA, sourceB],
  });
  const nodes = await service.fetchNodes();
  assert.equal(nodes.length, 2);
});

test('all sources failing raises VpnGateFetchException with the cause', async () => {
  const service = new VpnGateService({
    fetcher: fetcherFrom({
      [sourceA]: new Error('dns dead'),
      [sourceB]: new Error('refused'),
    }),
    sources: [sourceA, sourceB],
  });
  await assert.rejects(
    service.fetchNodes(),
    (error: unknown) => {
      assert.ok(error instanceof VpnGateFetchException);
      assert.deepEqual(error.sourcesTried, [sourceA, sourceB]);
      assert.equal((error.cause as Error).message, 'refused');
      assert.match(error.message, /all 2 sources failed/);
      return true;
    },
  );
});

test('headers that never establish inside the connect deadline abort', async () => {
  const service = new VpnGateService({
    fetcher: async (_url, request) => {
      await abortableDelay(50, request.signal);
      return bodyFromText(TWO_NODE_BODY);
    },
    sources: [sourceA],
    connectTimeoutMs: 10,
  });
  await assert.rejects(service.fetchNodes(), VpnGateFetchException);
});

test('a slow-but-flowing body is not aborted while chunks keep arriving', async () => {
  const service = new VpnGateService({
    fetcher: streamBody(TWO_NODE_BODY, 5),
    sources: [sourceA],
    connectTimeoutMs: 1_000,
    receiveTimeoutMs: 20,
  });
  const nodes = await service.fetchNodes();
  assert.equal(nodes.length, 2);
});

test('a stalled body is aborted by the receive deadline', async () => {
  const service = new VpnGateService({
    fetcher: streamBody(TWO_NODE_BODY, 5, 1),
    sources: [sourceA],
    connectTimeoutMs: 1_000,
    receiveTimeoutMs: 20,
  });
  await assert.rejects(
    service.fetchNodes(),
    (error: unknown) => {
      assert.ok(error instanceof VpnGateFetchException);
      assert.equal((error.cause as Error).message, 'Aborted');
      return true;
    },
  );
});

test('default fetcher parses a real loopback HTTP body end to end', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    // Stream in two long-flap chunks so the reader + line splitter pipeline
    // is exercised, not just the buffered fallback.
    res.write(TWO_NODE_BODY.slice(0, 117));
    setTimeout(() => {
      res.end(TWO_NODE_BODY.slice(117));
    }, 30);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}/api/iphone/`;

  const service = new VpnGateService({
    fetcher: defaultVpnGateFetcher(),
    sources: [url],
  });
  const nodes = await service.fetchNodes();
  assert.equal(nodes.length, 2);
  assert.match(nodes[0]!.ovpnConfigRaw, /data-ciphers/);

  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});
