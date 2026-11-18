/**
 * Join-this-Wi-Fi QR text (the de-facto ZXing "WIFI:" format that phone cameras read).
 * Pure: no network, no storage.
 */
export interface GuestWifi {
  ssid: string;
  password: string;
  open: boolean;
}

// Backslash first, so the backslashes added for the other characters are not escaped again.
const escapeValue = (value: string): string => value.replace(/[\\;,:"]/g, (ch) => `\\${ch}`);

// Readers take an all-hex value as raw hex bytes; the format wants it quoted to stay text.
const field = (value: string): string => (/^[0-9a-fA-F]+$/.test(value) ? `"${value}"` : escapeValue(value));

/** An empty name gives an empty string: there is nothing to join. */
export function wifiQrText(w: GuestWifi): string {
  if (w.ssid === '') return '';
  return w.open ? `WIFI:T:nopass;S:${field(w.ssid)};;` : `WIFI:T:WPA;S:${field(w.ssid)};P:${field(w.password)};;`;
}
