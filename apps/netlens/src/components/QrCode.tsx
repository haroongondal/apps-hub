/**
 * QrCode: draws a QR code for `text` as Views, with no image or native dependency.
 * Dark runs in a row are merged into one View, so a typical code is a few hundred Views.
 */
import React, { useMemo } from 'react';
import { useWindowDimensions, View } from 'react-native';
import qrcode from 'qrcode-generator';

// Phone cameras need black on white to read a code, so these two ignore the theme tokens.
const INK = '#000000';
const PAPER = '#ffffff';
const QUIET_ZONE = 4;
const MAX_SIZE = 280;
// Room for the screen padding on narrow phones.
const SIDE_ROOM = 64;

// Names can be non-ASCII and scanners read UTF-8. Metro loads the ESM build, which has no
// stringToBytesFuncs, and Hermes may lack TextEncoder, so encode by hand (lone surrogate -> U+FFFD).
export function utf8Bytes(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    let cp = ch.codePointAt(0) ?? 0xfffd;
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return out;
}
qrcode.stringToBytes = utf8Bytes;

interface Run {
  row: number;
  col: number;
  len: number;
}

function darkRuns(text: string): { count: number; runs: Run[] } {
  const qr = qrcode(0, 'M');
  try {
    qr.addData(text);
    qr.make();
  } catch {
    // Text over the largest code's capacity throws a string; draw nothing rather than crash.
    return { count: 0, runs: [] };
  }
  const count = qr.getModuleCount();
  const runs: Run[] = [];
  for (let row = 0; row < count; row += 1) {
    let start = -1;
    for (let col = 0; col <= count; col += 1) {
      const dark = col < count && qr.isDark(row, col);
      if (dark && start < 0) start = col;
      if (!dark && start >= 0) {
        runs.push({ row, col: start, len: col - start });
        start = -1;
      }
    }
  }
  return { count, runs };
}

export function QrCode({ text, label }: { text: string; label: string }) {
  const { width } = useWindowDimensions();
  const { count, runs } = useMemo(() => darkRuns(text), [text]);
  if (count === 0) return null;
  const total = count + QUIET_ZONE * 2;
  // Whole dp per module keeps the edges sharp, which scanners like.
  const cell = Math.max(1, Math.floor(Math.min(MAX_SIZE, width - SIDE_ROOM) / total));
  const size = cell * total;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{ width: size, height: size, backgroundColor: PAPER, alignSelf: 'center' }}
    >
      {runs.map((run) => (
        <View
          key={`${run.row}-${run.col}`}
          style={{
            position: 'absolute',
            left: (run.col + QUIET_ZONE) * cell,
            top: (run.row + QUIET_ZONE) * cell,
            width: run.len * cell,
            height: cell,
            backgroundColor: INK,
          }}
        />
      ))}
    </View>
  );
}
