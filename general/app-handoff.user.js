// ==UserScript==
// @name         App Handoff
// @namespace    https://github.com/warthurton/userscripts
// @version      0.0.0
// @description  Shows a bar the first time a domain is seen in a tab, with buttons to hand the page to another app through a configurable URL scheme (Opener, Shortcuts, etc.), always do so for a domain, or ignore the domain. Built for iOS Userscripts.
// @author       warthurton
// @match        *://*/*
// @run-at       document-idle
// @noframes
// @inject-into  content
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.closeTab
// @grant        GM.getTab
// @grant        GM.saveTab
// @updateURL    https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/app-handoff.meta.js
// @downloadURL  https://raw.githubusercontent.com/warthurton/userscripts/main/_dist/app-handoff.user.js
// @homepageURL  https://github.com/warthurton/userscripts
// @supportURL   https://github.com/warthurton/userscripts/issues
// ==/UserScript==

(function () {
  "use strict";

  const LOG_PREFIX = "[app-handoff]";
  const SETTINGS_KEY = "appHandoff_settings";
  const IGNORED_DOMAINS_KEY = "appHandoff_ignoredDomains";
  const ALWAYS_OPEN_DOMAINS_KEY = "appHandoff_alwaysOpenDomains";
  const SNOOZED_DOMAINS_KEY = "appHandoff_snoozedDomains";
  const CLOSE_DEADLINE_KEY = "appHandoff_closeDeadline";
  // Keys written by the earlier "Opener First Visit Button" script.
  const LEGACY_KEYS = {
    [IGNORED_DOMAINS_KEY]: "openerFirstVisit_ignoredDomains",
    [ALWAYS_OPEN_DOMAINS_KEY]: "openerFirstVisit_alwaysOpenDomains",
    [SNOOZED_DOMAINS_KEY]: "openerFirstVisit_snoozedDomains",
  };

  const BAR_ID = "app-handoff-bar";
  const CONFIG_HASH = "app-handoff-config";
  const DEBUG_HASH = "app-handoff-debug";
  const FADE_DURATION_MS = 400;
  const NARROW_SCREEN_QUERY = "(max-width: 600px)";
  // Set to false once the script is confirmed working.
  const SHOW_DEBUG = true;

  // iOS only hands off to these apps from a real tap on a link, so they are
  // opened with an <a href> and never launched automatically.
  const TAP_ONLY_SCHEMES = ["shortcuts"];
  const BLOCKED_SCHEMES = ["javascript", "data", "vbscript"];

  const DEFAULT_SETTINGS = {
    urlTemplate: "opener://x-callback-url/show-options?url={url}",
    openLabel: "Open in app",
    position: "top",
    closeTabAfterOpen: true,
    barDurationSec: 5,
    refreshBarDurationSec: 15,
    snoozeMinutes: 5,
    closeDelaySec: 30,
    refreshThreshold: 3,
  };

  // Table-driven so the settings form and validation share one definition.
  const NUMBER_SETTINGS = [
    { key: "barDurationSec", label: "First-visit bar shows for (seconds)", min: 1 },
    { key: "refreshBarDurationSec", label: "Reload prompt shows for (seconds)", min: 1 },
    { key: "snoozeMinutes", label: "Snooze after bar times out (minutes)", min: 0 },
    { key: "closeDelaySec", label: "Close tab after opening (seconds)", min: 1 },
    { key: "refreshThreshold", label: "Same-URL loads before prompting", min: 2 },
  ];

  let settings = { ...DEFAULT_SETTINGS };

  // ── Storage ───────────────────────────────────────────────────────

  // Userscripts exposes storage as promises; localStorage is the fallback so a
  // storage failure never blocks the bar.
  async function loadStoredJson(key, fallbackValue) {
    try {
      let raw = await GM.getValue(key);
      if (raw === undefined && LEGACY_KEYS[key]) raw = await GM.getValue(LEGACY_KEYS[key]);
      return raw === undefined ? fallbackValue : JSON.parse(raw);
    } catch (error) {
      console.warn(LOG_PREFIX, "GM.getValue failed, using localStorage", error);
    }
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallbackValue : JSON.parse(raw);
    } catch (error) {
      console.warn(LOG_PREFIX, "localStorage read failed", error);
      return fallbackValue;
    }
  }

  async function saveStoredJson(key, value) {
    const serialized = JSON.stringify(value);
    try {
      await GM.setValue(key, serialized);
      return;
    } catch (error) {
      console.warn(LOG_PREFIX, "GM.setValue failed, using localStorage", error);
    }
    try {
      localStorage.setItem(key, serialized);
    } catch (error) {
      console.warn(LOG_PREFIX, "localStorage write failed", error);
    }
  }

  async function loadDomainList(key) {
    const stored = await loadStoredJson(key, []);
    return new Set(Array.isArray(stored) ? stored : []);
  }

  function saveDomainList(key, domains) {
    return saveStoredJson(key, [...domains]);
  }

  // Maps domain to the epoch ms when its snooze ends; expired entries are dropped.
  async function loadSnoozedDomains() {
    const stored = await loadStoredJson(SNOOZED_DOMAINS_KEY, {});
    const now = Date.now();
    const entries = stored && typeof stored === "object" ? Object.entries(stored) : [];
    return Object.fromEntries(entries.filter(([, expiresAt]) => expiresAt > now));
  }

  async function snoozeDomain(domain) {
    if (settings.snoozeMinutes <= 0) return;
    const snoozed = await loadSnoozedDomains();
    snoozed[domain] = Date.now() + settings.snoozeMinutes * 60 * 1000;
    await saveStoredJson(SNOOZED_DOMAINS_KEY, snoozed);
  }

  // The tab object persists across navigations within one tab, which is what
  // "first time seen in the current tab" needs.
  async function loadTabState() {
    try {
      const tab = await GM.getTab();
      return { tab: tab || {}, isAvailable: true };
    } catch (error) {
      console.warn(LOG_PREFIX, "GM.getTab failed", error);
      return { tab: {}, isAvailable: false };
    }
  }

  async function saveTabState(tab) {
    try {
      await GM.saveTab(tab);
    } catch (error) {
      console.warn(LOG_PREFIX, "GM.saveTab failed", error);
    }
  }

  // Cancelling the close means the user wants to stay, so always-open must not
  // pull them back to the app on every page of this domain in this tab.
  async function markStayInTab(domain) {
    const { tab } = await loadTabState();
    const stayDomains = new Set(Array.isArray(tab.stayDomains) ? tab.stayDomains : []);
    stayDomains.add(domain);
    await saveTabState({ ...tab, stayDomains: [...stayDomains] });
  }

  // sessionStorage is per tab, so a reload of this tab can still honor the deadline.
  function readCloseDeadline() {
    try {
      const deadline = Number(sessionStorage.getItem(CLOSE_DEADLINE_KEY));
      return Number.isFinite(deadline) && deadline > 0 ? deadline : null;
    } catch (error) {
      return null;
    }
  }

  function writeCloseDeadline(deadline) {
    try {
      if (deadline === null) sessionStorage.removeItem(CLOSE_DEADLINE_KEY);
      else sessionStorage.setItem(CLOSE_DEADLINE_KEY, String(deadline));
    } catch (error) {
      console.warn(LOG_PREFIX, "sessionStorage unavailable", error);
    }
  }

  // ── Settings ──────────────────────────────────────────────────────

  function getScheme(urlTemplate) {
    const match = /^([a-z][a-z0-9+.-]*):/i.exec(String(urlTemplate).trim());
    return match ? match[1].toLowerCase() : "";
  }

  // Returns an error message, or "" when the template is usable.
  function validateUrlTemplate(urlTemplate) {
    const scheme = getScheme(urlTemplate);
    if (!scheme) return "URL scheme must look like myapp://...";
    if (BLOCKED_SCHEMES.includes(scheme)) return `The ${scheme}: scheme is not allowed.`;
    if (!/\{url\}|\{rawUrl\}/.test(urlTemplate)) return "Include {url} where the page URL goes.";
    return "";
  }

  function sanitizeSettings(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const sanitized = { ...DEFAULT_SETTINGS };

    if (typeof source.urlTemplate === "string" && !validateUrlTemplate(source.urlTemplate)) {
      sanitized.urlTemplate = source.urlTemplate.trim();
    }
    if (typeof source.openLabel === "string" && source.openLabel.trim()) {
      sanitized.openLabel = source.openLabel.trim();
    }
    if (source.position === "top" || source.position === "bottom") {
      sanitized.position = source.position;
    }
    if (typeof source.closeTabAfterOpen === "boolean") {
      sanitized.closeTabAfterOpen = source.closeTabAfterOpen;
    }
    for (const { key, min } of NUMBER_SETTINGS) {
      const value = Number(source[key]);
      if (Number.isFinite(value) && value >= min) sanitized[key] = value;
    }
    return sanitized;
  }

  async function loadSettings() {
    return sanitizeSettings(await loadStoredJson(SETTINGS_KEY, {}));
  }

  function buildAppUrl(pageUrl) {
    return settings.urlTemplate
      .replaceAll("{url}", encodeURIComponent(pageUrl))
      .replaceAll("{rawUrl}", pageUrl)
      .replaceAll("{host}", encodeURIComponent(location.hostname));
  }

  function isTapOnlyScheme() {
    return TAP_ONLY_SCHEMES.includes(getScheme(settings.urlTemplate));
  }

  function closeCurrentTab() {
    writeCloseDeadline(null);
    if (typeof GM !== "undefined" && typeof GM.closeTab === "function") {
      GM.closeTab();
      return;
    }
    window.close();
  }

  // ── Bar UI ────────────────────────────────────────────────────────

  // Narrow screens spread the buttons across the full width; wide screens keep
  // them compact and left-aligned.
  function applyButtonLayout(actions) {
    const isNarrow = window.matchMedia(NARROW_SCREEN_QUERY).matches;
    for (const button of actions.children) {
      button.style.flex = isNarrow ? "1 1 0%" : "0 0 auto";
      button.style.padding = isNarrow ? "10px 4px" : "10px 18px";
    }
  }

  const ACTION_STYLE = [
    "display:block",
    "box-sizing:border-box",
    "min-width:0",
    "text-align:center",
    "text-decoration:none",
    "font:600 14px -apple-system, system-ui, sans-serif",
    "white-space:nowrap",
    "color:#fff",
    "border:none",
    "border-radius:999px",
  ];

  function createActionButton(label, background, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = [...ACTION_STYLE, `background:${background}`].join(";");
    button.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    };
    return button;
  }

  // A real link, so the tap itself performs the navigation. Shortcuts needs that,
  // and it is harmless for other schemes.
  function createActionLink(label, background, href, onTap) {
    const link = document.createElement("a");
    link.href = href;
    link.textContent = label;
    link.style.cssText = [...ACTION_STYLE, `background:${background}`].join(";");
    link.addEventListener("click", event => {
      event.stopPropagation();
      onTap();
    });
    return link;
  }

  function createBar(infoText) {
    document.getElementById(BAR_ID)?.remove();

    const bar = document.createElement("div");
    bar.id = BAR_ID;
    const edge =
      settings.position === "bottom"
        ? "bottom:env(safe-area-inset-bottom, 0px)"
        : "top:env(safe-area-inset-top, 0px)";
    bar.style.cssText = [
      "position:fixed",
      edge,
      "left:0",
      "right:0",
      "z-index:2147483647",
      "box-sizing:border-box",
      "display:flex",
      "flex-direction:column",
      "gap:6px",
      "max-height:85vh",
      "overflow:auto",
      "padding:8px 12px",
      "color:#fff",
      "background:rgba(28,28,30,.94)",
      "font:500 12px -apple-system, system-ui, sans-serif",
      `transition:opacity ${FADE_DURATION_MS}ms ease`,
      "opacity:0",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:flex-start;justify-content:space-between;gap:8px";

    const info = document.createElement("div");
    info.style.cssText = "flex:1;white-space:pre-line;word-break:break-word";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;flex-wrap:wrap;justify-content:flex-start;gap:8px";
    window
      .matchMedia(NARROW_SCREEN_QUERY)
      .addEventListener("change", () => applyButtonLayout(actions));

    const ui = { bar, header, info, actions, hideTimeoutId: null };

    const configButton = createActionButton("Config", "#48484a", () => showSettingsPanel(ui));
    configButton.style.cssText += ";flex:none;padding:4px 10px;font-size:12px";

    header.append(info, configButton);
    bar.append(header, actions);
    setInfoText(ui, infoText);
    document.body.appendChild(bar);
    requestAnimationFrame(() => {
      bar.style.opacity = "1";
    });
    return ui;
  }

  function setInfoText(ui, text) {
    ui.info.textContent = text;
    ui.info.style.display = text ? "block" : "none";
  }

  function hideBar(ui) {
    clearTimeout(ui.hideTimeoutId);
    ui.bar.style.opacity = "0";
    setTimeout(() => ui.bar.remove(), FADE_DURATION_MS);
  }

  function addPromptButtons(ui, domain) {
    ui.actions.style.display = "flex";
    ui.actions.replaceChildren(
      createActionLink(settings.openLabel, "#0a84ff", buildAppUrl(location.href), () =>
        handleOpenTap(ui)
      ),
      createActionLink("Always open", "#30d158", buildAppUrl(location.href), () => {
        rememberAlwaysOpen(domain);
        handleOpenTap(ui);
      }),
      createActionButton("Ignore domain", "#636366", () => ignoreDomain(domain, ui))
    );
    applyButtonLayout(ui.actions);
  }

  // ── Settings panel ────────────────────────────────────────────────

  function createField(labelText, inputElement) {
    const label = document.createElement("label");
    label.style.cssText = "display:flex;flex-direction:column;gap:4px;font-size:12px";
    label.append(labelText, inputElement);
    return label;
  }

  function createInput(type, value) {
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    // 16px stops iOS Safari from zooming the page when an input is focused.
    input.style.cssText =
      "box-sizing:border-box;width:100%;padding:8px;font-size:16px;color:#000;background:#fff;border:none;border-radius:8px";
    return input;
  }

  function showSettingsPanel(ui) {
    clearTimeout(ui.hideTimeoutId);
    ui.bar.querySelector("[data-settings-panel]")?.remove();
    ui.actions.style.display = "none";

    const panel = document.createElement("div");
    panel.dataset.settingsPanel = "true";
    panel.style.cssText = "display:flex;flex-direction:column;gap:10px";

    const urlInput = createInput("text", settings.urlTemplate);
    urlInput.autocapitalize = "off";
    urlInput.autocorrect = "off";
    urlInput.spellcheck = false;
    const urlHint = document.createElement("div");
    urlHint.textContent =
      "Placeholders: {url} encoded page URL, {rawUrl} unencoded, {host} hostname. " +
      "Examples: opener://x-callback-url/show-options?url={url} or " +
      "shortcuts://run-shortcut?name=DisplayURL&input=text&text={url}";
    urlHint.style.cssText = "font-size:11px;opacity:.75";

    const labelInput = createInput("text", settings.openLabel);

    const positionSelect = document.createElement("select");
    positionSelect.style.cssText = "padding:8px;font-size:16px;border-radius:8px";
    for (const position of ["top", "bottom"]) {
      positionSelect.add(new Option(position, position, false, position === settings.position));
    }

    const closeCheckbox = document.createElement("input");
    closeCheckbox.type = "checkbox";
    closeCheckbox.checked = settings.closeTabAfterOpen;
    const closeLabel = document.createElement("label");
    closeLabel.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px";
    closeLabel.append(closeCheckbox, "Close this tab after opening");

    const numberInputs = NUMBER_SETTINGS.map(({ key, label, min }) => {
      const input = createInput("number", settings[key]);
      input.min = String(min);
      input.inputMode = "decimal";
      return { key, label, min, input };
    });

    const message = document.createElement("div");
    message.style.cssText = "min-height:14px;font-weight:600";

    function fillFrom(values) {
      urlInput.value = values.urlTemplate;
      labelInput.value = values.openLabel;
      positionSelect.value = values.position;
      closeCheckbox.checked = values.closeTabAfterOpen;
      for (const { key, input } of numberInputs) input.value = values[key];
    }

    async function save() {
      const candidate = {
        urlTemplate: urlInput.value.trim(),
        openLabel: labelInput.value.trim(),
        position: positionSelect.value,
        closeTabAfterOpen: closeCheckbox.checked,
      };
      const templateError = validateUrlTemplate(candidate.urlTemplate);
      if (templateError) return showMessage(templateError);
      if (!candidate.openLabel) return showMessage("Button label cannot be empty.");
      for (const { key, label, min, input } of numberInputs) {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < min)
          return showMessage(`${label}: minimum is ${min}.`);
        candidate[key] = value;
      }
      settings = sanitizeSettings(candidate);
      await saveStoredJson(SETTINGS_KEY, settings);
      showMessage("Saved. Position applies on the next page load.", false);
      setTimeout(() => hideBar(ui), 1200);
    }

    function showMessage(text, isError = true) {
      message.textContent = text;
      message.style.color = isError ? "#ff6961" : "#30d158";
    }

    const buttonRow = document.createElement("div");
    buttonRow.style.cssText = "display:flex;flex-wrap:wrap;gap:8px";
    buttonRow.append(
      createActionButton("Save", "#0a84ff", save),
      createActionButton("Reset defaults", "#636366", () => fillFrom(DEFAULT_SETTINGS)),
      createActionButton("Close", "#48484a", () => hideBar(ui))
    );
    applyButtonLayout(buttonRow);

    panel.append(
      createField("URL scheme template", urlInput),
      urlHint,
      createField("Open button label", labelInput),
      createField("Bar position", positionSelect),
      closeLabel,
      ...numberInputs.map(({ label, input }) => createField(label, input)),
      message,
      buttonRow
    );
    ui.bar.appendChild(panel);
  }

  // ── Open and close flow ───────────────────────────────────────────

  // The tab is usually backgrounded while the system prompt and the app are up,
  // which suspends timers. Checking the clock on every tick and on resume closes
  // the tab as soon as JavaScript runs again after the deadline. With
  // requireHandoff, a tab that never went to the background is left open because
  // the automatic launch was probably blocked.
  function startCloseCountdown(deadline, ui, { requireHandoff = false, onNoHandoff } = {}) {
    clearTimeout(ui.hideTimeoutId);
    ui.actions.style.display = "flex";
    ui.actions.replaceChildren();
    let isCancelled = false;
    let wasHidden = document.hidden;
    let intervalId = null;

    function stop() {
      isCancelled = true;
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", checkDeadline);
      window.removeEventListener("pageshow", checkDeadline);
    }

    const cancelButton = createActionButton("Cancel close", "#ff453a", () => {
      stop();
      writeCloseDeadline(null);
      markStayInTab(location.hostname.toLowerCase());
      hideBar(ui);
    });
    ui.actions.appendChild(cancelButton);
    applyButtonLayout(ui.actions);

    function checkDeadline() {
      if (isCancelled) return;
      if (document.hidden) wasHidden = true;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        stop();
        if (requireHandoff && !wasHidden) {
          writeCloseDeadline(null);
          onNoHandoff?.();
          return;
        }
        closeCurrentTab();
        return;
      }
      cancelButton.textContent = `Cancel close (${Math.ceil(remainingMs / 1000)}s)`;
    }

    document.addEventListener("visibilitychange", checkDeadline);
    window.addEventListener("pageshow", checkDeadline);
    intervalId = setInterval(checkDeadline, 1000);
    checkDeadline();
  }

  function beginCloseCountdown(ui, countdownOptions) {
    if (!settings.closeTabAfterOpen) {
      setInfoText(ui, "Opened.");
      ui.actions.replaceChildren();
      ui.hideTimeoutId = setTimeout(() => hideBar(ui), 2000);
      return;
    }
    const deadline = Date.now() + settings.closeDelaySec * 1000;
    writeCloseDeadline(deadline);
    startCloseCountdown(deadline, ui, countdownOptions);
  }

  // The link's own default action performs the navigation; the UI swap is
  // deferred so it cannot interfere with that.
  function handleOpenTap(ui) {
    setTimeout(() => beginCloseCountdown(ui), 0);
  }

  function launchAutomatically(ui, countdownOptions) {
    window.location.href = buildAppUrl(location.href);
    beginCloseCountdown(ui, countdownOptions);
  }

  async function rememberAlwaysOpen(domain) {
    const ignored = await loadDomainList(IGNORED_DOMAINS_KEY);
    const alwaysOpen = await loadDomainList(ALWAYS_OPEN_DOMAINS_KEY);
    alwaysOpen.add(domain);
    ignored.delete(domain);
    await saveDomainList(ALWAYS_OPEN_DOMAINS_KEY, alwaysOpen);
    await saveDomainList(IGNORED_DOMAINS_KEY, ignored);
  }

  async function ignoreDomain(domain, ui) {
    const ignored = await loadDomainList(IGNORED_DOMAINS_KEY);
    const alwaysOpen = await loadDomainList(ALWAYS_OPEN_DOMAINS_KEY);
    ignored.add(domain);
    alwaysOpen.delete(domain);
    await saveDomainList(IGNORED_DOMAINS_KEY, ignored);
    await saveDomainList(ALWAYS_OPEN_DOMAINS_KEY, alwaysOpen);
    hideBar(ui);
  }

  // ── Page flow ─────────────────────────────────────────────────────

  function buildDebugText(context) {
    return [
      context.domain,
      `scheme: ${getScheme(settings.urlTemplate)}${isTapOnlyScheme() ? " (tap only)" : ""}`,
      `first in tab: ${context.isFirstSeenInTab ? "yes" : "no"}`,
      `same-URL loads: ${context.repeatCount}/${settings.refreshThreshold}`,
      `always open: ${context.isAlwaysOpen ? "yes" : "no"}`,
      `snoozed: ${context.isSnoozed ? "yes" : "no"}`,
      `tab state: ${context.isTabStateAvailable ? "ok" : "unavailable"}`,
    ].join(" | ");
  }

  function showPromptBar(context) {
    const { domain, isRefreshPrompt } = context;
    const lines = [];
    if (isRefreshPrompt) {
      lines.push(
        `Same page loaded ${settings.refreshThreshold} times. ${settings.openLabel} or ignore ${domain}?`
      );
    } else if (context.isAlwaysOpen && isTapOnlyScheme()) {
      lines.push("Always open: this app needs a tap to launch.");
    }
    if (SHOW_DEBUG) lines.push(buildDebugText(context));

    const ui = createBar(lines.join("\n"));
    addPromptButtons(ui, domain);
    const durationSec = isRefreshPrompt ? settings.refreshBarDurationSec : settings.barDurationSec;
    ui.hideTimeoutId = setTimeout(() => {
      hideBar(ui);
      // Only the first-visit bar snoozes; the refresh prompt is a deliberate ask.
      if (!isRefreshPrompt && !context.isAlwaysOpen && !context.isDebugForced) {
        snoozeDomain(domain);
      }
    }, durationSec * 1000);
  }

  function autoOpenAlwaysOpenDomain(context) {
    const { domain } = context;
    const lines = [`Always open: sending ${domain} to the app`];
    if (SHOW_DEBUG) lines.push(buildDebugText(context));

    const ui = createBar(lines.join("\n"));
    launchAutomatically(ui, {
      requireHandoff: true,
      onNoHandoff: () => {
        setInfoText(ui, `Auto-open did not leave this page. Tap ${settings.openLabel}.`);
        addPromptButtons(ui, domain);
      },
    });
  }

  async function main() {
    console.log(LOG_PREFIX, "running on", location.hostname);
    settings = await loadSettings();

    if (location.hash.includes(CONFIG_HASH)) {
      showSettingsPanel(createBar("App Handoff settings"));
      return;
    }

    const pendingDeadline = readCloseDeadline();
    if (pendingDeadline !== null) {
      startCloseCountdown(pendingDeadline, createBar(SHOW_DEBUG ? "Resuming close countdown" : ""));
      return;
    }

    const domain = location.hostname.toLowerCase();
    if (!domain) return;

    const ignoredDomains = await loadDomainList(IGNORED_DOMAINS_KEY);
    if (ignoredDomains.has(domain)) {
      console.log(LOG_PREFIX, "domain ignored", domain);
      return;
    }

    const alwaysOpenDomains = await loadDomainList(ALWAYS_OPEN_DOMAINS_KEY);
    const snoozedDomains = await loadSnoozedDomains();
    const { tab, isAvailable: isTabStateAvailable } = await loadTabState();

    const seenDomains = new Set(Array.isArray(tab.seenDomains) ? tab.seenDomains : []);
    const stayDomains = new Set(Array.isArray(tab.stayDomains) ? tab.stayDomains : []);
    const isFirstSeenInTab = !seenDomains.has(domain);
    const repeatCount = tab.lastUrl === location.href ? (tab.repeatCount || 0) + 1 : 1;
    const isRefreshPrompt = repeatCount >= settings.refreshThreshold;

    seenDomains.add(domain);
    await saveTabState({
      ...tab,
      seenDomains: [...seenDomains],
      lastUrl: location.href,
      repeatCount: isRefreshPrompt ? 0 : repeatCount,
    });

    // Visit any page with #app-handoff-debug to force the bar for testing.
    const isDebugForced = location.hash.includes(DEBUG_HASH);
    const isAlwaysOpen = alwaysOpenDomains.has(domain);
    const context = {
      domain,
      isFirstSeenInTab,
      repeatCount,
      isRefreshPrompt,
      isDebugForced,
      isAlwaysOpen,
      isSnoozed: domain in snoozedDomains,
      isTabStateAvailable,
    };

    const canLaunchAutomatically = !isTapOnlyScheme();
    if (
      isAlwaysOpen &&
      canLaunchAutomatically &&
      !stayDomains.has(domain) &&
      !isRefreshPrompt &&
      !isDebugForced
    ) {
      autoOpenAlwaysOpenDomain(context);
      return;
    }

    // The snooze only mutes the first-visit bar, never the refresh prompt.
    const shouldPrompt =
      isRefreshPrompt ||
      isDebugForced ||
      (isFirstSeenInTab && (isAlwaysOpen || !context.isSnoozed));
    if (!shouldPrompt) {
      console.log(LOG_PREFIX, "nothing to show", { domain, repeatCount });
      return;
    }

    showPromptBar(context);
  }

  main().catch(error => console.error(LOG_PREFIX, "failed", error));
})();
