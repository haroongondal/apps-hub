import type { FeatureKey } from '@apps-hub/sieve-core';

export const NAMES: Record<FeatureKey, string> = {
  ads: 'Ads',
  trackers: 'Trackers',
  distraction: 'Distraction control',
  cookies: 'Cookie banners',
  antiadblock: 'Ad blocker warnings',
  ai: 'AI search summaries',
};

export const LISTS: Record<Exclude<FeatureKey, 'ai'>, { urls: string[]; dropSections?: string[] }> & { ai: { file: string } } = {
  ads: { urls: ['https://easylist.to/easylist/easylist.txt'] },
  trackers: { urls: ['https://easylist.to/easylist/easyprivacy.txt'] },
  // Fanboy's Annoyances bundles the cookie lists; those belong to the cookies feature.
  distraction: { urls: ['https://secure.fanboy.co.nz/fanboy-annoyance.txt'], dropSections: ['easylist_cookie_'] },
  cookies: { urls: ['https://secure.fanboy.co.nz/fanboy-cookiemonster.txt'] },
  antiadblock: {
    urls: ['https://easylist-downloads.adblockplus.org/antiadblockfilters.txt', 'https://easylist-downloads.adblockplus.org/abp-filters-anti-cv.txt'],
  },
  ai: { file: 'filters/ai-summaries.txt' },
};
