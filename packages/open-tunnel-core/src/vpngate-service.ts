/**
 * VpnGateService — fetches, stream-parses, and hands back the current VPN
 * Gate list. 1:1 port of the Dart `VpnGateService`, with the HTTP transport
 * injected so tests run without network and RN can wire its native fetch
 * stack in one place.
 *
 * All parsing happens in the app UI process: nothing here may be imported by
 * the iOS packet tunnel extension.
 */
import { linesFromBytes } from './lines.ts';
import { parseVpnGateCsv, VPN_GATE_CONNECT_TIMEOUT_MS, VPN_GATE_RECEIVE_TIMEOUT_MS, VPN_GATE_SOURCES } from './vpngate.ts';
import type { VpnNode } from './vpn-node.ts';

/** Raised when every configured VPN Gate source failed. */
export class VpnGateFetchException extends Error {
  readonly sourcesTried: readonly string[];
  readonly cause: unknown;

  constructor(sourcesTried: readonly string[], cause: unknown) {
    super(
      `VpnGateFetchException: all ${sourcesTried.length} sources failed ` +
        `(${describe(cause)})`,
    );
    this.name = 'VpnGateFetchException';
    this.sourcesTried = sourcesTried;
    this.cause = cause;
  }
}

function describe(cause: unknown): string {
  if (cause === undefined) return 'unknown';
  if (cause instanceof Error) return cause.message;
  return String(cause);
}

/**
 * Returns the response body as a byte stream. A body without rows counts as
 * a failed source. Implementations must never buffer the multi-megabyte body
 * in memory as one string.
 *
 * `onHeaders` is optional and called exactly once when the response headers
 * are established — the moment the service stops enforcing the connect
 * deadline and starts the receive (data-gap) deadline. Streamless platforms
 * (React Native has no streaming fetch bodies) download inside the fetcher
 * after the headers, so without this hook the whole body download would run
 * under the connect deadline and healthy-but-slow transfers would abort.
 */
export type VpnGateFetcher = (
  url: string,
  request: {
    headers: Record<string, string>;
    signal: AbortSignal;
    onHeaders?: () => void;
  },
) => Promise<AsyncIterable<Uint8Array>>;

/** Wraps the platform `fetch` (RN 0.81 global fetch, Node 22 undici). */
export function defaultVpnGateFetcher(): VpnGateFetcher {
  return async (url, request) => {
    const response = await fetch(url, {
      headers: request.headers,
      signal: request.signal,
      // VPN Gate redirects and its mirrors hop hosts; decode any body we
      // receive instead of throwing on status mismatches.
      redirect: 'follow',
    });
    // Headers are established here on Node; React Native resolves fetch only after the whole body, so the app injects an XHR fetcher.
    request.onHeaders?.();
    if (response.status >= 500) {
      throw new Error(`source ${url} returned HTTP ${response.status}`);
    }
    const body = response.body;
    if (body) {
      // `getReader()` instead of `for await` over the stream: DOM typings
      // only promise this iteration shape, and it works identically under
      // Node 22 undici and the RN network stack.
      const reader = body.getReader();
      return (async function* () {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield value;
        }
      })();
    }
    // Platforms without streaming bodies: deliver the buffered body as one
    // chunk (still decoded progressively line by line downstream).
    const buffered = new Uint8Array(await response.arrayBuffer());
    return (async function* () {
      yield buffered;
    })();
  };
}

/** Resets the receive (data-gap) deadline as every chunk flows through. */
function idleResetting(
  stream: AsyncIterable<Uint8Array>,
  restart: () => void,
): AsyncIterable<Uint8Array> {
  return (async function* () {
    for await (const chunk of stream) {
      restart();
      yield chunk;
    }
  })();
}

export class VpnGateService {
  private readonly fetcher: VpnGateFetcher;
  private readonly sources: readonly string[];
  private readonly connectTimeoutMs: number;
  private readonly receiveTimeoutMs: number;

  constructor(options?: {
    fetcher?: VpnGateFetcher;
    sources?: readonly string[];
    connectTimeoutMs?: number;
    receiveTimeoutMs?: number;
  }) {
    this.fetcher = options?.fetcher ?? defaultVpnGateFetcher();
    this.sources = [...(options?.sources ?? VPN_GATE_SOURCES)];
    this.connectTimeoutMs = options?.connectTimeoutMs ?? VPN_GATE_CONNECT_TIMEOUT_MS;
    this.receiveTimeoutMs = options?.receiveTimeoutMs ?? VPN_GATE_RECEIVE_TIMEOUT_MS;
  }

  /** Fetches the current node list, trying each source in order.
   * Throws {@link VpnGateFetchException} when every source fails. */
  async fetchNodes(): Promise<VpnNode[]> {
    let lastCause: unknown;
    for (const source of this.sources) {
      try {
        const nodes = await this.fetchSource(source);
        // A body without rows counts as a failed source.
        if (nodes.length === 0) continue;
        return nodes;
      } catch (error) {
        lastCause = error;
      }
    }
    throw new VpnGateFetchException(this.sources, lastCause);
  }

  private async fetchSource(source: string): Promise<VpnNode[]> {
    // Phase 1 (connect): die if the response headers are not established
    // within the connect deadline.
    const controller = new AbortController();
    let connectTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => controller.abort(),
      this.connectTimeoutMs,
    );

    // Phase 2 (receive): a data-gap deadline — reset on every chunk, so a
    // slow-but-flowing 1.3 MB transfer lives and a stalled one dies. Streamless
    // platforms deliver the whole body as one chunk after the download, so the
    // timer is also armed at the headers moment to guard that download.
    let receiveTimer: ReturnType<typeof setTimeout> | undefined;
    const restartIdleTimer = () => {
      if (receiveTimer !== undefined) clearTimeout(receiveTimer);
      receiveTimer = setTimeout(() => controller.abort(), this.receiveTimeoutMs);
    };

    try {
      const chunks = await this.fetcher(source, {
        headers: { 'User-Agent': 'OpenTunnel/0.1' },
        signal: controller.signal,
        // Fetchers that honour the hook end the connect deadline here
        // (default platform fetcher); the explicit call below covers the
        // injected fetchers that ignore it.
        onHeaders: () => {
          if (connectTimer !== undefined) {
            clearTimeout(connectTimer);
            connectTimer = undefined;
          }
          restartIdleTimer();
        },
      });
      if (connectTimer !== undefined) {
        clearTimeout(connectTimer);
        connectTimer = undefined;
      }
      restartIdleTimer();

      const nodes: VpnNode[] = [];
      for await (const node of parseVpnGateCsv(
        linesFromBytes(idleResetting(chunks, restartIdleTimer)),
      )) {
        nodes.push(node);
      }
      if (nodes.length === 0) {
        throw new Error(`source ${source} produced no usable rows`);
      }
      return nodes;
    } finally {
      if (connectTimer !== undefined) clearTimeout(connectTimer);
      if (receiveTimer !== undefined) clearTimeout(receiveTimer);
    }
  }
}
