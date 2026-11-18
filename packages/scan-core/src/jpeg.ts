/** Width, height and component count from the first baseline or progressive SOF marker. */
export function jpegInfo(bytes: Uint8Array): { width: number; height: number; components: 1 | 3 } {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('not a JPEG');
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('not a JPEG');
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) throw new Error('not a JPEG');
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xc2) {
      if (i + 9 >= bytes.length) throw new Error('not a JPEG');
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const components = bytes[i + 9];
      if (components === 4) throw new Error('unsupported JPEG: CMYK');
      if (components !== 1 && components !== 3) throw new Error('not a JPEG');
      return { width, height, components };
    }
    i += 2 + length;
  }
  throw new Error('not a JPEG');
}
