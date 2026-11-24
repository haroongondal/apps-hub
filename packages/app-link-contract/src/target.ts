// Equal to fixtures/sibling-packages.json and to SiblingPackages in android/AppLinkTarget.kt; target.test.ts checks both.
export const SIBLING_PACKAGES = {
  netlens: 'app.netlens',
  'open-tunnel': 'com.opentunnel.open_tunnel_vpn',
  deputy: 'com.haroon.deputy',
  strongroom: 'com.haroon.strongroom',
  inflow: 'com.haroon.inflow',
  'pdf-editor': 'com.haroon.pdfeditor',
  clipboard: 'com.haroon.clipboard',
  halo: 'com.haroon.halo',
  'design-editor': 'com.haroon.designeditor',
  'ai-hub': 'com.haroon.aihub',
} as const;
export type SiblingAppId = keyof typeof SIBLING_PACKAGES;

export type SpoofReason = 'unknown-sibling' | 'wrong-package' | 'signature-mismatch';
export type TargetDecision =
  | { trust: 'trusted'; reason: 'ok' }
  | { trust: 'not-installed'; reason: 'not-installed' }
  | { trust: 'spoofed'; reason: SpoofReason };

const KNOWN: readonly string[] = Object.values(SIBLING_PACKAGES);

// Mirrors AppLinkTarget.decide (both read fixtures/target-decisions.json); package names compare exactly, anything odd fails closed.
export function decideTarget(expectedPackage: string, resolvedPackage: string | null | undefined, signaturesMatch: boolean): TargetDecision {
  if (typeof expectedPackage !== 'string' || !KNOWN.includes(expectedPackage)) return { trust: 'spoofed', reason: 'unknown-sibling' };
  if (typeof resolvedPackage !== 'string' || resolvedPackage.length === 0) return { trust: 'not-installed', reason: 'not-installed' };
  if (resolvedPackage !== expectedPackage) return { trust: 'spoofed', reason: 'wrong-package' };
  if (signaturesMatch !== true) return { trust: 'spoofed', reason: 'signature-mismatch' };
  return { trust: 'trusted', reason: 'ok' };
}
