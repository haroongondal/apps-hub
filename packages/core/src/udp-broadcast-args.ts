/**
 * Argument check done in JS before the native call. Expo's iOS bridge turns a JS number into an Int with
 * `Int(double.rounded())`, which traps on NaN, Infinity and huge values before the native validate runs, and
 * Android truncates (NaN becomes 0, 255.6 becomes 255) where iOS rounds. Only exact integers reach native code.
 * Error texts match UdpBroadcast.validate (Kotlin and Swift). The address is checked natively.
 */
export function udpBroadcastArgsError(port: number, payload: readonly number[]): string | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'port must be in 1..65535';
  if (payload.length < 1 || payload.length > 1024) return 'payload must be 1..1024 bytes';
  if (!payload.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
    return 'payload bytes must be in 0..255';
  }
  return null;
}
