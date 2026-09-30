// ==UserScript==
// @name         Capture API Responses (Claude Org Settings)
// @namespace    local
// @version      1.7
// @description  Files is the default/initial tab and the one Gather switches to; Discover switches to Pages. Gather also directly fetches the Organization-overview page's own data and Claude Code's Agents sub-tab data (bypassing app-level caching that blocks Discover's in-app revisit trick). Files/Pages tab order swapped (Files first). Toolbar buttons stay a fixed size — progress shows on a shared status line instead. Nav-tracking installed unconditionally at load for accurate auto/interaction tagging. Persistent panel, auto-zip on Discover completion, page-text-to-API matching, dedup + noise filtering — all defensively wrapped so it can never break the page.
// @match        https://claude.ai/admin-settings/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // SAFETY NET — see prior version's notes; unchanged philosophy. Every
  // DOM/patch operation is wrapped so a bug here degrades to "a console
  // warning, feature stops," never a thrown error hitting the site's code.
  // -----------------------------------------------------------------------
  if (window.__captureScriptInstalled) {
    console.warn('[capture] already installed in this page — skipping re-init. Reload the page to fully reset.');
    return;
  }
  window.__captureScriptInstalled = true;

  function safe(fn, label) {
    try {
      return fn();
    } catch (e) {
      console.error(`[capture] error in ${label || 'unnamed block'} (suppressed, page not affected):`, e);
      return undefined;
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  window.__capturedApiCalls = window.__capturedApiCalls || [];
  const MAX_BODY_LOG_LENGTH = 20000;

  // -----------------------------------------------------------------------
  // NOISE FILTER (deny-list, so new endpoints are kept by default)
  // -----------------------------------------------------------------------
  const NOISE_PATTERNS = [
    /\/api\/v2\/rum(\?|$)/i,
    /\/event_logging\/v2\/batch/i,
    /\/edge-api\/client-health\/check/i,
    /assets-proxy\.anthropic\.com/i,
    /\.(js|css|map)(\?|$)/i,
    /ConsoleService\/(GetAgenticPromoSummary|ListAgenticPromoMembers)/i,
    /OrgSurveyService\/GetPendingSurvey/i,
    /\/api\/directory\/servers/i,
    /\/v1\/code\/agent-proxy\/presets/i,
    // Main-app data feeds that leak in from a shared app shell, not actual
    // org-settings state:
    /\/chat_conversations_v2/i,
    /\/projects_v2/i,
    /\/organizations\/[0-9a-f-]{36}\/projects(\?|$)/i,
    /\/code_artifacts(\?|$)/i,
  ];

  function isNoise(url) {
    return NOISE_PATTERNS.some((re) => re.test(url));
  }

  function safeTruncate(str) {
    if (typeof str !== 'string') return str;
    return str.length > MAX_BODY_LOG_LENGTH
      ? str.slice(0, MAX_BODY_LOG_LENGTH) + `... [truncated, ${str.length} chars total]`
      : str;
  }

  // -----------------------------------------------------------------------
  // TRIGGER TRACKING: 'auto' (fired on page mount), 'interaction' (fired
  // well after the page settled), or 'gather' (fired by the Gather button).
  //
  // The nav-timestamp hook (pushState/replaceState/popstate) is installed
  // UNCONDITIONALLY, immediately, regardless of the auditing toggle — not
  // gated behind it like fetch/XHR recording is. Reasoning: if we only
  // patch history.pushState once auditing is later switched on (e.g. via
  // clicking Discover), the site's own router may have already grabbed a
  // reference to the *original* pushState before we ever got to it, and
  // our replacement on the `history` object then never actually gets
  // called for real navigations — lastNavAt never updates, and every
  // capture from then on gets mis-tagged 'interaction' even when it was
  // clearly page-load data. Patching this at the very start avoids that
  // race. It's a pure timestamp bookkeeping hook — it doesn't record or
  // reveal any request data by itself, so it's safe to run unconditionally.
  // -----------------------------------------------------------------------
  const AUTO_WINDOW_MS = 2000;
  let lastNavAt = Date.now();

  function markNav(label) {
    lastNavAt = Date.now();
    console.log(`%c[capture] nav detected: ${label}`, 'color:#8a5cf6;');
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  safe(() => {
    history.pushState = function (...args) {
      const ret = originalPushState.apply(this, args);
      safe(() => markNav('pushState ' + location.pathname), 'markNav/pushState');
      return ret;
    };
    history.replaceState = function (...args) {
      const ret = originalReplaceState.apply(this, args);
      safe(() => markNav('replaceState ' + location.pathname), 'markNav/replaceState');
      return ret;
    };
    window.addEventListener('popstate', () => safe(() => markNav('popstate ' + location.pathname), 'markNav/popstate'));
  }, 'unconditional history patch (nav tracking)');

  function currentTrigger() {
    return (Date.now() - lastNavAt) <= AUTO_WINDOW_MS ? 'auto' : 'interaction';
  }

  let auditingEnabled = false; // OFF by default — see installPatches/uninstallPatches

  function record(entry) {
    safe(() => {
      entry.noise = isNoise(entry.url);
      if (!entry.trigger) entry.trigger = currentTrigger();
      window.__capturedApiCalls.push(entry);
      const tag = entry.noise ? 'noise' : entry.trigger;
      const color = entry.noise ? '#999' : entry.trigger === 'gather' ? '#0f766e' : entry.trigger === 'auto' ? '#8a5cf6' : '#c2410c';
      console.groupCollapsed(`%c[capture] [${tag}] ${entry.method} ${entry.status ?? ''} ${entry.url}`, `color:${color};font-weight:bold;`);
      console.log('request:', entry.requestBody);
      console.log('response:', entry.responseBody);
      console.log('full entry:', entry);
      console.groupEnd();
      updateButtonLabel();
    }, 'record');
  }

  // -----------------------------------------------------------------------
  // FETCH / XHR / HISTORY PATCHING — toggleable, restores real originals
  // when off. OFF is the default state now: nothing is patched until the
  // Auditing button is clicked.
  // -----------------------------------------------------------------------
  const originalFetch = window.fetch.bind(window);
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;
  let patchedFetch = null;

  function buildPatchedFetch() {
    return async function (...args) {
      const [resource, config] = args;
      const url = typeof resource === 'string' ? resource : resource?.url;
      const method = (config?.method || 'GET').toUpperCase();
      const startedAt = new Date().toISOString();

      let requestBody = config?.body;
      if (requestBody && typeof requestBody !== 'string') {
        try { requestBody = JSON.stringify(requestBody); } catch (e) {}
      }

      const response = await originalFetch.apply(this, args);

      safe(() => {
        if (isNoise(url)) {
          record({ type: 'fetch', url, method, status: response.status, startedAt });
          return;
        }
        response.clone().text().then((text) => {
          let parsed = text;
          try { parsed = JSON.parse(text); } catch (e) {}
          record({
            type: 'fetch', url, method, status: response.status, startedAt,
            requestBody: safeTruncate(requestBody),
            responseBody: typeof parsed === 'string' ? safeTruncate(parsed) : parsed,
          });
        }).catch((e) => {
          record({ type: 'fetch', url, method, status: response.status, startedAt, error: 'body read failed: ' + String(e) });
        });
      }, 'fetch capture (post-response)');

      return response;
    };
  }

  function installPatches() {
    safe(() => {
      if (!patchedFetch) patchedFetch = buildPatchedFetch();
      window.fetch = patchedFetch;
    }, 'installPatches/fetch');

    safe(() => {
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__capture = { method: (method || 'GET').toUpperCase(), url };
        return originalXhrOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function (body) {
        if (this.__capture) {
          this.__capture.requestBody = body;
          this.__capture.startedAt = new Date().toISOString();
          const noise = isNoise(this.__capture.url);
          this.addEventListener('loadend', () => safe(() => {
            if (noise) {
              record({ type: 'xhr', url: this.__capture.url, method: this.__capture.method, status: this.status, startedAt: this.__capture.startedAt });
              return;
            }
            let responseBody = this.responseText;
            try { responseBody = JSON.parse(this.responseText); } catch (e) {}
            record({
              type: 'xhr', url: this.__capture.url, method: this.__capture.method, status: this.status, startedAt: this.__capture.startedAt,
              requestBody: safeTruncate(this.__capture.requestBody),
              responseBody: typeof responseBody === 'string' ? safeTruncate(responseBody) : responseBody,
            });
          }, 'xhr capture (loadend)'));
        }
        return originalXhrSend.call(this, body);
      };
    }, 'installPatches/xhr');

    auditingEnabled = true;
  }

  function uninstallPatches() {
    safe(() => { window.fetch = originalFetch; }, 'uninstallPatches/fetch');
    safe(() => {
      XMLHttpRequest.prototype.open = originalXhrOpen;
      XMLHttpRequest.prototype.send = originalXhrSend;
    }, 'uninstallPatches/xhr');
    // Note: the history.pushState/replaceState nav-tracking hook is NOT
    // touched here — it's installed once, unconditionally, at script load
    // (see TRIGGER TRACKING above) and stays on regardless of this toggle.
    auditingEnabled = false;
  }

  // NOTE: auditing starts OFF for fetch/XHR recording — installPatches()
  // is intentionally not called here. The page's own fetch/XHR stay 100%
  // untouched until the person clicks "Auditing: OFF" to turn it on. The
  // history nav-tracking hook above is the one exception, always active.

  // ---- Console helpers ----
  window.__dumpCapturedApiCalls = function (includeNoise = false) {
    const out = includeNoise ? window.__capturedApiCalls : window.__capturedApiCalls.filter((c) => !c.noise);
    console.log(out);
    return out;
  };
  window.__clearCapturedApiCalls = function () {
    window.__capturedApiCalls.length = 0;
    safe(updateButtonLabel, 'updateButtonLabel/clear');
  };

  // -----------------------------------------------------------------------
  // JSZip loader (lazy) + download, with de-duplication
  // -----------------------------------------------------------------------
  let jszipLoadPromise = null;
  function loadJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    if (jszipLoadPromise) return jszipLoadPromise;
    jszipLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      script.onload = () => resolve(window.JSZip);
      script.onerror = (e) => reject(e);
      document.head.appendChild(script);
    });
    return jszipLoadPromise;
  }

  function slugify(url, index) {
    try {
      const u = new URL(url, location.origin);
      const base = u.pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      return `${String(index).padStart(3, '0')}_${base || 'call'}`;
    } catch (e) {
      return `${String(index).padStart(3, '0')}_call`;
    }
  }

  // Two calls are "the same" for dedup purposes if method + URL + request
  // body all match. Query-string differences (pagination, filters) make
  // them different calls on purpose. Only exact repeats collapse.
  function dedupKey(entry) {
    return `${entry.method} ${entry.url} ${entry.requestBody || ''}`;
  }

  function dedupe(entries) {
    const seen = new Map(); // key -> first entry
    const duplicateCounts = new Map(); // key -> count of extra repeats
    const kept = [];
    entries.forEach((entry) => {
      const key = dedupKey(entry);
      if (seen.has(key)) {
        duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
      } else {
        seen.set(key, entry);
        kept.push(entry);
      }
    });
    const duplicatesRemoved = Array.from(duplicateCounts.entries()).map(([key, count]) => {
      const example = seen.get(key);
      return { method: example.method, url: example.url, repeatedTimes: count };
    });
    return { kept, duplicatesRemoved };
  }

  async function downloadZip() {
    const all = window.__capturedApiCalls;
    const nonNoise = all.filter((c) => !c.noise);
    if (!nonNoise.length) {
      alert('No captured (non-noise) API calls yet.');
      return;
    }
    const { kept, duplicatesRemoved } = dedupe(nonNoise);

    const btn = document.getElementById('__panelFooterBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Zipping…'; }

    try {
      const JSZip = await loadJSZip();
      const zip = new JSZip();

      kept.forEach((entry, i) => {
        const name = slugify(entry.url, i) + '.json';
        zip.file(name, JSON.stringify(entry, null, 2));
      });

      zip.file('_manifest.json', JSON.stringify(
        kept.map((c, i) => ({ index: i, method: c.method, status: c.status, url: c.url, trigger: c.trigger, startedAt: c.startedAt })),
        null, 2
      ));

      ['auto', 'interaction', 'gather'].forEach((trig) => {
        zip.file(`_${trig}.json`, JSON.stringify(
          kept.filter((c) => c.trigger === trig).map((c) => ({ method: c.method, url: c.url, status: c.status })),
          null, 2
        ));
      });

      zip.file('_excluded_as_noise.json', JSON.stringify(
        all.filter((c) => c.noise).map((c) => ({ method: c.method, url: c.url })),
        null, 2
      ));

      zip.file('_duplicates_removed.json', JSON.stringify(duplicatesRemoved, null, 2));

      // ---- Page text snapshots + best-effort matching to API calls ----
      safe(() => {
        const searchableCalls = kept.map((c) => ({
          method: c.method,
          url: c.url,
          haystack: `${c.url} ${typeof c.responseBody === 'string' ? c.responseBody : JSON.stringify(c.responseBody || '')}`.toLowerCase(),
        }));

        const pageMatches = {};
        window.__navLinkRegistry.forEach((link, href) => {
          if (!link.pageText) return;
          pageMatches[href] = {
            label: link.label,
            section: link.section,
            pageTextCapturedAt: link.pageTextCapturedAt,
            matches: matchPageToCalls(link.pageText, searchableCalls),
          };
          const slug = href.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
          zip.file(`_page_text/${slug}.txt`, link.pageText);
        });

        zip.file('_page_matches.json', JSON.stringify(pageMatches, null, 2));
      }, 'downloadZip/pageMatches');

      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `org-settings-api-captures-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error('[capture] zip failed:', e);
      alert('Zip failed, check console.');
    } finally {
      if (btn) { btn.disabled = false; safe(updateButtonLabel, 'updateButtonLabel/zip'); }
    }
  }

  // -----------------------------------------------------------------------
  // DISCOVER — live registry of every /admin-settings/* left-nav link.
  // (Unchanged from the previous version.)
  // -----------------------------------------------------------------------
  const DISCOVER_POLL_MS = 2500;
  const VISIT_WAIT_MS = 1500;
  window.__navLinkRegistry = window.__navLinkRegistry || new Map();
  window.__discoverVisiting = window.__discoverVisiting || false; // reentrancy guard — see visitChecked
  window.__discoverCurrentHref = window.__discoverCurrentHref || null; // href actively being visited, if any
  window.__discoverPageErrorDetected = null; // set by the global error/rejection listeners below
  window.__hardNavHrefs = window.__hardNavHrefs || new Set(); // hrefs known to cause a full page reload

  // -----------------------------------------------------------------------
  // CRASH / HARD-NAVIGATION DETECTION
  //
  // Some nav items don't behave like the rest: clicking them can throw
  // inside the site's own async code well after our click() call returns
  // (so our try/catch around the click itself never sees it — the crash
  // happens on a later tick), or they can trigger an honest-to-god full
  // page navigation/reload instead of an in-app route change, which
  // destroys this script's entire JS context outright (nothing catches
  // that from inside the context being destroyed).
  //
  // Two lightweight, always-on, read-only listeners cover both cases:
  //  - window 'error'/'unhandledrejection': catches the site's own async
  //    crash and lets visitChecked notice it and back off.
  //  - 'beforeunload': only fires for a real navigation/reload. If it
  //    fires while we're mid-visit, we stash which href we were visiting
  //    into localStorage (survives the reload) so a future run of this
  //    script — even freshly re-pasted — knows to leave that href alone.
  // -----------------------------------------------------------------------
  const HARD_NAV_STORAGE_KEY = '__captureDiscoverHardNavHref';

  safe(() => {
    const raw = localStorage.getItem(HARD_NAV_STORAGE_KEY);
    if (raw) {
      const info = JSON.parse(raw);
      console.warn(
        `%c[discover] Last run, visiting ${info.href} caused a full page reload (not a normal in-app navigation) — it'll show up unchecked and flagged. Recheck it manually only if you want to retry.`,
        'color:#c2410c;font-weight:bold;'
      );
      window.__hardNavHrefs.add(info.href);
      localStorage.removeItem(HARD_NAV_STORAGE_KEY);
    }
  }, 'check for prior hard-nav');

  window.addEventListener('beforeunload', () => {
    try {
      if (window.__discoverVisiting && window.__discoverCurrentHref) {
        localStorage.setItem(HARD_NAV_STORAGE_KEY, JSON.stringify({ href: window.__discoverCurrentHref, at: Date.now() }));
      }
    } catch (e) { /* best-effort only */ }
  });

  window.addEventListener('error', (e) => {
    try {
      if (window.__discoverVisiting) {
        window.__discoverPageErrorDetected = { message: e?.message || String(e), href: window.__discoverCurrentHref, at: Date.now() };
      }
    } catch (err) { /* never let the listener itself throw */ }
  });
  window.addEventListener('unhandledrejection', (e) => {
    try {
      if (window.__discoverVisiting) {
        window.__discoverPageErrorDetected = { message: (e?.reason && e.reason.message) || String(e?.reason), href: window.__discoverCurrentHref, at: Date.now() };
      }
    } catch (err) { /* never let the listener itself throw */ }
  });

  function firstTextNode(el) {
    try {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = n.nodeValue.trim();
        if (t) return t;
      }
    } catch (e) {}
    return '';
  }

  // ---- Page-text capture + matching against captured JSON ----
  const PAGE_TEXT_MAX_LEN = 8000;

  function captureVisiblePageText() {
    return safe(() => {
      const source = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
      const clone = source.cloneNode(true);
      clone.querySelectorAll('#__capturePanel').forEach((el) => el.remove());
      const text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
      return text.slice(0, PAGE_TEXT_MAX_LEN);
    }, 'captureVisiblePageText') || '';
  }

  function findRegistryEntryForCurrentPath() {
    return safe(() => {
      const path = location.pathname;
      for (const [href, entry] of window.__navLinkRegistry.entries()) {
        if (href.split('?')[0] === path) return entry;
      }
      return null;
    }, 'findRegistryEntryForCurrentPath') || null;
  }

  function captureCurrentPageTextIfKnown() {
    safe(() => {
      const entry = findRegistryEntryForCurrentPath();
      if (!entry) return;
      const text = captureVisiblePageText();
      if (text && text !== entry.pageText) {
        entry.pageText = text;
        entry.pageTextCapturedAt = Date.now();
        window.__navLinkRegistry.set(entry.href, entry);
      }
    }, 'captureCurrentPageTextIfKnown');
  }

  // A handful of generic words show up in almost every JSON blob (keys like
  // "name"/"status"/"enabled") and in nearly every page's chrome (buttons,
  // nav labels). Excluding them keeps matches meaningful instead of every
  // page "matching" every call a little.
  const MATCH_STOPWORDS = new Set([
    'the', 'and', 'for', 'with', 'this', 'that', 'from', 'your', 'you', 'are', 'was', 'were',
    'has', 'have', 'will', 'can', 'not', 'all', 'any', 'settings', 'save', 'cancel', 'edit',
    'delete', 'remove', 'add', 'create', 'update', 'name', 'description', 'type', 'status',
    'active', 'enabled', 'disabled', 'yes', 'no', 'none', 'loading', 'error', 'submit', 'close',
    'open', 'view', 'details', 'more', 'less', 'show', 'hide', 'search', 'filter', 'select',
    'clear', 'back', 'next', 'previous', 'page', 'total', 'items', 'member', 'members', 'group',
    'groups', 'role', 'roles', 'organization', 'admin', 'users', 'user', 'icon', 'click', 'learn',
    'info', 'information', 'help', 'beta', 'new',
  ]);

  function tokenizePageText(text) {
    const tokens = new Map(); // lowercase key -> { weight, display }
    const add = (raw, weight) => {
      const t = (raw || '').trim();
      if (t.length < 4) return;
      const key = t.toLowerCase();
      if (MATCH_STOPWORDS.has(key)) return;
      const existing = tokens.get(key);
      if (!existing || existing.weight < weight) tokens.set(key, { weight, display: t });
    };

    (text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).forEach((m) => add(m, 4));
    (text.match(/\b([A-Z][a-zA-Z0-9]*(?:[\s.-][A-Z][a-zA-Z0-9]*){1,4})\b/g) || []).forEach((m) => add(m, 3));
    (text.match(/\b\d{2,}(?:[.,]\d+)?\b/g) || []).forEach((m) => add(m, 1.5));
    (text.match(/\b[a-zA-Z]{6,}\b/g) || []).forEach((m) => add(m, 1));

    return Array.from(tokens.values())
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 60)
      .map((v) => ({ key: v.display.toLowerCase(), weight: v.weight, display: v.display }));
  }

  function matchPageToCalls(pageText, searchableCalls) {
    const tokens = tokenizePageText(pageText || '');
    if (!tokens.length || !searchableCalls.length) return [];
    return searchableCalls
      .map((c) => {
        let score = 0;
        const matched = [];
        for (const tok of tokens) {
          if (c.haystack.includes(tok.key)) {
            score += tok.weight;
            matched.push(tok.display);
          }
        }
        return { method: c.method, url: c.url, score: Math.round(score * 10) / 10, matchedTokens: matched.slice(0, 15) };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }

  function scanSideMenuLinks() {
    return safe(() => {
      const scrollRoot = document.querySelector('[data-testid="admin-settings-nav-scroll"]');
      const found = [];

      if (scrollRoot) {
        const contentRoot = scrollRoot.querySelector(':scope > div') || scrollRoot;
        let currentSection = '';
        Array.from(contentRoot.children).forEach((child) => {
          if (child.tagName === 'UL') {
            child.querySelectorAll('a[href]').forEach((a) => {
              const href = a.getAttribute('href');
              if (!href || !href.startsWith('/admin-settings/')) return;
              found.push({ section: currentSection, label: firstTextNode(a) || href, href });
            });
          } else {
            const text = (child.textContent || '').trim();
            if (text) currentSection = text;
          }
        });
      }

      if (!found.length) {
        document.querySelectorAll('a[href^="/admin-settings/"]').forEach((a) => {
          const href = a.getAttribute('href');
          if (!href) return;
          found.push({ section: '(ungrouped)', label: firstTextNode(a) || href, href });
        });
      }

      return found;
    }, 'scanSideMenuLinks') || [];
  }

  function pollNavLinks() {
    safe(() => {
      const found = scanSideMenuLinks();
      let newCount = 0;
      found.forEach((l) => {
        if (!window.__navLinkRegistry.has(l.href)) {
          window.__navLinkRegistry.set(l.href, {
            ...l,
            firstSeenAt: Date.now(),
            seenInPanel: false,
            hardNav: window.__hardNavHrefs.has(l.href),
          });
          newCount++;
        }
      });
      if (newCount > 0) {
        console.log(`%c[discover] ${newCount} new left-nav item(s) found.`, 'color:#8a5cf6;font-weight:bold;');
      }
      // Tab counts always refresh; the Pages tab body only re-renders if a
      // "Visit checked" run isn't using it right now (see refreshPanel).
      safe(refreshPanel, 'refreshPanel/pollNavLinks');
      // Opportunistically grab the current page's text too, so pages you
      // browse to manually (not just via "Visit checked") still end up
      // with a text snapshot for matching later.
      captureCurrentPageTextIfKnown();
    }, 'pollNavLinks');
  }

  safe(pollNavLinks, 'initial pollNavLinks');
  const discoverPollInterval = setInterval(() => safe(pollNavLinks, 'pollNavLinks interval'), DISCOVER_POLL_MS);

  const NAV_CONFIRM_TIMEOUT_MS = 4000;
  const NAV_CONFIRM_POLL_MS = 150;
  const NAV_SETTLE_MS = 500; // extra time after pathname changes for content to render

  // Waits until location.pathname matches the target href's path (or times
  // out), instead of a blind fixed sleep — this is what made most visits
  // land on stale/previous-page content before.
  async function waitForNavigationTo(targetHref) {
    const targetPath = targetHref.split('?')[0];
    const deadline = Date.now() + NAV_CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (location.pathname === targetPath) {
        await sleep(NAV_SETTLE_MS);
        return true;
      }
      await sleep(NAV_CONFIRM_POLL_MS);
    }
    return location.pathname === targetPath;
  }

  async function visitChecked() {
    if (window.__discoverVisiting) {
      alert('A "Visit checked" run is already in progress — wait for it to finish (or reload the page to reset) before starting another.');
      return;
    }

    const checkboxes = document.querySelectorAll('#__panelBody input[type="checkbox"][data-href]');
    const checkedHrefs = Array.from(checkboxes).filter((cb) => cb.checked).map((cb) => cb.dataset.href);

    if (!checkedHrefs.length) {
      alert('Nothing checked.');
      return;
    }

    window.__discoverVisiting = true;
    const visitBtn = document.getElementById('__panelFooterBtn');
    if (visitBtn) visitBtn.disabled = true;
    let failures = 0;
    let crashed = 0;
    let stoppedEarly = false;

    try {
      for (let i = 0; i < checkedHrefs.length; i++) {
        const href = checkedHrefs[i];

        const existingEntry = window.__navLinkRegistry.get(href);
        if (existingEntry?.hardNav && !existingEntry?.hardNavOverridden) {
          console.warn(`[discover] skipping ${href} — flagged from a previous run as causing a full page reload. Check it again explicitly if you want to retry.`);
          continue;
        }

        setStatusLine(`Visiting (${i + 1}/${checkedHrefs.length}): ${href}`);
        console.log(`%c[discover] visiting ${href}`, 'color:#8a5cf6;font-weight:bold;');

        window.__discoverCurrentHref = href;
        window.__discoverPageErrorDetected = null;

        // Wrap the WHOLE iteration, not just individual DOM calls: if
        // something we didn't anticipate throws (site-side or otherwise),
        // we log it against this specific href and move on to the next
        // one instead of the entire run silently stopping.
        try {
          const alreadyThere = location.pathname === href.split('?')[0];
          if (alreadyThere) {
            // Being "already there" doesn't mean this page's on-mount data
            // has actually been captured — if you were sitting on it when
            // auditing turned on, its mount fetches already fired before
            // we were listening and we'd otherwise never see them. Bounce
            // through a different known page and back to force a real
            // remount under active recording.
            const bounceHref = Array.from(window.__navLinkRegistry.keys()).find((h) => h !== href);
            if (bounceHref) {
              const bounceAnchor = safe(() => document.querySelector(`a[href="${bounceHref}"]`), 'visitChecked/bounceQuery');
              if (bounceAnchor) {
                console.log(`%c[discover] already on ${href} — bouncing via ${bounceHref} to force its on-mount data to refire.`, 'color:#8a5cf6;');
                safe(() => bounceAnchor.click(), 'visitChecked/bounceClick');
                await waitForNavigationTo(bounceHref);
              }
            }
            const backAnchor = safe(() => document.querySelector(`a[href="${href}"]`), 'visitChecked/backQuery');
            if (backAnchor) {
              safe(() => backAnchor.click(), 'visitChecked/backClick');
              await waitForNavigationTo(href);
            } else {
              await sleep(NAV_SETTLE_MS);
            }
          } else {
            const found = safe(() => document.querySelector(`a[href="${href}"]`), 'visitChecked/querySelector');
            if (found) {
              safe(() => found.click(), 'visitChecked/click');
            } else {
              console.warn('[discover] could not find nav anchor for', href, '— navigating directly.');
              safe(() => { location.href = href; }, 'visitChecked/directNav');
            }
            const arrived = await waitForNavigationTo(href);
            if (!arrived) {
              failures++;
              console.warn(`[discover] navigation to ${href} did not complete within ${NAV_CONFIRM_TIMEOUT_MS}ms — still on ${location.pathname}. Capturing whatever is currently shown, then moving on.`);
            }
          }

          if (window.__discoverPageErrorDetected && window.__discoverPageErrorDetected.href === href) {
            crashed++;
            const entry = window.__navLinkRegistry.get(href);
            if (entry) {
              entry.crashed = true;
              entry.crashMessage = window.__discoverPageErrorDetected.message;
              window.__navLinkRegistry.set(href, entry);
            }
            console.error(`[discover] the page threw an error while/after visiting ${href}: ${window.__discoverPageErrorDetected.message}`);

            const navStillThere = safe(() => !!document.querySelector('[data-testid="admin-settings-nav-scroll"]'), 'visitChecked/navCheck');
            if (!navStillThere) {
              console.error('[discover] the admin-settings nav is no longer on the page — the app may have crashed. Stopping the rest of this run.');
              stoppedEarly = true;
              break;
            }
            continue; // skip text capture for a page that just errored
          }

          safe(() => {
            const text = captureVisiblePageText();
            const entry = window.__navLinkRegistry.get(href);
            if (entry && text) {
              entry.pageText = text;
              entry.pageTextCapturedAt = Date.now();
              window.__navLinkRegistry.set(href, entry);
            }
          }, 'visitChecked/captureText');
        } catch (iterErr) {
          crashed++;
          console.error(`[discover] unexpected error while visiting ${href} — skipping it and continuing:`, iterErr);
          const entry = window.__navLinkRegistry.get(href);
          if (entry) {
            entry.crashed = true;
            entry.crashMessage = String(iterErr);
            window.__navLinkRegistry.set(href, entry);
          }
        } finally {
          window.__discoverCurrentHref = null;
        }
      }
    } finally {
      window.__discoverVisiting = false;
      if (visitBtn) {
        visitBtn.disabled = false;
      }
      setStatusLine(stoppedEarly ? 'Discover stopped early — see console.' : 'Discover finished.');
      setTimeout(() => { if (!window.__gatherRunning && !window.__discoverVisiting) clearStatusLine(); }, 3000);
      safe(updateButtonLabel, 'updateButtonLabel/visitChecked');
      console.log(
        `%c[discover] done visiting${stoppedEarly ? ' (stopped early)' : ''} — ${checkedHrefs.length} checked` +
          `${failures ? `, ${failures} slow/unconfirmed` : ''}${crashed ? `, ${crashed} crashed` : ''}.`,
        'color:#8a5cf6;font-weight:bold;'
      );
      if (stoppedEarly) {
        alert('The page seems to have crashed while Discover was visiting a page — the run stopped early. You may need to reload the page. Whatever was captured before that point is still in the zip.');
      }
    }

    // Per request: Discover produces its own zip when a visit run finishes,
    // so the page text + matches are packaged up without a separate click.
    await safe(() => downloadZip(), 'visitChecked/auto-download');
  }

  // Renders the "Pages" tab body into whatever container the persistent
  // panel hands it (see mountPanel/refreshPanel further down). Pure
  // rendering only — no outer chrome, no panel creation, since there's now
  // exactly one panel for the whole session.
  const smallBtnStyle = 'font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid #d0d0d0;background:#f5f5f5;cursor:pointer;';

  function renderPagesTabBody(bodyEl, footerEl) {
    safe(() => {
      const links = Array.from(window.__navLinkRegistry.values()).sort((a, b) => {
        if (a.section === b.section) return 0;
        return (a.section || '').localeCompare(b.section || '');
      });

      bodyEl.innerHTML = '';

      const toolRow = document.createElement('div');
      toolRow.style.cssText = 'display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #eee;flex-shrink:0;';

      const selectAllBtn = document.createElement('button');
      selectAllBtn.textContent = 'Select all';
      selectAllBtn.style.cssText = smallBtnStyle;
      selectAllBtn.addEventListener('click', () => bodyEl.querySelectorAll('input[type="checkbox"][data-href]').forEach((cb) => { cb.checked = true; }));
      toolRow.appendChild(selectAllBtn);

      const selectNoneBtn = document.createElement('button');
      selectNoneBtn.textContent = 'Select none';
      selectNoneBtn.style.cssText = smallBtnStyle;
      selectNoneBtn.addEventListener('click', () => bodyEl.querySelectorAll('input[type="checkbox"][data-href]').forEach((cb) => { cb.checked = false; }));
      toolRow.appendChild(selectNoneBtn);

      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy list';
      copyBtn.style.cssText = smallBtnStyle;
      copyBtn.addEventListener('click', async () => {
        const text = links.map((l) => `${l.section ? '[' + l.section + '] ' : ''}${l.label}\t${l.href}`).join('\n');
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = 'Copied ✓';
        } catch (e) {
          console.log('[discover] clipboard write failed, here is the list:\n' + text);
          copyBtn.textContent = 'See console';
        }
        setTimeout(() => { copyBtn.textContent = 'Copy list'; }, 1500);
      });
      toolRow.appendChild(copyBtn);
      bodyEl.appendChild(toolRow);

      const scrollArea = document.createElement('div');
      scrollArea.style.cssText = 'overflow-y:auto;flex:1;';

      let lastSection = null;
      links.forEach((l) => {
        if (l.section !== lastSection) {
          lastSection = l.section;
          const sectionHeader = document.createElement('div');
          sectionHeader.textContent = l.section || 'General';
          sectionHeader.style.cssText = 'padding:6px 12px;background:#faf9fc;font-weight:600;color:#5b21b6;font-size:11px;text-transform:uppercase;letter-spacing:0.02em;';
          scrollArea.appendChild(sectionHeader);
        }

        const row = document.createElement('label');
        row.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:8px 12px;border-bottom:1px solid #f2f2f2;cursor:pointer;';

        const isRisky = l.hardNav || l.crashed;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !isRisky; // known-bad hrefs start unchecked, opt back in deliberately
        checkbox.dataset.href = l.href;
        checkbox.style.cssText = 'margin-top:2px;flex-shrink:0;';
        checkbox.addEventListener('change', () => {
          if (checkbox.checked && isRisky) {
            const entry = window.__navLinkRegistry.get(l.href);
            if (entry) { entry.hardNavOverridden = true; window.__navLinkRegistry.set(l.href, entry); }
          }
        });
        row.appendChild(checkbox);

        const textWrap = document.createElement('div');
        textWrap.style.cssText = 'min-width:0;';

        const labelEl = document.createElement('div');
        labelEl.style.cssText = 'color:#222;font-weight:500;';
        labelEl.textContent = l.label;
        if (!l.seenInPanel) {
          const badge = document.createElement('span');
          badge.textContent = 'NEW';
          badge.style.cssText = 'margin-left:6px;font-size:9px;font-weight:700;color:#0f766e;background:#ccfbf1;padding:1px 5px;border-radius:4px;vertical-align:middle;';
          labelEl.appendChild(badge);
        }
        if (l.pageText) {
          const textBadge = document.createElement('span');
          textBadge.textContent = 'TXT';
          textBadge.title = `Page text captured (${l.pageText.length} chars) — used to match this page to its API calls on download.`;
          textBadge.style.cssText = 'margin-left:6px;font-size:9px;font-weight:700;color:#5b21b6;background:#f3e8ff;padding:1px 5px;border-radius:4px;vertical-align:middle;';
          labelEl.appendChild(textBadge);
        }
        if (l.hardNav) {
          const hardNavBadge = document.createElement('span');
          hardNavBadge.textContent = '⚠ FULL RELOAD';
          hardNavBadge.title = 'Visiting this previously caused a full page reload, not an in-app navigation. Unchecked by default.';
          hardNavBadge.style.cssText = 'margin-left:6px;font-size:9px;font-weight:700;color:#991b1b;background:#fee2e2;padding:1px 5px;border-radius:4px;vertical-align:middle;';
          labelEl.appendChild(hardNavBadge);
        } else if (l.crashed) {
          const crashBadge = document.createElement('span');
          crashBadge.textContent = '⚠ CRASHED';
          crashBadge.title = `The page threw an error while visiting this: ${l.crashMessage || 'unknown error'}. Unchecked by default.`;
          crashBadge.style.cssText = 'margin-left:6px;font-size:9px;font-weight:700;color:#991b1b;background:#fee2e2;padding:1px 5px;border-radius:4px;vertical-align:middle;';
          labelEl.appendChild(crashBadge);
        }
        textWrap.appendChild(labelEl);

        const path = document.createElement('div');
        path.textContent = l.href;
        path.style.cssText = 'color:#888;font-size:10px;margin-top:2px;word-break:break-all;';
        textWrap.appendChild(path);

        row.appendChild(textWrap);
        scrollArea.appendChild(row);

        l.seenInPanel = true;
        window.__navLinkRegistry.set(l.href, l);
      });
      bodyEl.appendChild(scrollArea);

      footerEl.innerHTML = '';
      const visitBtn = document.createElement('button');
      visitBtn.id = '__panelFooterBtn';
      visitBtn.textContent = window.__discoverVisiting ? 'Visiting…' : `Visit checked (${links.length})`;
      visitBtn.disabled = window.__discoverVisiting;
      visitBtn.style.cssText = 'width:100%;font-size:12px;padding:8px;border-radius:8px;border:1px solid #8a5cf6;background:#8a5cf6;color:#fff;cursor:pointer;font-weight:600;';
      visitBtn.addEventListener('click', () => visitChecked());
      footerEl.appendChild(visitBtn);
    }, 'renderPagesTabBody');
  }

  // Renders the "Files" tab: a live preview of exactly what Download would
  // zip up (post-noise-filter, post-dedup), so you can see what's staged
  // before committing to a download.
  function renderFilesTabBody(bodyEl, footerEl) {
    safe(() => {
      const all = window.__capturedApiCalls;
      const nonNoise = all.filter((c) => !c.noise);
      const { kept, duplicatesRemoved } = dedupe(nonNoise);

      bodyEl.innerHTML = '';

      const summary = document.createElement('div');
      summary.style.cssText = 'padding:8px 12px;border-bottom:1px solid #eee;font-size:11px;color:#555;flex-shrink:0;';
      const auto = kept.filter((c) => c.trigger === 'auto').length;
      const interaction = kept.filter((c) => c.trigger === 'interaction').length;
      const gathered = kept.filter((c) => c.trigger === 'gather').length;
      summary.textContent =
        `${kept.length} file(s) staged — ${auto} auto, ${interaction} interaction, ${gathered} gather ` +
        `(${all.length - nonNoise.length} filtered as noise, ${duplicatesRemoved.length} duplicate URL(s) collapsed)`;
      bodyEl.appendChild(summary);

      const filterRow = document.createElement('div');
      filterRow.style.cssText = 'display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #eee;flex-shrink:0;';
      let activeFilter = window.__filesTabFilter || 'all';
      ['all', 'auto', 'interaction', 'gather'].forEach((f) => {
        const chip = document.createElement('button');
        chip.textContent = f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1);
        chip.style.cssText = smallBtnStyle + (f === activeFilter ? 'background:#8a5cf6;color:#fff;border-color:#8a5cf6;' : '');
        chip.addEventListener('click', () => {
          window.__filesTabFilter = f;
          renderFilesTabBody(bodyEl, footerEl);
        });
        filterRow.appendChild(chip);
      });
      bodyEl.appendChild(filterRow);

      const scrollArea = document.createElement('div');
      scrollArea.style.cssText = 'overflow-y:auto;flex:1;';
      const filtered = activeFilter === 'all' ? kept : kept.filter((c) => c.trigger === activeFilter);

      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.textContent = 'Nothing staged yet — turn on Auditing, click Gather, or visit some pages via the Pages tab.';
        empty.style.cssText = 'padding:16px 12px;color:#888;font-size:11px;';
        scrollArea.appendChild(empty);
      }

      filtered.forEach((c) => {
        const row = document.createElement('div');
        row.style.cssText = 'padding:6px 12px;border-bottom:1px solid #f2f2f2;cursor:pointer;';
        row.title = 'Click to log the full captured entry to the console.';
        row.addEventListener('click', () => console.log('[capture] entry:', c));

        const top = document.createElement('div');
        top.style.cssText = 'display:flex;align-items:center;gap:6px;';
        const triggerColors = { auto: '#8a5cf6', interaction: '#c2410c', gather: '#0f766e' };
        const triggerBadge = document.createElement('span');
        triggerBadge.textContent = c.trigger || '?';
        triggerBadge.style.cssText = `font-size:9px;font-weight:700;color:#fff;background:${triggerColors[c.trigger] || '#888'};padding:1px 5px;border-radius:4px;flex-shrink:0;`;
        top.appendChild(triggerBadge);
        const methodStatus = document.createElement('span');
        methodStatus.textContent = `${c.method} ${c.status ?? ''}`;
        methodStatus.style.cssText = 'font-size:10px;color:#555;flex-shrink:0;';
        top.appendChild(methodStatus);
        row.appendChild(top);

        const urlEl = document.createElement('div');
        urlEl.textContent = c.url;
        urlEl.style.cssText = 'font-size:10px;color:#333;word-break:break-all;margin-top:2px;';
        row.appendChild(urlEl);

        scrollArea.appendChild(row);
      });
      bodyEl.appendChild(scrollArea);

      footerEl.innerHTML = '';
      const downloadBtn = document.createElement('button');
      downloadBtn.id = '__panelFooterBtn';
      downloadBtn.textContent = `Download zip (${kept.length} file${kept.length === 1 ? '' : 's'})`;
      downloadBtn.style.cssText = 'width:100%;font-size:12px;padding:8px;border-radius:8px;border:1px solid #8a5cf6;background:#8a5cf6;color:#fff;cursor:pointer;font-weight:600;';
      downloadBtn.addEventListener('click', () => safe(downloadZip, 'downloadZip click'));
      footerEl.appendChild(downloadBtn);
    }, 'renderFilesTabBody');
  }

  // -----------------------------------------------------------------------
  // GATHER — clears prior captures for a clean run, then actively replays
  // the read-only calls that manual clicking produced, for every
  // role/group/member/connector, using direct fetches. Always records
  // (trigger:'gather'), independent of the auditing toggle.
  // -----------------------------------------------------------------------
  const GATHER_DELAY_MS = 150;

  async function gatherFetch(url, options = {}) {
    const startedAt = new Date().toISOString();
    const method = (options.method || 'GET').toUpperCase();
    let status = null, responseBody = null, error = null;

    try {
      const res = await originalFetch(url, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
      });
      status = res.status;
      const text = await res.text();
      try { responseBody = JSON.parse(text); } catch (e) { responseBody = text; }
    } catch (e) {
      error = String(e);
    }

    record({
      type: 'gather', url, method, status, startedAt,
      requestBody: options.body ? safeTruncate(typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
      responseBody: typeof responseBody === 'string' ? safeTruncate(responseBody) : responseBody,
      error,
      trigger: 'gather',
    });

    return { status, body: responseBody, error };
  }

  function detectOrgUuid() {
    return safe(() => {
      const match = window.__capturedApiCalls
        .map((c) => c.url && c.url.match(/\/api\/organizations\/([0-9a-fA-F-]{36})(\/|$|\?)/))
        .find(Boolean);
      if (match) return match[1];
      const pathMatch = location.pathname.match(/([0-9a-fA-F-]{36})/);
      if (pathMatch) return pathMatch[1];
      return null;
    }, 'detectOrgUuid') || null;
  }

  async function gatherAll() {
    if (window.__gatherRunning) {
      alert('Gather is already running.');
      return;
    }

    // Need an org UUID before we can do anything. If auditing has never
    // been on and nothing's been captured yet, we can't detect it — ask
    // for one pass with auditing on first, rather than guessing.
    let orgUuid = detectOrgUuid();
    if (!orgUuid) {
      const wasOff = !auditingEnabled;
      if (wasOff) {
        console.log('%c[gather] auditing was off — briefly enabling it to detect the org ID from the next request…', 'color:#8a5cf6;');
        installPatches();
      }
      alert('Could not detect your organization ID yet.\n\nAuditing has been turned on — please reload the page once so I can see a request, then click Gather again.');
      return;
    }

    const proceed = window.confirm(
      'Gather will clear all currently captured data (so the download afterward reflects only this run) and then actively fetch role, group, member, and connector data directly via the API.\n\nContinue?'
    );
    if (!proceed) return;

    window.__capturedApiCalls.length = 0;
    safe(updateButtonLabel, 'updateButtonLabel/gatherClear');

    window.__gatherRunning = true;
    window.__gatherAbort = false;
    const btn = document.getElementById('__toolbarGatherBtn');
    if (btn) btn.disabled = true;
    const setStatus = (t) => setStatusLine(t);
    const base = `/api/organizations/${orgUuid}`;
    const summary = { roles: 0, groups: 0, members: 0, bindingBatches: 0, connectors: 0, roleConnectorPolicyHits: 0, errors: 0 };

    try {
      // ---- Org overview ----
      // These are exactly the calls the Organization/Team-overview page
      // fires on its very first mount. On any later in-app visit the
      // site's own data layer serves most of them from cache instead of
      // refetching, so Discover's "bounce and revisit" trick can't reach
      // them — but a plain direct fetch here has no cache to fight.
      setStatus('Gather: org overview…');
      const orgOverviewEndpoints = [
        `${base}`,
        `${base}/feature_overview`,
        `${base}/hipaa/status`,
        `${base}/data_residency`,
        `${base}/discoverability`,
        `${base}/enterprise_auth/v2/sso_settings`,
        `${base}/cowork_settings`,
        `${base}/model_settings_configuration?supports_model_updates=1`,
        `${base}/subscription_status`,
        `${base}/subscription_details`,
        `${base}/subscription_details?cached=true`,
        `${base}/subscription/scheduled_seat_tier_changes`,
        `${base}/members_limit`,
        `${base}/members_limit?cached=true`,
        `${base}/members/assignable_seat_tiers`,
        `${base}/passport_grants`,
        `${base}/skills/list-skills`,
        `${base}/coach/sessions?limit=1`,
        `${base}/dust/org_shortname`,
        `${base}/mcp/remote_servers_with_connection`,
        `${base}/centralized_management/summary`,
        `${base}/overage_spend_limits?page=1&per_page=1&include_counts=false&include_members=false&include_blocked_seat_hours=true`,
        `${base}/library_submissions?statuses=pending`,
        `${base}/dxt/installable_extensions?limit=500`,
        `${base}/admin_requests/agent_credential`,
        `${base}/admin_requests/join_org`,
        `${base}/admin_requests/limit_increase`,
        `${base}/admin_requests/operon_access`,
        `${base}/admin_requests/seat_upgrade`,
        `/api/billing/${orgUuid}/gift/purchase_eligibility`,
        `/api/account/sse_invoice_cap_block_status?organization_uuid=${orgUuid}`,
        `/api/bootstrap/${orgUuid}/current_user_access`,
        `/api/claude_code/organizations/${orgUuid}/user_settings`,
        `/api/frame/invites/org/enabled?org=${orgUuid}`,
        `${base}/experiences/claude_web?locale=en-US`,
      ];
      for (const url of orgOverviewEndpoints) {
        if (window.__gatherAbort) break;
        await gatherFetch(url);
        await sleep(GATHER_DELAY_MS);
      }

      // Bonus: check-domains needs an actual domain, which we only know
      // after fetching allowed_domains — so fetch that first, then use it.
      if (!window.__gatherAbort) {
        const domainsResp = await gatherFetch(`${base}/allowed_domains`);
        const domains = Array.isArray(domainsResp.body?.domains) ? domainsResp.body.domains
          : Array.isArray(domainsResp.body) ? domainsResp.body : [];
        if (domains.length) {
          await gatherFetch(`/api/organizations/discoverability/check-domains?domains=${encodeURIComponent(domains[0])}&organization_uuid=${orgUuid}`);
          await sleep(GATHER_DELAY_MS);
        }
      }

      // ---- Claude Code / Agents ----
      // Sub-tab data that's otherwise only reachable by clicking into
      // Claude Code's "Agents" section specifically.
      if (!window.__gatherAbort) {
        setStatus('Gather: Claude Code agents…');
        const agentEndpoints = [
          '/v1/code/agent-proxy/rules',
          '/v1/code/agent-proxy/credentials',
          '/v1/code/agent-proxy/provisioning-links',
          '/v1/code/agent-proxy/oauth/token-vault/providers',
          '/v1/code/agents?limit=200&ancestors_first=true&include_virtual=true&include_slack_binding=true&include_teams_binding=true',
        ];
        for (const url of agentEndpoints) {
          if (window.__gatherAbort) break;
          await gatherFetch(url);
          await sleep(GATHER_DELAY_MS);
        }
      }

      setStatus('Gather: roles…');
      const rolesAdmin = await gatherFetch(`${base}/roles?page_size=100&source_type=admin_created`);
      const rolesAnthropic = await gatherFetch(`${base}/roles?page_size=100&source_type=anthropic_granted`);
      await gatherFetch(`${base}/roles-configuration`);
      const allRoles = [...(rolesAdmin.body?.roles || []), ...(rolesAnthropic.body?.roles || [])];
      summary.roles = allRoles.length;

      for (const role of allRoles) {
        if (window.__gatherAbort) break;
        setStatus(`Gather: role "${role.name || role.role_uuid}"…`);
        await gatherFetch(`${base}/roles/${role.role_uuid}/permissions?page_size=100`); await sleep(GATHER_DELAY_MS);
        await gatherFetch(`${base}/roles/${role.role_uuid}/assignments?page_size=100`); await sleep(GATHER_DELAY_MS);
      }

      if (!window.__gatherAbort) {
        setStatus('Gather: groups…');
        const groupsResp = await gatherFetch(`${base}/groups?page_size=1000&include_member_count=true`);
        const groups = groupsResp.body?.groups || [];
        summary.groups = groups.length;

        for (const group of groups) {
          if (window.__gatherAbort) break;
          const gid = group.group_uuid || group.uuid;
          if (!gid) continue;
          setStatus(`Gather: group "${group.name || gid}"…`);
          await gatherFetch(`${base}/groups/${gid}/visibility`); await sleep(GATHER_DELAY_MS);
          await gatherFetch(`${base}/groups/${gid}/members?page_size=200`); await sleep(GATHER_DELAY_MS);
          await gatherFetch(`${base}/groups/${gid}/skill_shares`); await sleep(GATHER_DELAY_MS);
          await gatherFetch(`${base}/groups/${gid}/project_shares`); await sleep(GATHER_DELAY_MS);
          await gatherFetch(`${base}/role-assignments?principal_id=${gid}&page_size=100`); await sleep(GATHER_DELAY_MS);
        }
      }

      const accountUuids = [];
      if (!window.__gatherAbort) {
        setStatus('Gather: members…');
        let offset = 0;
        const limit = 100;
        let total = Infinity;
        while (offset < total) {
          if (window.__gatherAbort) break;
          const resp = await gatherFetch(`${base}/members_v2?offset=${offset}&limit=${limit}&types%5B%5D=member`);
          const data = resp.body?.data || [];
          const pagination = resp.body?.pagination || {};
          total = typeof pagination.total === 'number' ? pagination.total : data.length;
          data.forEach((d) => { const u = d?.member?.account?.uuid; if (u) accountUuids.push(u); });
          if (!pagination.has_more) break;
          offset += limit;
          await sleep(GATHER_DELAY_MS);
        }
        summary.members = accountUuids.length;
      }

      if (!window.__gatherAbort && accountUuids.length) {
        setStatus('Gather: role/group bindings…');
        const BATCH = 40;
        for (let i = 0; i < accountUuids.length; i += BATCH) {
          if (window.__gatherAbort) break;
          const batch = accountUuids.slice(i, i + BATCH);
          await gatherFetch(`${base}/rbac/account-bindings:query`, { method: 'POST', body: JSON.stringify({ account_uuids: batch }) });
          summary.bindingBatches++;
          await sleep(GATHER_DELAY_MS);
        }
      }

      if (!window.__gatherAbort) {
        setStatus('Gather: connectors…');
        const serversResp = await gatherFetch(`${base}/mcp/remote_servers`);
        const servers = Array.isArray(serversResp.body) ? serversResp.body : [];
        summary.connectors = servers.length;

        const patternBuilders = [
          (ru, su) => `${base}/roles/${ru}/mcp/remote_servers/${su}/tool_policies`,
          (ru, su) => `${base}/mcp/remote_servers/${su}/roles/${ru}/tool_policies`,
          (ru, su) => `${base}/mcp/remote_servers/${su}/tool_policies?role_uuid=${ru}`,
        ];
        let workingPatternIdx = null;

        for (const server of servers) {
          if (window.__gatherAbort) break;
          const sid = server.uuid;
          if (!sid) continue;
          setStatus(`Gather: connector "${server.name || sid}" (org-level)…`);
          await gatherFetch(`${base}/mcp/remote_servers/${sid}/tool_policies`); await sleep(GATHER_DELAY_MS);

          for (const role of allRoles) {
            if (window.__gatherAbort) break;
            setStatus(`Gather: connector "${server.name || sid}" × role "${role.name}"…`);
            const idxList = workingPatternIdx !== null ? [workingPatternIdx] : [0, 1, 2];
            let hit = false;
            for (const idx of idxList) {
              const url = patternBuilders[idx](role.role_uuid, sid);
              const r = await gatherFetch(url);
              await sleep(GATHER_DELAY_MS);
              if (r.status && r.status < 400) {
                summary.roleConnectorPolicyHits++;
                workingPatternIdx = idx;
                hit = true;
                break;
              }
            }
            if (!hit && workingPatternIdx === null) {
              console.warn('[gather] could not find a working role-level connector tool-policy URL shape; leaving org-level only.');
              workingPatternIdx = -1;
            }
            if (workingPatternIdx === -1) break;
          }
        }
      }
    } catch (e) {
      console.error('[gather] unexpected error, stopping early (page left untouched):', e);
      summary.errors++;
    } finally {
      window.__gatherRunning = false;
      if (btn) btn.disabled = false;
      setStatusLine(window.__gatherAbort ? 'Gather aborted.' : '');
      if (!window.__gatherAbort) {
        // Brief confirmation, then clear so the line collapses again.
        setStatusLine('Gather finished.');
        setTimeout(() => { if (!window.__gatherRunning && !window.__discoverVisiting) clearStatusLine(); }, 3000);
      }
      safe(updateButtonLabel, 'updateButtonLabel/gather');
      console.log('%c[gather] summary:', 'color:#0f766e;font-weight:bold;', summary);
    }
  }

  // -----------------------------------------------------------------------
  // PERSISTENT PANEL — one always-visible floating window holding every
  // control (Discover / Gather / Auditing) plus two tabs: "Pages" (the old
  // Discover panel) and "Files" (a live preview of what Download would
  // zip). Mounted once, directly to <body>, independent of any page
  // element — it survives in-app navigation since the SPA only re-renders
  // its own root, not siblings we've appended.
  //
  // updateButtonLabel/updateAuditingButton are kept as thin aliases to
  // refreshPanel() so the many existing `safe(updateButtonLabel, ...)`
  // call sites elsewhere in this file don't need to change.
  // -----------------------------------------------------------------------
  window.__activeTab = window.__activeTab || 'files';
  window.__panelMinimized = window.__panelMinimized || false;
  window.__filesTabFilter = window.__filesTabFilter || 'all';

  function updateButtonLabel() { safe(refreshPanel, 'updateButtonLabel-alias'); }
  function updateAuditingButton() { safe(refreshPanel, 'updateAuditingButton-alias'); }

  function setActiveTab(tab) {
    window.__activeTab = tab;
    safe(refreshPanel, 'refreshPanel/setActiveTab');
  }

  function refreshPanel() {
    safe(() => {
      const panel = document.getElementById('__capturePanel');
      if (!panel) return; // not mounted yet

      const auditBtn = document.getElementById('__toolbarAuditBtn');
      if (auditBtn) {
        auditBtn.textContent = auditingEnabled ? 'Auditing: ON' : 'Auditing: OFF';
        auditBtn.style.opacity = auditingEnabled ? '1' : '0.6';
      }

      const kept = window.__capturedApiCalls.filter((c) => !c.noise);
      const tabPagesBtn = document.getElementById('__tabPagesBtn');
      const tabFilesBtn = document.getElementById('__tabFilesBtn');
      if (tabPagesBtn) tabPagesBtn.textContent = `Pages (${window.__navLinkRegistry.size})`;
      if (tabFilesBtn) tabFilesBtn.textContent = `Files (${kept.length})`;
      if (tabPagesBtn) tabPagesBtn.style.cssText = tabStyle(window.__activeTab === 'pages');
      if (tabFilesBtn) tabFilesBtn.style.cssText = tabStyle(window.__activeTab === 'files');

      const bodyEl = document.getElementById('__panelBody');
      const footerEl = document.getElementById('__panelFooter');
      if (!bodyEl || !footerEl || window.__panelMinimized) return;

      // Don't rebuild the Pages tab's checkboxes/button while a visit run
      // is using them — that's exactly what caused overlapping runs
      // before. The Files tab has no interactive state at risk, so it's
      // always safe to refresh.
      if (window.__activeTab === 'pages') {
        if (!window.__discoverVisiting) renderPagesTabBody(bodyEl, footerEl);
      } else {
        renderFilesTabBody(bodyEl, footerEl);
      }
    }, 'refreshPanel');
  }

  function tabStyle(active) {
    return 'flex:1;font-size:11px;padding:6px 8px;border:none;border-bottom:2px solid ' +
      (active ? '#8a5cf6' : 'transparent') + ';background:' + (active ? '#faf9fc' : '#fff') +
      ';color:' + (active ? '#5b21b6' : '#555') + ';font-weight:' + (active ? '700' : '500') + ';cursor:pointer;';
  }

  // Shared progress line for Gather and Discover's "Visit checked" — keeps
  // the toolbar buttons themselves a fixed size (just "Gather"/"Discover"
  // always) while still surfacing what's actively running and where.
  function setStatusLine(text) {
    safe(() => {
      const el = document.getElementById('__statusLine');
      if (!el) return;
      el.textContent = text;
      el.style.display = text ? 'block' : 'none';
    }, 'setStatusLine');
  }

  function clearStatusLine() {
    setStatusLine('');
  }

  function mountPanel() {
    safe(() => {
      if (document.getElementById('__capturePanel')) return; // already mounted

      const panel = document.createElement('div');
      panel.id = '__capturePanel';
      panel.style.cssText = [
        'position:fixed', 'top:16px', 'right:16px', 'z-index:999999',
        'width:380px', 'max-height:80vh', 'display:flex', 'flex-direction:column',
        'background:#fff', 'border:1px solid #d0d0d0', 'border-radius:10px',
        'box-shadow:0 8px 24px rgba(0,0,0,0.15)', 'font-family:sans-serif',
        'font-size:12px', 'color:#222',
      ].join(';');

      const baseStyle =
        'font-size:11px;padding:2px 8px;border-radius:6px;border:1px solid #d0d0d0;' +
        'background:#f5f5f5;color:#333;cursor:pointer;line-height:1.4;white-space:nowrap;';

      // Header
      const header = document.createElement('div');
      header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid #eee;font-weight:700;flex-shrink:0;color:#5b21b6;';
      header.innerHTML = `<span>Capture</span>`;
      const minBtn = document.createElement('button');
      minBtn.textContent = window.__panelMinimized ? '▢' : '—';
      minBtn.title = 'Minimize / restore';
      minBtn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:14px;color:#666;';
      minBtn.addEventListener('click', () => {
        window.__panelMinimized = !window.__panelMinimized;
        minBtn.textContent = window.__panelMinimized ? '▢' : '—';
        toolbar.style.display = window.__panelMinimized ? 'none' : 'flex';
        tabsRow.style.display = window.__panelMinimized ? 'none' : 'flex';
        bodyEl.style.display = window.__panelMinimized ? 'none' : 'block';
        footerEl.style.display = window.__panelMinimized ? 'none' : 'block';
        if (!window.__panelMinimized) safe(refreshPanel, 'refreshPanel/restore');
      });
      header.appendChild(minBtn);
      panel.appendChild(header);

      // Toolbar
      const toolbar = document.createElement('div');
      toolbar.style.cssText = 'display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid #eee;flex-shrink:0;flex-wrap:wrap;';

      const discoverBtn = document.createElement('button');
      discoverBtn.id = '__toolbarDiscoverBtn';
      discoverBtn.type = 'button';
      discoverBtn.title = 'Turns Auditing on, rescans the left nav, and switches to the Pages tab.';
      discoverBtn.textContent = 'Discover';
      discoverBtn.style.cssText = baseStyle;
      discoverBtn.addEventListener('click', () => safe(() => {
        if (!auditingEnabled) {
          console.log('%c[capture] Discover clicked — turning Auditing on.', 'color:#8a5cf6;');
          installPatches();
        }
        pollNavLinks();
        setActiveTab('pages');
      }, 'toolbar discover click'));
      toolbar.appendChild(discoverBtn);

      const gatherBtn = document.createElement('button');
      gatherBtn.id = '__toolbarGatherBtn';
      gatherBtn.type = 'button';
      gatherBtn.title = 'Clears current captures, then actively fetches role/group/member/connector detail data directly via the API (read-only).';
      gatherBtn.textContent = 'Gather';
      gatherBtn.style.cssText = baseStyle;
      gatherBtn.addEventListener('click', () => safe(() => { setActiveTab('files'); gatherAll(); }, 'gatherAll click'));
      toolbar.appendChild(gatherBtn);

      const auditBtn = document.createElement('button');
      auditBtn.id = '__toolbarAuditBtn';
      auditBtn.type = 'button';
      auditBtn.title = 'Turn passive capture (recording every request the site itself makes) on or off. Gather and Download work either way.';
      auditBtn.style.cssText = baseStyle;
      auditBtn.addEventListener('click', () => safe(() => {
        if (auditingEnabled) uninstallPatches(); else installPatches();
        refreshPanel();
      }, 'auditing toggle click'));
      toolbar.appendChild(auditBtn);

      panel.appendChild(toolbar);

      // Status line — shows Gather/Discover progress without resizing the
      // toolbar buttons themselves. Empty + collapsed when nothing's running.
      const statusLine = document.createElement('div');
      statusLine.id = '__statusLine';
      statusLine.style.cssText = 'padding:0 12px;font-size:10px;color:#8a5cf6;font-style:italic;flex-shrink:0;display:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      panel.appendChild(statusLine);

      // Tabs — Files first, then Pages.
      const tabsRow = document.createElement('div');
      tabsRow.style.cssText = 'display:flex;border-bottom:1px solid #eee;flex-shrink:0;margin-top:6px;';
      const tabFilesBtn = document.createElement('button');
      tabFilesBtn.id = '__tabFilesBtn';
      tabFilesBtn.type = 'button';
      tabFilesBtn.textContent = 'Files (0)';
      tabFilesBtn.addEventListener('click', () => setActiveTab('files'));
      const tabPagesBtn = document.createElement('button');
      tabPagesBtn.id = '__tabPagesBtn';
      tabPagesBtn.type = 'button';
      tabPagesBtn.textContent = 'Pages (0)';
      tabPagesBtn.addEventListener('click', () => setActiveTab('pages'));
      tabsRow.appendChild(tabFilesBtn);
      tabsRow.appendChild(tabPagesBtn);
      panel.appendChild(tabsRow);

      // Body + footer (contents populated by refreshPanel -> renderXTabBody)
      const bodyEl = document.createElement('div');
      bodyEl.id = '__panelBody';
      bodyEl.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;';
      panel.appendChild(bodyEl);

      const footerEl = document.createElement('div');
      footerEl.id = '__panelFooter';
      footerEl.style.cssText = 'padding:10px 12px;border-top:1px solid #eee;flex-shrink:0;';
      panel.appendChild(footerEl);

      document.body.appendChild(panel);
      safe(refreshPanel, 'refreshPanel/initial');
    }, 'mountPanel');
  }

  function whenBodyReady(cb) {
    if (document.body) { safe(cb, 'whenBodyReady/cb'); return; }
    const obs = new MutationObserver(() => {
      if (document.body) {
        obs.disconnect();
        safe(cb, 'whenBodyReady/cb-observed');
      }
    });
    obs.observe(document.documentElement, { childList: true });
  }

  safe(() => whenBodyReady(mountPanel), 'whenBodyReady schedule');

  console.log(
    '%c[capture] loaded (v1.3). A persistent panel is docked top-right — Discover / Gather / Auditing controls plus Pages/Files tabs, always visible. Clicking Discover turns Auditing on automatically.',
    'color:#8a5cf6;font-weight:bold;'
  );
})();
