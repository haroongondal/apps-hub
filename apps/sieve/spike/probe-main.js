(() => {
  const post = (msg) => window.postMessage({ source: 'sieve-spike', ...msg }, location.origin);
  const PLACEHOLDER = 'https://example.invalid/stream';
  const SECRET_KEY = /servingdata|trackingparams|baseurl|url$|token$|^signaturecipher$/i;
  const FIXTURE_KEYS = ['videoDetails', 'streamingData', 'adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams'];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const videoIdNow = () => new URL(location.href).searchParams.get('v');

  // ytInitialPlayerResponse goes stale after in-app navigation, so accept whichever source matches the URL.
  async function playerResponse() {
    const want = videoIdNow();
    for (let i = 0; i < 40; i++) {
      const candidates = [window.ytInitialPlayerResponse, document.getElementById('movie_player')?.getPlayerResponse?.()];
      const hit = candidates.find((c) => c?.videoDetails?.videoId === want);
      if (hit) return hit;
      await sleep(250);
    }
    throw new Error(`no player response for ${want} after 10 s`);
  }

  const has = (f) => (f.url ? 'url' : f.signatureCipher ? 'cipher' : 'none');
  const fmt = (f) => ({
    itag: f.itag, mimeType: f.mimeType, height: f.height ?? null, bitrate: f.bitrate ?? null,
    contentLength: f.contentLength ? Number(f.contentLength) : null, has: has(f),
  });
  const scrub = (v, key = '') => Array.isArray(v) ? v.map((x) => scrub(x))
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, k)]))
    : typeof v === 'string' && (SECRET_KEY.test(key) || /^https?:\/\//.test(v)) ? PLACEHOLDER : v;

  async function S1() {
    const pr = await playerResponse();
    const sd = pr.streamingData ?? {};
    post({ fixture: scrub(Object.fromEntries(FIXTURE_KEYS.filter((k) => k in pr).map((k) => [k, pr[k]]))) });
    return {
      videoId: pr.videoDetails.videoId,
      strategy: 'S1',
      playability: pr.playabilityStatus?.status ?? null,
      reason: pr.playabilityStatus?.reason ?? null,
      sabr: !!sd.serverAbrStreamingUrl,
      formats: (sd.adaptiveFormats ?? []).map(fmt),
      muxed: (sd.formats ?? []).map(fmt),
    };
  }

  const STRATEGIES = { S1 };

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.source !== 'sieve-spike-cmd') return;
    const loggedIn = window.ytcfg ? !!window.ytcfg.get('LOGGED_IN') : null;
    for (const [strategy, run] of Object.entries(STRATEGIES)) {
      try { post({ result: { ...(await run()), loggedIn } }); }
      catch (err) { post({ result: { strategy, videoId: videoIdNow(), loggedIn, error: String(err?.message ?? err) } }); }
    }
    post({ done: e.data.id });
  });
})();
