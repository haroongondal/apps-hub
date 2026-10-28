import test from 'node:test';
import assert from 'node:assert/strict';

import { VpnGateFetchException, VpnGateService } from 'open-tunnel-core';
import { xhrVpnGateFetcher } from '../vpngate-fetcher.ts';

const config = Buffer.from('client\ndev tun\nproto tcp\nremote 1.2.3.4 443\n<ca>\nx\n</ca>\n').toString('base64');
const body = `*vpn_servers\n#HostName\nrelay-1,1.2.3.4,1,10,1000000,Japan,JP,1,100,1,1,2weeks,op,msg,${config}\n*\n`;

// Mimics React Native's XHR: headers first, then the whole body in one load event.
function fakeXhr(headersAfterMs: number | null, bodyAfterMs: number) {
  return class {
    readyState = 0;
    status = 0;
    response: ArrayBuffer | null = null;
    responseType = '';
    onreadystatechange: (() => void) | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    private timers: ReturnType<typeof setTimeout>[] = [];
    open() {}
    setRequestHeader() {}
    send() {
      if (headersAfterMs === null) return;
      this.timers.push(setTimeout(() => {
        this.readyState = 2;
        this.status = 200;
        this.onreadystatechange?.();
      }, headersAfterMs));
      this.timers.push(setTimeout(() => {
        this.readyState = 4;
        this.response = new TextEncoder().encode(body).buffer as ArrayBuffer;
        this.onload?.();
      }, bodyAfterMs));
    }
    abort() {
      this.timers.forEach(clearTimeout);
      this.onabort?.();
    }
  } as unknown as typeof XMLHttpRequest;
}

test('a download slower than the connect deadline still succeeds once headers arrived', async () => {
  const service = new VpnGateService({
    fetcher: xhrVpnGateFetcher(fakeXhr(5, 120)),
    sources: ['https://example.test/'],
    connectTimeoutMs: 40,
    receiveTimeoutMs: 1000,
  });
  const nodes = await service.fetchNodes();
  assert.deepEqual(nodes.map((node) => node.ip), ['1.2.3.4']);
});

test('a source that never sends headers is aborted at the connect deadline', async () => {
  const service = new VpnGateService({
    fetcher: xhrVpnGateFetcher(fakeXhr(null, 0)),
    sources: ['https://example.test/'],
    connectTimeoutMs: 40,
  });
  await assert.rejects(service.fetchNodes(), (error: unknown) => {
    assert.ok(error instanceof VpnGateFetchException);
    assert.equal((error.cause as Error).message, 'Aborted');
    return true;
  });
});
