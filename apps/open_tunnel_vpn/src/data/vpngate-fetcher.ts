import type { VpnGateFetcher } from 'open-tunnel-core';

const HEADERS_RECEIVED = 2;

// RN's fetch resolves only after the whole body, so the 15 s connect deadline would cover the
// 1.3 MB download and abort it ("Aborted"); XHR reports the headers moment itself.
export function xhrVpnGateFetcher(Xhr: typeof XMLHttpRequest = XMLHttpRequest): VpnGateFetcher {
  return (url, request) =>
    new Promise((resolve, reject) => {
      const xhr = new Xhr();
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value);
      xhr.onreadystatechange = () => {
        if (xhr.readyState === HEADERS_RECEIVED) request.onHeaders?.();
      };
      xhr.onload = () => {
        if (xhr.status >= 500) {
          reject(new Error(`source ${url} returned HTTP ${xhr.status}`));
          return;
        }
        const body = new Uint8Array(xhr.response as ArrayBuffer);
        resolve((async function* () {
          yield body;
        })());
      };
      xhr.onerror = () => reject(new Error(`source ${url} could not be reached`));
      xhr.onabort = () => reject(new Error('Aborted'));
      request.signal.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send();
    });
}
