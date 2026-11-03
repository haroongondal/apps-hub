/**
 * User-facing firewall copy. Pure strings: the screen renders them as is.
 */

export function privateDnsMessage(provider: string): string {
  return `To see website names, set Private DNS to Automatic. Lookups will still go to ${provider}.`;
}

export const FIREWALL_PAUSED_LINE = "The firewall is paused while you're connected to a VPN server.";

export const LAN_COVERAGE_LINE =
  "Traffic that stays on your local network and HomeNet's own traffic aren't logged or blockable.";

/** The consent screen, in the order the user reads it. */
export const FIREWALL_CONSENT_POINTS: readonly string[] = [
  "The firewall sees every connection's app, address or domain, and data amount.",
  'This stays on your phone and is never uploaded.',
  "The firewall pauses while you're connected to a VPN server.",
  'The firewall uses some battery.',
];
