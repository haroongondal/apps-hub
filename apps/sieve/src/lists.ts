import type { FeatureKey } from '@apps-hub/sieve-core';

export const NAMES: Record<FeatureKey, string> = {
  ads: 'Ads',
  trackers: 'Trackers',
  distraction: 'Distraction control',
  cookies: 'Cookie banners',
  antiadblock: 'Ad blocker warnings',
  ai: 'AI search summaries',
};

export const LISTS: Record<Exclude<FeatureKey, 'ai'>, { urls: string[]; dropSections?: string[]; extra?: string[] }> & { ai: { file: string } } = {
  ads: {
    urls: ['https://easylist.to/easylist/easylist.txt'],
    // YouTube's player loads this script (it only sets `window.google_ad_status = 1`) and reports whether it arrived (`DCLKSTAT` 1, failed 2, timed out 3) in its
    // playback attestation. `||static.doubleclick.net^` blocks it, which reads as an ad blocker and brings the "Ad blockers violate YouTube's Terms of Service" wall.
    extra: ['@@||static.doubleclick.net/instream/ad_status.js$script,domain=youtube.com|youtube-nocookie.com'],
  },
  trackers: { urls: ['https://easylist.to/easylist/easyprivacy.txt'] },
  // Fanboy's Annoyances bundles the cookie lists; those belong to the cookies feature.
  distraction: { urls: ['https://secure.fanboy.co.nz/fanboy-annoyance.txt'], dropSections: ['easylist_cookie_'] },
  cookies: { urls: ['https://secure.fanboy.co.nz/fanboy-cookiemonster.txt'] },
  antiadblock: {
    urls: ['https://easylist-downloads.adblockplus.org/antiadblockfilters.txt', 'https://easylist-downloads.adblockplus.org/abp-filters-anti-cv.txt'],
  },
  ai: { file: 'filters/ai-summaries.txt' },
};
