/** VPN Gate row streams arrive as byte chunks; Hermes has no TextDecoder, so
 * line splitting happens at byte level (`\n`, `\r`, `\r\n`) before decoding,
 * which also keeps partial UTF-8 sequences from ever crossing a chunk
 * boundary mid-line. */

import { utf8DecodeTolerant } from './base64.ts';

export async function* linesFromBytes(
  chunks: AsyncIterable<Uint8Array>,
): AsyncIterable<string> {
  let pending: Uint8Array = new Uint8Array(0);

  for await (const chunk of chunks) {
    if (pending.length === 0) {
      pending = chunk;
    } else {
      const merged = new Uint8Array(pending.length + chunk.length);
      merged.set(pending, 0);
      merged.set(chunk, pending.length);
      pending = merged;
    }

    let start = 0;
    for (let i = 0; i < pending.length; i++) {
      const b = pending[i]!;
      if (b !== 0x0a && b !== 0x0d) continue;
      const lineBytes = pending.subarray(start, i);
      start = i + 1;
      // Normalize \r\n into a single break: skip the \n that follows a \r.
      if (b === 0x0d && start < pending.length && pending[start] === 0x0a) {
        i++;
        start++;
      }
      yield decodeLine(lineBytes);
    }
    pending = pending.subarray(start);
  }

  if (pending.length > 0) {
    yield decodeLine(pending);
  }
}

/** Splits a complete byte payload the same way (used by tests and the smoke tool). */
export function linesFromByteArray(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b !== 0x0a && b !== 0x0d) continue;
    lines.push(decodeLine(bytes.subarray(start, i)));
    start = i + 1;
    if (b === 0x0d && start < bytes.length && bytes[start] === 0x0a) {
      i++;
      start++;
    }
  }
  if (start < bytes.length) {
    lines.push(decodeLine(bytes.subarray(start)));
  }
  return lines;
}

function decodeLine(raw: Uint8Array): string {
  return utf8DecodeTolerant(raw);
}
