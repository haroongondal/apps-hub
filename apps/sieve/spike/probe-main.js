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

  const classify = (pr) => {
    const sd = pr.streamingData ?? {};
    return {
      playability: pr.playabilityStatus?.status ?? null,
      reason: pr.playabilityStatus?.reason ?? null,
      sabr: !!sd.serverAbrStreamingUrl,
      formats: (sd.adaptiveFormats ?? []).map(fmt),
      muxed: (sd.formats ?? []).map(fmt),
    };
  };

  // Raw URLs and ciphers for S3, stored under streams:<strategy>, which "Save results" and the summaries never read.
  const streams = (strategy, videoId, playerJsUrl, pr) => {
    const raw = (muxed) => (f) => ({ itag: f.itag, mimeType: f.mimeType, height: f.height ?? null, muxed, url: f.url, signatureCipher: f.signatureCipher });
    const sd = pr.streamingData ?? {};
    const formats = [...(sd.formats ?? []).map(raw(true)), ...(sd.adaptiveFormats ?? []).map(raw(false))].filter((f) => f.url || f.signatureCipher);
    post({ streams: { strategy, videoId, playerJsUrl, formats } });
  };

  async function S1() {
    const pr = await playerResponse();
    post({ fixture: scrub(Object.fromEntries(FIXTURE_KEYS.filter((k) => k in pr).map((k) => [k, pr[k]]))) });
    streams('S1', pr.videoDetails.videoId, window.ytcfg?.get('PLAYER_JS_URL') ?? null, pr);
    return { videoId: pr.videoDetails.videoId, strategy: 'S1', ...classify(pr) };
  }

  // S2: the same /player call the page makes, but as other Innertube clients.
  // Source: yt-dlp 12ac9aca79671420724227aca37bc888c604a6f8, yt_dlp/extractor/youtube/_base.py (2026-10-21). These are the
  // INNERTUBE_CLIENTS with no GVS_PO_TOKEN_POLICY that requires a PO token for HTTPS or DASH streams. The keys are
  // yt-dlp's names (three share clientName TVHTML5); `n` is INNERTUBE_CONTEXT_CLIENT_NAME. Update from the file, not memory.
  const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)';
  const CLIENTS = {
    web_embedded: { n: 56, thirdParty: { embedUrl: 'https://www.reddit.com/' }, client: { clientName: 'WEB_EMBEDDED_PLAYER', clientVersion: '2.20260708.00.00', userAgent: SAFARI_UA } },
    visionos: {
      n: 101,
      client: {
        clientName: 'VISIONOS', clientVersion: '1.02', deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', osName: 'visionOS', osVersion: '26.5.23O471',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      },
    },
    tv: {
      n: 7,
      client: {
        clientName: 'TVHTML5', clientVersion: '7.20260707.07.00',
        userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)',
      },
    },
    tv_downgraded: { n: 7, client: { clientName: 'TVHTML5', clientVersion: '5.20260707', userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version' } },
    tv_samsung: {
      n: 7,
      client: {
        clientName: 'TVHTML5', clientVersion: '5.20260707', deviceMake: 'Samsung', deviceModel: 'UKS9800', osName: 'Tizen', osVersion: '2.4.0',
        userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 2.4.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/2.4.0 TV Safari/538.1',
      },
    },
  };

  // signatureTimestamp: ytcfg first, else the number inside the player script (the browser caches the script, so no memo here).
  async function signatureTimestamp() {
    const playerJsUrl = window.ytcfg.get('PLAYER_JS_URL') ?? null;
    const fromCfg = Number(window.ytcfg.get('STS'));
    if (fromCfg) return { sts: fromCfg, stsSource: 'ytcfg', playerJsUrl };
    if (!playerJsUrl) return { sts: null, stsSource: null, playerJsUrl };
    try {
      const res = await fetch(playerJsUrl, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const sts = Number(/(?:signatureTimestamp|sts)\s*:\s*(\d{5})/.exec(await res.text())?.[1]) || null;
      return { sts, stsSource: sts ? 'player-js' : null, playerJsUrl };
    } catch (err) {
      return { sts: null, stsSource: null, stsError: `player script: ${err?.name === 'TimeoutError' ? 'timed out' : err?.message ?? err}`, playerJsUrl };
    }
  }

  async function S2(id) {
    const { n, client, thirdParty } = CLIENTS[id];
    const videoId = videoIdNow();
    const visitorData = window.ytcfg.get('VISITOR_DATA');
    const { sts, stsSource, stsError, playerJsUrl } = await signatureTimestamp();
    const res = await fetch('/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      signal: AbortSignal.timeout(20_000),
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': String(n),
        'X-YouTube-Client-Version': client.clientVersion,
        ...(visitorData && { 'X-Goog-Visitor-Id': visitorData }),
        'User-Agent': client.userAgent, // Chrome drops this (checked); the UA also goes in the body (context.client.userAgent)
      },
      body: JSON.stringify({
        context: { client: { ...client, hl: 'en', timeZone: 'UTC', utcOffsetMinutes: 0, visitorData }, ...(thirdParty && { thirdParty }) },
        videoId,
        playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS', ...(sts && { signatureTimestamp: sts }) } },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
    const pr = await res.json().catch(() => { throw new Error(`HTTP ${res.status} with a body that is not JSON`); });
    if (!pr.playabilityStatus) throw new Error(`HTTP ${res.status}: ${pr.error ? JSON.stringify(pr.error).slice(0, 200) : `no playabilityStatus; keys ${Object.keys(pr).join()}`}`);
    streams(`S2:${id}`, videoId, playerJsUrl, pr);
    return {
      videoId, strategy: `S2:${id}`, httpStatus: res.status,
      client: { id, clientName: client.clientName, clientVersion: client.clientVersion, nameNumber: n, userAgent: client.userAgent },
      sts, stsSource, ...(stsError && { stsError }), playerJsUrl, ...classify(pr),
    };
  }

  const STRATEGIES = { S1, ...Object.fromEntries(Object.keys(CLIENTS).map((id) => [`S2:${id}`, () => S2(id)])) };

  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.data?.source !== 'sieve-spike-cmd') return;
    let loggedIn = null; // a throwing ytcfg must not hang "Run all"; spike.js refuses to save without a boolean
    try { loggedIn = window.ytcfg ? !!window.ytcfg.get('LOGGED_IN') : null; } catch { /* leave null */ }
    for (const [strategy, run] of Object.entries(STRATEGIES)) {
      try { post({ result: { ...(await run()), loggedIn } }); }
      catch (err) { post({ result: { strategy, videoId: videoIdNow(), loggedIn, error: String(err?.message ?? err) } }); }
    }
    post({ done: e.data.id });
  });
})();
