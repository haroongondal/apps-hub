(() => {
  const post = (msg) => window.postMessage({ source: 'sieve-spike', ...msg }, '*');
  const PLACEHOLDER = 'https://example.invalid/stream';
  const URL_KEYS = new Set(['url', 'signatureCipher', 'serverAbrStreamingUrl']);
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
  const scrub = (v) => Array.isArray(v) ? v.map(scrub)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, URL_KEYS.has(k) ? PLACEHOLDER : scrub(x)]))
    : v;

  async function S1() {
    const pr = await playerResponse();
    const sd = pr.streamingData ?? {};
    post({ fixture: scrub(Object.fromEntries(FIXTURE_KEYS.filter((k) => k in pr).map((k) => [k, pr[k]]))) });
    return {
      videoId: pr.videoDetails.videoId,
      strategy: 'S1',
      loggedIn: !!window.ytcfg.get('LOGGED_IN'),
      playability: pr.playabilityStatus?.status ?? null,
      reason: pr.playabilityStatus?.reason ?? null,
      sabr: !!sd.serverAbrStreamingUrl,
      formats: (sd.adaptiveFormats ?? []).map((f) => ({
        itag: f.itag, mimeType: f.mimeType, height: f.height ?? null, bitrate: f.bitrate ?? null,
        contentLength: f.contentLength ? Number(f.contentLength) : null, has: has(f),
      })),
    };
  }

  const STRATEGIES = { S1 };

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.source !== 'sieve-spike-cmd') return;
    for (const [strategy, run] of Object.entries(STRATEGIES)) {
      try { post({ result: await run() }); }
      catch (err) { post({ result: { strategy, videoId: videoIdNow(), error: String(err?.message ?? err) } }); }
    }
    post({ done: e.data.id });
  });
})();
