import { PIECE_BYTES } from './vision-host.ts';

// The app's half of the Uploads button on the phone. The WebView's own file chooser always adds a
// camera entry to an image input (react-native-webview 13.15.0 RNCWebViewModuleImpl.startPhotoPickerIntent,
// which only skips it when the app declares CAMERA), so the page asks the app to pick instead and
// feeds the bytes back into its own input. The picker copies each photo into the cache, so the
// pieces are read from a file path (a content:// read cannot promise whole pieces). The bytes cross
// in pieces of PIECE_BYTES, the same size as the vision transfer, and every copy is deleted when
// the page says it is done.
export type PickedImage = { uri: string; name: string; type: string; bytes: number };

export interface ImagePickDeps {
  // null when the person backs out; assets are cache copies
  pick(): Promise<{ uri: string; name: string; mimeType?: string | null }[] | null>;
  size(uri: string): Promise<number>;
  readBase64(uri: string, position: number, length: number): Promise<string>;
  remove(uri: string): Promise<void>;
}

export const COULD_NOT_OPEN = "Couldn't open your pictures. Try again.";

// bytes behind a base64 string (Hermes has no Buffer)
const decodedLength = (b64: string) => (b64.length * 3) / 4 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

export function createImagePicker(d: ImagePickDeps) {
  const held = new Map<string, number>(); // cache copy → bytes; only these may be read
  let busy = false;
  const drop = async (uri: string) => {
    held.delete(uri);
    await d.remove(uri).catch(() => {});
  };
  return {
    async pick(): Promise<PickedImage[]> {
      if (busy) return [];
      busy = true;
      let assets: Awaited<ReturnType<ImagePickDeps['pick']>> = null;
      try {
        assets = (await d.pick()) ?? [];
        const out: PickedImage[] = [];
        for (const a of assets) {
          const bytes = await d.size(a.uri);
          held.set(a.uri, bytes);
          out.push({ uri: a.uri, name: a.name, type: a.mimeType ?? '', bytes });
        }
        return out;
      } catch (err) {
        for (const a of assets ?? []) await drop(a.uri);
        throw err;
      } finally {
        busy = false;
      }
    },
    async read(uri: string, index: number): Promise<{ data: string; done: boolean }> {
      const bytes = held.get(uri);
      if (bytes === undefined || !Number.isInteger(index) || index < 0) throw new Error('This picture is no longer available.');
      if (bytes === 0) return { data: '', done: true };
      const want = Math.min(PIECE_BYTES, bytes - index * PIECE_BYTES);
      const data = await d.readBase64(uri, index * PIECE_BYTES, PIECE_BYTES);
      // the legacy reader does one read(), which may return less than asked; never pass a cut photo on
      if (want <= 0 || decodedLength(data) !== want) throw new Error(COULD_NOT_OPEN);
      return { data, done: (index + 1) * PIECE_BYTES >= bytes };
    },
    async release(uris: string[]): Promise<void> {
      for (const uri of uris) if (held.has(uri)) await drop(uri); // the page may only drop what it was given
    },
    async dispose(): Promise<void> {
      for (const uri of [...held.keys()]) await drop(uri);
    },
  };
}
