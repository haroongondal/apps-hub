/**
 * The one signature permission that guards every app link (shares and actions).
 * The name still says "autopilot" for historical reasons: a rename would need every
 * app released at once, and Android lets a provider or activity name only one permission.
 */
export const LINK_PERMISSION = 'com.haroon.permission.AUTOPILOT';

/** Authorities that predate the `.applink` naming and stay valid. */
export const LEGACY_AUTHORITIES: readonly string[] = ['com.haroon.inflow.autopilot'];

const APP = /^[a-z][a-z0-9]*$/;
const SHARE_AUTHORITY = /^com\.haroon\.[a-z][a-z0-9]*\.applink$/;
const ACTION_NAME = /^[A-Z][A-Z0-9_]*$/;

/** `app` is the last part of the app's package name (inflow, deputy, designeditor, ...). */
export function shareAuthority(app: string): string {
  if (typeof app !== 'string' || !APP.test(app)) throw new Error(`app must match ${APP}, got ${JSON.stringify(app)}`);
  return `com.haroon.${app}.applink`;
}

export function isShareAuthority(s: unknown): s is string {
  return typeof s === 'string' && SHARE_AUTHORITY.test(s);
}

export function isKnownAuthority(s: unknown): s is string {
  return isShareAuthority(s) || (typeof s === 'string' && LEGACY_AUTHORITIES.includes(s));
}

/** Intent action string `com.haroon.<app>.action.<NAME>`. */
export function actionName(app: string, name: string): string {
  if (typeof app !== 'string' || !APP.test(app)) throw new Error(`app must match ${APP}, got ${JSON.stringify(app)}`);
  if (typeof name !== 'string' || !ACTION_NAME.test(name)) throw new Error(`action name must match ${ACTION_NAME}, got ${JSON.stringify(name)}`);
  return `com.haroon.${app}.action.${name}`;
}
