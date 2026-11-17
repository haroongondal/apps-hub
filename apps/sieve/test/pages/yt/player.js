(() => {
  const IDS = ['sieveTest01', 'sieveTest02', 'sieveTest03', 'sieveTest04', 'sieveTest05'];
  // From the inspection recorded in src/yt/selectors.ts (NAV, PLAYER_API); test/yt/fixture.mjs fails if they drift.
  const EV = { start: 'yt-navigate-start', finish: 'yt-navigate-finish', data: 'yt-page-data-updated' };
  const LEVELS = ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny', 'auto'];
  const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const player = $('#movie_player');
  const video = player.querySelector('video');
  const flexy = $('ytd-watch-flexy');
  const unplayable = params.get('state') === 'unplayable';
  const autoplay = params.get('autoplay') !== '0';
  let videoId = params.get('v') ?? location.pathname.match(/^\/embed\/([^/?]+)/)?.[1] ?? IDS[0];
  let listId = params.get('list');
  // ?latelist=1: getVideoData() names the list only 2 s after each loadstart, as real YouTube does on a hard load (see quality-main.ts).
  // A window capture listener runs before Sieve's document one.
  let listAt = 0;
  if (params.has('latelist')) window.addEventListener('loadstart', () => { listAt = performance.now() + 2000; }, true);
  let quality = 'hd720';
  let playerState = -1;
  let stopped = false;
  let blobUrl = null;
  let tone = null;
  const listeners = {};

  // The settings may reach the page before this script does, so it asks for them again with a hello, as Sieve's main world does.
  window.__sieveDo = [];
  document.addEventListener('sieve-yt-settings', (e) => { window.__lastSieveSettings = e.detail; });
  document.addEventListener('sieve-yt-do', (e) => window.__sieveDo.push(e.detail));
  document.dispatchEvent(new CustomEvent('sieve-yt-hello'));

  window.__ytCalls = [];
  window.__keys = [];
  window.__ctx = [];
  document.addEventListener('keydown', (e) => window.__keys.push({ key: e.key, code: e.code, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, target: e.target.localName }));
  document.addEventListener('contextmenu', (e) => window.__ctx.push({ x: e.clientX, y: e.clientY, prevented: e.defaultPrevented }));

  const emit = (name, arg) => (listeners[name] ?? []).forEach((fn) => fn(arg));
  const setState = (s) => {
    if (s === playerState) return;
    playerState = s;
    emit('onStateChange', s);
  };
  video.addEventListener('playing', () => { stopped = false; setState(1); });
  video.addEventListener('pause', () => { if (!video.ended) setState(stopped ? 5 : 2); });
  video.addEventListener('waiting', () => setState(3));
  video.addEventListener('ended', () => setState(0));
  video.addEventListener('ratechange', () => emit('onPlaybackRateChange', video.playbackRate));
  video.addEventListener('volumechange', () => emit('onVolumeChange', { muted: video.muted, volume: Math.round(video.volume * 100), unstorable: false }));

  const setSource = async () => {
    if (unplayable) return;
    if (params.get('canvas')) {
      if (video.srcObject) return;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const g = canvas.getContext('2d');
      let flip = false;
      setInterval(() => {
        g.fillStyle = '#3366cc';
        g.fillRect(0, 0, 320, 180);
        g.fillStyle = (flip = !flip) ? '#3366cb' : '#3366cc';
        g.fillRect(0, 0, 2, 2);
      }, 100);
      video.srcObject = canvas.captureStream(10);
    } else if (params.get('src') === 'direct') {
      video.src = '/media/tone.wav';
    } else {
      tone ??= fetch('/media/tone.wav').then((r) => r.blob());
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = URL.createObjectURL(await tone);
      video.src = blobUrl;
    }
    if (autoplay) video.play().catch(() => {});
  };

  // keep: a navigation that leaves the playing video on its source, as a `&t=` link to it might (the review's case, not inspected live).
  const go = async (id, { list = null, index = null, keep = false } = {}) => {
    const app = $('ytd-app') ?? document.documentElement;
    const manager = $('ytd-page-manager') ?? app;
    const fire = (el, type) => el.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail: { pageType: id === 'home' ? 'browse' : 'watch', fromHistory: false } }));
    fire(app, EV.start);
    const next = new URLSearchParams(location.search);
    if (id === 'home') {
      // YouTube stops the video on home (inspected 2026-11-17: see the NAV.start listener in src/yt/bridge-main.ts).
      stopped = true;
      video.pause();
      setState(5);
      history.pushState(null, '', `/?fixture=${next.get('fixture') ?? 'watch'}`);
      document.title = 'YouTube';
      flexy?.setAttribute('hidden', '');
      $('ytd-browse')?.removeAttribute('hidden');
    } else {
      next.set('v', id);
      for (const k of ['list', 'index']) next.delete(k);
      if (list) {
        next.set('list', list);
        next.set('index', String(index ?? IDS.indexOf(id) + 1));
      }
      history.pushState(null, '', `/watch?${next}`);
      videoId = id;
      listId = list;
      document.title = `${id} - YouTube`;
      flexy?.setAttribute('video-id', id);
      flexy?.removeAttribute('hidden');
      $('ytd-browse')?.setAttribute('hidden', '');
      const h1 = $('ytd-watch-metadata h1');
      if (h1) h1.textContent = id;
      if (!keep) {
        setState(-1);
        await setSource();
      }
    }
    fire(app, EV.finish);
    fire(manager, EV.data);
  };

  // ?lag=ms delays a move, so the old video can end first; ?autonav=1 makes the fixture advance after `ended`, as YouTube does.
  const lag = Number(params.get('lag')) || 0;
  const playVideoAt = (i) => {
    if (!listId || !IDS[i]) return;
    if (lag) setTimeout(() => go(IDS[i], { list: listId, index: i + 1 }), lag);
    else go(IDS[i], { list: listId, index: i + 1 });
  };
  if (params.has('autonav')) video.addEventListener('ended', () => { if (listId) setTimeout(() => player.nextVideo(), 400); });
  const api = {
    getPlayerState: () => playerState,
    // Not from YouTube: state -1 and errorCode 'fixture.unplayable' for state=unplayable are this fixture's own choice (no real unplayable page was inspected).
    getVideoData: () => ({ video_id: videoId, author: 'Sieve fixture', title: videoId, isPlayable: !unplayable, errorCode: unplayable ? 'fixture.unplayable' : null, video_quality: quality, isLive: false, ...(listId && performance.now() >= listAt ? { list: listId } : {}) }),
    getPlaybackRate: () => video.playbackRate,
    setPlaybackRate: (r) => { video.playbackRate = r; },
    getAvailablePlaybackRates: () => [...RATES],
    getAvailableQualityLevels: () => [...LEVELS],
    getPlaybackQuality: () => quality,
    setPlaybackQuality: () => {},
    setPlaybackQualityRange: (min, max) => {
      const q = max ?? min;
      if (q === 'auto' || !LEVELS.includes(q) || q === quality) return;
      quality = q;
      emit('onPlaybackQualityChange', q);
    },
    getVolume: () => Math.round(video.volume * 100),
    setVolume: (v) => { video.volume = Math.min(1, Math.max(0, v / 100)); },
    isMuted: () => video.muted,
    mute: () => { video.muted = true; },
    unMute: () => { video.muted = false; },
    getPlaylist: () => (listId ? [...IDS] : null),
    getPlaylistIndex: () => (listId ? IDS.indexOf(videoId) : -1),
    playVideoAt,
    nextVideo: () => playVideoAt(IDS.indexOf(videoId) + 1),
    stopVideo: () => { stopped = true; video.pause(); setState(5); },
    pauseVideo: () => video.pause(),
    playVideo: () => { video.play().catch(() => {}); },
    seekTo: (s) => { video.currentTime = s; },
    addEventListener: (name, fn) => { if (typeof fn === 'function') (listeners[name] ??= []).push(fn); },
  };
  for (const [name, fn] of Object.entries(api)) {
    player[name] = (...args) => {
      window.__ytCalls.push({ name, args: args.map((a) => (typeof a === 'function' ? '[function]' : a)) });
      return fn(...args);
    };
  }

  const template = $('#metadata-template');
  const mountMetadata = () => template && $('#limited-state')?.after(template.content.cloneNode(true));
  if (!params.has('noanchor')) mountMetadata();
  window.__navigate = go;
  // A new source for the same video, as YouTube's ad/content swap and its mid-video re-source do; resolves after its loadstart.
  window.__swap = () => new Promise((resolve) => {
    video.addEventListener('loadstart', () => setTimeout(resolve, 100), { once: true });
    setSource();
  });
  // __rerenderBelow('parent') replaces the anchor's parent itself (a fresh copy, without Sieve's row); with no argument, each of its children.
  window.__rerenderBelow = (what) => {
    const parent = $('ytd-watch-metadata')?.parentElement;
    if (!parent) return;
    if (what === 'parent') {
      const copy = parent.cloneNode(true);
      copy.querySelector('sieve-yt-row')?.remove();
      parent.replaceWith(copy);
      return;
    }
    for (const child of [...parent.children]) {
      if (child.localName === 'template') continue;
      if (child.localName === 'sieve-yt-row') child.remove();
      else child.replaceWith(child.cloneNode(true));
    }
  };

  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || e.defaultPrevented) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === '/watch') {
      e.preventDefault();
      go(url.searchParams.get('v'), { list: url.searchParams.get('list'), index: Number(url.searchParams.get('index')) || null });
    } else if (url.pathname === '/') {
      e.preventDefault();
      go('home');
    }
  });
  $('.ytp-size-button')?.addEventListener('click', () => {
    const on = !flexy.hasAttribute('theater');
    flexy.toggleAttribute('theater', on);
    flexy.toggleAttribute('default-layout', !on);
    (on ? $('#player-full-bleed-container') : $('#player-container-inner')).append($('#player-container'));
    $('.ytp-size-button').setAttribute('data-title-no-tooltip', on ? 'Default view' : 'Cinema mode');
  });

  if (!unplayable) setSource();
  // The real hard-load yt-navigate-finish comes about 3 s in; the fixture fires it at once.
  setTimeout(() => {
    const app = $('ytd-app') ?? document.documentElement;
    app.dispatchEvent(new CustomEvent(EV.finish, { bubbles: true, composed: true, detail: { pageType: 'watch', fromHistory: false } }));
    ($('ytd-page-manager') ?? app).dispatchEvent(new CustomEvent(EV.data, { bubbles: true, composed: true, detail: { pageType: 'watch' } }));
  }, 0);
})();
