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

// Names can be non-ASCII; the default encoder would drop them.
qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];

interface Run {
  row: number;
  col: number;
  len: number;
}

function darkRuns(text: string): { count: number; runs: Run[] } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
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
