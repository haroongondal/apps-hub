export type CallerReason = 'self' | 'ok' | 'no-permission' | 'signature-mismatch';
export interface CallerFacts {
  /** The caller runs in this app's own uid. */
  isSelf: boolean;
  /** The caller holds LINK_PERMISSION. */
  holdsPermission: boolean;
  /** The caller's signing certificate equals this app's (PackageManager.checkSignatures). */
  signatureMatches: boolean;
}
export interface CallerDecision { allow: boolean; reason: CallerReason }

/**
 * The decision every provider and action makes before serving a caller. The Kotlin guard
 * (AppLinkGuard) mirrors it and both read fixtures/caller-decisions.json.
 * The signature check backs up the permission in case a hostile app squatted its name.
 * Fails closed: anything that is not exactly `true` counts as false.
 */
export function decideCaller(facts: CallerFacts): CallerDecision {
  if (facts?.isSelf === true) return { allow: true, reason: 'self' };
  if (facts?.holdsPermission !== true) return { allow: false, reason: 'no-permission' };
  if (facts.signatureMatches !== true) return { allow: false, reason: 'signature-mismatch' };
  return { allow: true, reason: 'ok' };
}

/** Mirrors AppLinkActivityCaller.allowedActivityCaller; both read fixtures/activity-caller-decisions.json. */
export function allowedActivityCaller(callingPackage: string | null | undefined, signaturesMatch: boolean): boolean {
  return typeof callingPackage === 'string' && callingPackage.length > 0 && signaturesMatch === true;
}
