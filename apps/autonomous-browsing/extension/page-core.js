(() => {
  if (window.__oaCore) return;

  const WALL = [
    ['iframe[src*="captcha-delivery.com"]', 'DataDome bot check'],
    ['#px-captcha', 'PerimeterX bot check'],
    ['[id^="sec-cpt"]', 'Akamai bot check'],
    ['iframe[src*="_Incapsula_Resource"]', 'Imperva bot check'],
    ['iframe[src*="captcha.awswaf.com"]', 'AWS WAF CAPTCHA'],
    ['#challenge-running', 'Cloudflare check'],
    ['iframe[title*="captcha" i]', 'CAPTCHA'],
    ['#cf-error-details:has-text("you have been blocked")', 'Cloudflare block'],
    ['h2:has-text("Error 403 - Forbidden")', 'firewall block']
  ];

  const SENSITIVE = [
    ['input[type="password"]', 'password field'],
    ['input[autocomplete^="cc-"]', 'payment field'],
    ['input[autocomplete="one-time-code"]', 'one-time code'],
    ['iframe[src*="recaptcha"]', 'CAPTCHA'],
    ['iframe[src*="hcaptcha"]', 'CAPTCHA'],
    ['iframe[src*="challenges.cloudflare.com"]', 'CAPTCHA'],
    ['.g-recaptcha', 'CAPTCHA'],
    ['#cf-turnstile', 'CAPTCHA'],
    ...WALL
  ];

  const SENSITIVE_TARGET = [
    ['input[type="password"]', 'a password field'],
    ['input[autocomplete^="cc-"]', 'a payment field'],
    ['input[autocomplete="one-time-code"]', 'a one-time-code field']
  ];

  const COMMIT_WORDS =
    /\b(submit|order|pay|paying|buy|purchase|checkout|confirm|delete|remove|send|book|place|transfer|withdraw|publish)\b/;

  const DEFAULT_TIMEOUT = 10000;
  const POLL_MS = 100;
  const SETTLE_MS = 750;
  const ABSENCE_GRACE_MS = 1000;

  const LOCK_EVENTS = [
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'auxclick',
    'contextmenu',
    'pointerdown',
    'pointerup',
    'wheel',
    'touchstart',
    'touchmove',
    'touchend',
    'keydown',
    'keypress',
    'keyup',
    'dragstart',
    'selectstart'
  ];
  const AGENT_INPUT_GRACE_MS = 200;
  const NUDGE_MS = 900;

  let agentInputDepth = 0;
  let agentInputUntil = 0;

  function agentIsDriving() {
    return agentInputDepth > 0 || Date.now() < agentInputUntil;
  }

  const HUD_CSS = `
    .hud{--edge:#ff4438;--ink:#0b0b0f;--paper:#ededf2;--mute:#9a9aa6;--faint:#6f6f7b;
      position:absolute;inset:0;pointer-events:none}
    .hud.paused{--edge:#ffb020}

    .frame{position:absolute;inset:0;opacity:0;transition:opacity .18s}
    .hud.locked .frame{opacity:1;box-shadow:inset 0 0 0 2px var(--edge),inset 0 0 44px -34px var(--edge)}
    .hud.paused .frame{opacity:1;box-shadow:inset 0 0 0 2px var(--edge)}
    .hud.nudge .frame{animation:flash .5s ease-out}

    .corner{position:absolute;width:34px;height:34px;border:5px solid var(--edge);opacity:0}
    .hud.locked .corner{opacity:1;animation:breathe 2.8s ease-in-out infinite}
    .tl{top:0;left:0;border-right:0;border-bottom:0}
    .tr{top:0;right:0;border-left:0;border-bottom:0}
    .bl{bottom:0;left:0;border-right:0;border-top:0}
    .br{bottom:0;right:0;border-left:0;border-top:0}

    .card{position:absolute;right:16px;bottom:16px;width:min(360px,calc(100vw - 32px));
      display:flex;flex-direction:column;gap:9px;padding:12px 14px;
      background:var(--ink);color:var(--paper);border:1px solid #26262e;border-radius:12px;
      box-shadow:0 10px 30px rgba(0,0,0,.45);text-align:left;
      font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
      opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;pointer-events:none}
    .hud.showing .card{opacity:1;transform:none;pointer-events:auto}

    .head{display:flex;align-items:center;gap:8px}
    .dot{width:7px;height:7px;border-radius:50%;background:var(--edge);flex:0 0 auto;
      animation:pulse 1.6s ease-in-out infinite}
    .hud.paused .dot{animation:none}
    .state{font:600 10.5px/1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
      letter-spacing:.14em;text-transform:uppercase}

    .reason{margin:0;color:var(--mute);max-height:7.5em;overflow-y:auto;overflow-wrap:anywhere}
    .reason:empty{display:none}

    .foot{display:flex;align-items:center;justify-content:flex-end;gap:12px}
    .hint{margin-right:auto;color:var(--faint);font-size:11.5px;line-height:1.3}
    .hint:empty{display:none}
    .hud.nudge .hint{color:var(--paper)}

    button{flex:0 0 auto;border:0;border-radius:7px;padding:6px 12px;cursor:pointer;
      font-family:inherit;font-size:12.5px;font-weight:600;
      background:transparent;color:var(--paper);box-shadow:inset 0 0 0 1px #3a3a45}
    button.go{background:#30d158;color:#04210c;box-shadow:none}
    button:focus-visible{outline:2px solid var(--paper);outline-offset:2px}

    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
    @keyframes breathe{0%,100%{opacity:1}50%{opacity:.45}}
    @keyframes flash{
      0%,100%{box-shadow:inset 0 0 0 2px var(--edge),inset 0 0 44px -34px var(--edge)}
      35%{box-shadow:inset 0 0 0 9px var(--edge),inset 0 0 80px -30px var(--edge)}
    }
    @media (prefers-reduced-motion:reduce){
      .dot,.hud.locked .corner,.hud.nudge .frame{animation:none}
      .frame,.card{transition:none}
    }
  `;

  function buildHud(onToggle) {
    for (const stale of document.querySelectorAll('[data-oa-hud]')) stale.remove();
    const host = document.createElement('div');
    host.setAttribute('data-oa-hud', '');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';

    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = HUD_CSS;

    const hud = document.createElement('div');
    hud.className = 'hud';

    const frame = document.createElement('div');
    frame.className = 'frame';
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      const mark = document.createElement('div');
      mark.className = `corner ${corner}`;
      frame.append(mark);
    }

    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');

    const head = document.createElement('div');
    head.className = 'head';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const stateLabel = document.createElement('span');
    stateLabel.className = 'state';
    head.append(dot, stateLabel);

    const reasonText = document.createElement('p');
    reasonText.className = 'reason';

    const foot = document.createElement('div');
    foot.className = 'foot';
    const hint = document.createElement('span');
    hint.className = 'hint';
    const btn = document.createElement('button');
    foot.append(hint, btn);

    card.append(head, reasonText, foot);
    hud.append(frame, card);
    shadow.append(style, hud);

    const mount = () => {
      if (!host.isConnected && document.documentElement) document.documentElement.append(host);
    };
    mount();
    document.addEventListener('DOMContentLoaded', mount, { once: true });

    let locked = false;
    let nudgeTimer = 0;

    const nudge = () => {
      hud.classList.add('nudge');
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(() => hud.classList.remove('nudge'), NUDGE_MS);
    };

    // CDP input is as trusted as a person's; the window agentIsDriving opens around
    // page-core's own dispatch is the only thing that tells them apart.
    const swallow = (event) => {
      if (!event.isTrusted || agentIsDriving() || event.target === host) return;
      if (event.type === 'keydown' && event.key === 'Escape') {
        setLocked(false);
        stateLabel.textContent = 'Pausing · you have control';
        hint.textContent = '';
        onToggle('pause');
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      nudge();
    };

    function setLocked(wanted) {
      if (wanted === locked) return;
      locked = wanted;
      for (const type of LOCK_EVENTS) {
        if (wanted) addEventListener(type, swallow, { capture: true, passive: false });
        else removeEventListener(type, swallow, { capture: true });
      }
      hud.classList.toggle('locked', wanted);
    }

    btn.addEventListener('click', () => {
      onToggle(hud.classList.contains('paused') ? 'resume' : 'pause');
    });

    return ({ state, reason }) => {
      mount();
      const showing = state === 'active' || state === 'paused';
      const paused = state === 'paused';
      setLocked(state === 'active');
      hud.classList.toggle('showing', showing);
      hud.classList.toggle('paused', paused);
      if (!showing) return;

      stateLabel.textContent = paused ? 'Paused · your turn' : 'Running · view locked';
      reasonText.textContent = paused ? (reason ?? '') : '';
      hint.textContent = paused ? '' : 'Press Esc to take control';
      btn.textContent = paused ? 'Resume' : 'Pause';
      btn.className = paused ? 'go' : '';
    };
  }

  function shadowRoots() {
    const found = [];
    const walk = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (!el.shadowRoot) continue;
        found.push(el.shadowRoot);
        walk(el.shadowRoot);
      }
    };
    walk(document);
    return found;
  }

  function labelledText(el) {
    const ids = el.getAttribute('aria-labelledby');
    if (!ids) return '';
    const root = el.getRootNode();
    return ids
      .split(/\s+/)
      .map((id) => root.getElementById?.(id)?.textContent ?? '')
      .join(' ');
  }

  function accessibleText(el) {
    const parts = [
      el.textContent,
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
      el.getAttribute('placeholder'),
      el.getAttribute('alt'),
      el.getAttribute('name'),
      labelledText(el)
    ];
    if (typeof el.value === 'string') parts.push(el.value);
    return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  const HAS_TEXT = /:has-text\((?:"([^"]*)"|'([^']*)')\)\s*$/;

  function queryAll(selector) {
    const textMatch = HAS_TEXT.exec(selector);
    const base = textMatch ? selector.slice(0, textMatch.index) || '*' : selector;
    const wanted = textMatch ? (textMatch[1] ?? textMatch[2]).trim().toLowerCase() : null;

    const matching = (root) => {
      let found;
      try {
        found = root.querySelectorAll(base);
      } catch {
        throw new Error(`"${selector}" is not a valid selector`);
      }
      return wanted === null ? [...found] : [...found].filter((el) => accessibleText(el).includes(wanted));
    };

    const inDocument = matching(document);
    if (inDocument.length > 0) return inDocument;
    return shadowRoots().flatMap(matching);
  }

  function isVisible(el) {
    if (el.getClientRects().length === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function isDisabled(el) {
    if (el.disabled === true) return true;
    return el.closest('[aria-disabled="true"], fieldset[disabled]') !== null;
  }

  function covering(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;

    const root = el.getRootNode();
    const top = (root.elementFromPoint ? root : document).elementFromPoint(x, y);
    if (!top || top === el || el.contains(top) || top.contains(el)) return null;
    return top;
  }

  function describe(el) {
    const id = el.id ? `#${el.id}` : '';
    const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    return `<${el.tagName.toLowerCase()}${id}${cls}>`;
  }

  function rank(el) {
    if (!isVisible(el)) return 1;
    if (isDisabled(el)) return 2;
    if (covering(el)) return 3;
    return 4;
  }

  function best(selector) {
    const candidates = queryAll(selector);
    let winner = null;
    let winningRank = 0;
    for (const el of candidates) {
      const score = rank(el);
      if (score <= winningRank) continue;
      winner = el;
      winningRank = score;
    }
    return { winner, winningRank, count: candidates.length };
  }

  function explain({ winner, winningRank, count }) {
    if (count === 0) return 'nothing on this page matches it';
    const subject = count === 1 ? describe(winner) : `the best of ${count} matches, ${describe(winner)},`;
    if (winningRank === 1) return `${subject} is not visible`;
    if (winningRank === 2) return `${subject} is disabled`;
    return `${subject} is covered by ${describe(covering(winner))}`;
  }

  function waitForActionable(selector, timeout) {
    const deadline = Date.now() + (timeout ?? DEFAULT_TIMEOUT);
    return new Promise((resolve, reject) => {
      let looks = 0;
      const attempt = () => {
        looks += 1;
        const found = best(selector);
        if (found.winningRank === 4) return resolve({ el: found.winner, recovered: looks > 1 });
        if (found.winningRank === 3) found.winner.scrollIntoView({ block: 'center' });
        if (Date.now() >= deadline) return reject(new Error(`timed out waiting for ${selector} — ${explain(found)}`));
        setTimeout(attempt, POLL_MS);
      };
      attempt();
    });
  }

  // Rank 2 and 3 still render, so the rank-4 gate would pass absence open.
  function rendered(selector) {
    return queryAll(selector).find((el) => rank(el) >= 2) ?? null;
  }

  function assertGone(selector) {
    const deadline = Date.now() + ABSENCE_GRACE_MS;
    return new Promise((resolve) => {
      const attempt = () => {
        const found = rendered(selector);
        if (found) return resolve(found);
        if (Date.now() >= deadline) return resolve(null);
        setTimeout(attempt, POLL_MS);
      };
      attempt();
    });
  }

  function fingerprint(el) {
    const parts = [location.href, String(scrollY)];
    if (!el.isConnected) return parts.concat('detached').join('|');
    return parts
      .concat([
        String(el.checked),
        String(el.value),
        String(el.className),
        String(el.disabled),
        el.getAttribute('aria-expanded') ?? '',
        el.getAttribute('aria-pressed') ?? '',
        el.getAttribute('aria-checked') ?? '',
        el.getAttribute('aria-selected') ?? ''
      ])
      .join('|');
  }

  // Biased toward "something happened": re-running a submit is worse than missing a dead click.
  async function observe(el, perform) {
    const before = fingerprint(el);
    let changed = false;
    let wake = () => {};

    let departed;
    const leaving = new Promise((resolve) => {
      departed = resolve;
    });
    const departing = () => {
      changed = true;
      departed();
    };
    const noticed = () => {
      changed = true;
      wake();
    };
    const observer = new MutationObserver(noticed);

    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    addEventListener('pagehide', departing, { once: true });
    addEventListener('beforeunload', departing, { once: true });

    try {
      await Promise.race([perform(), leaving]);
      if (!changed) {
        const settle = new Promise((resolve) => {
          wake = resolve;
          setTimeout(resolve, SETTLE_MS);
        });
        await Promise.race([settle, leaving]);
      }
      return changed || fingerprint(el) !== before;
    } finally {
      observer.disconnect();
      removeEventListener('pagehide', departing);
      removeEventListener('beforeunload', departing);
    }
  }

  function isCommitting(el, step) {
    if (step.kind === 'type' && step.submit) return true;
    if (el.form && el.tagName === 'INPUT') return el.type === 'submit' || el.type === 'image';
    if (el.form && el.tagName === 'BUTTON' && el.type === 'submit') return true;
    return COMMIT_WORDS.test(accessibleText(el));
  }

  function firstVisible(list) {
    for (const [selector, description] of list) {
      const found = queryAll(selector).find((el) => el.getClientRects().length > 0);
      if (found) return description;
    }
    return null;
  }

  function scanSensitive() {
    return firstVisible(SENSITIVE);
  }

  function scanWall() {
    return firstVisible(WALL);
  }

  function assertWritableTarget(el) {
    for (const [selector, description] of SENSITIVE_TARGET) {
      if (el.matches(selector)) {
        throw new Error(`refusing to write into ${description} — fill it in yourself, then run this again`);
      }
    }
  }

  function selectAll(el) {
    if (!el.isContentEditable) {
      el.select();
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function setValue(el, value) {
    if (el.isContentEditable) {
      selectAll(el);
      if (!document.execCommand('insertText', false, value)) throw new Error('could not type into this editor');
      return;
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function press(el) {
    const opts = { bubbles: true, cancelable: true, view: window, composed: true };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function submitFrom(el) {
    const key = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
    el.dispatchEvent(new KeyboardEvent('keydown', key));
    el.dispatchEvent(new KeyboardEvent('keyup', key));
    if (el.form) el.form.requestSubmit();
  }

  async function settle(step) {
    const found = await waitForActionable(step.selector, step.timeout);
    found.el.scrollIntoView({ block: 'center' });
    if (found.el.isConnected) return found;
    const again = await waitForActionable(step.selector, step.timeout);
    return { el: again.el, recovered: true };
  }

  function centre(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function isRendered(el) {
    if (el.tagName === 'OPTION' || el.tagName === 'OPTGROUP') return true;
    return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }

  function appendRendered(target, children) {
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE && !isRendered(child)) continue;
      target.append(cloneWithShadow(child));
    }
  }

  function isSensitiveField(el) {
    return SENSITIVE_TARGET.some(([selector]) => el.matches(selector));
  }

  function mirrorLiveState(node, copy) {
    if (node instanceof HTMLTextAreaElement) {
      copy.textContent = node.value;
      return;
    }
    if (node instanceof HTMLOptionElement) {
      copy.toggleAttribute('selected', node.selected);
      return;
    }
    if (!(node instanceof HTMLInputElement)) return;
    if (node.type === 'checkbox' || node.type === 'radio') {
      copy.toggleAttribute('checked', node.checked);
      return;
    }
    if (isSensitiveField(node)) {
      copy.removeAttribute('value');
      return;
    }
    copy.setAttribute('value', node.value);
  }

  function cloneWithShadow(node) {
    const copy = node.cloneNode(false);
    if (node.shadowRoot) {
      const holder = document.createElement('shadow-root');
      appendRendered(holder, node.shadowRoot.childNodes);
      copy.append(holder);
    }
    appendRendered(copy, node.childNodes);
    mirrorLiveState(node, copy);
    return copy;
  }

  function create({ requestInput, control }) {
    async function dispatch(request, synthetic) {
      agentInputDepth += 1;
      try {
        let verdict;
        try {
          verdict = await requestInput(request);
        } catch {
          verdict = 'unavailable';
        }
        if (verdict === 'ok') return 'cdp';
        if (verdict === 'failed') {
          throw new Error(
            'the browser accepted only part of this input — it was not retried, so check the page before running again'
          );
        }
        synthetic();
        return 'synthetic';
      } finally {
        agentInputDepth -= 1;
        agentInputUntil = Date.now() + AGENT_INPUT_GRACE_MS;
      }
    }

    const ACTIONS = {
      async click(step) {
        const { el, recovered } = await settle(step);
        const committing = isCommitting(el, step);
        let via = 'synthetic';
        const changed = await observe(el, async () => {
          via = await dispatch({ action: 'click', ...centre(el) }, () => press(el));
        });
        return { changed, committing, via, recovered };
      },

      async type(step) {
        const { el, recovered } = await settle(step);
        assertWritableTarget(el);
        const committing = isCommitting(el, step);
        let via = 'synthetic';
        const changed = await observe(el, async () => {
          el.focus({ preventScroll: true });
          selectAll(el);
          via = await dispatch({ action: 'type', text: step.text, submit: Boolean(step.submit) }, () => {
            setValue(el, step.text);
            if (step.submit) submitFrom(el);
          });
        });
        return { changed, committing, via, recovered };
      },

      async select(step) {
        const { el, recovered } = await settle(step);
        assertWritableTarget(el);
        const changed = await observe(el, () => {
          el.value = step.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        return { changed, committing: false, recovered };
      },

      async wait(step) {
        if (step.forSelector) {
          await waitForActionable(step.forSelector, 15000);
          return {};
        }
        await new Promise((resolve) => setTimeout(resolve, step.ms ?? 1000));
        return {};
      },

      async scroll(step) {
        if (step.selector) {
          const { el } = await waitForActionable(step.selector, step.timeout);
          el.scrollIntoView({ block: 'center' });
          return {};
        }
        scrollTo(0, step.to === 'top' ? 0 : document.body.scrollHeight);
        return {};
      },

      async extract(step) {
        const { el, recovered } = await waitForActionable(step.selector, step.timeout);
        return { value: el.innerText, recovered };
      },

      async assert(step) {
        const failed = (detail) => {
          throw new Error(step.message ? `${step.message} — ${detail}` : detail);
        };

        if (step.expect === 'absent') {
          const found = await assertGone(step.selector);
          if (found) failed(`expected ${step.selector} to be gone, but ${describe(found)} is on the page`);
          return {};
        }

        const found = await waitForActionable(step.selector, step.timeout).catch(() => null);
        const el = found?.el ?? null;
        if (!el) failed(`expected ${step.selector} to be on the page, but ${explain(best(step.selector))}`);
        if (step.containsText !== undefined && !el.innerText.includes(step.containsText)) {
          failed(`expected ${step.selector} to contain "${step.containsText}", but it reads "${el.innerText.trim()}"`);
        }
        return {};
      }
    };

    async function exec(step) {
      const run = ACTIONS[step.kind];
      if (!run) return { ok: false, error: `unsupported step kind "${step.kind}"` };
      try {
        return { ok: true, ...(await run(step)) };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    }

    function dom() {
      return {
        dom: cloneWithShadow(document.documentElement).outerHTML,
        title: document.title,
        blockedBy: scanWall()
      };
    }

    function find(selector) {
      try {
        const { winningRank, count } = best(selector);
        return { count, winningRank };
      } catch {
        return { count: 0, winningRank: 0 };
      }
    }

    const render = window === window.top ? buildHud(control) : () => {};

    return { exec, dom, find, scanSensitive, scanWall, render };
  }

  window.__oaCore = { create };
})();
