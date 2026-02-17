const ids = {
  connectionPill: "connection-pill",
  obsPhase: "obs-phase",
  obsAttempt: "obs-attempt",
  obsNextRetry: "obs-next-retry",
  obsLastError: "obs-last-error",
  programScene: "program-scene",
  streamActive: "stream-active",
  streamTimecode: "stream-timecode",
  recordActive: "record-active",
  recordPaused: "record-paused",
  recordTimecode: "record-timecode",
  cpuUsage: "cpu-usage",
  memoryUsage: "memory-usage",
  activeFps: "active-fps",
  avgFrameTime: "avg-frame-time",
  renderFrames: "render-frames",
  outputFrames: "output-frames",
  healthService: "health-service",
  healthStatus: "health-status",
  healthUptime: "health-uptime",
  healthNow: "health-now",
  wsState: "ws-state",
  lastUpdated: "last-updated",
  logline: "logline",
  safetyKillSwitch: "safety-kill-switch",
  safetyFallbackScene: "safety-fallback-scene",
  safetyBudget: "safety-budget",
  safetyLastBlock: "safety-last-block",
  autoEnabled: "auto-enabled",
  autoActiveRule: "auto-active-rule",
  autoPendingRule: "auto-pending-rule",
  autoLastDecision: "auto-last-decision",
  autoSwitchCooldown: "auto-switch-cooldown",
  autoTopLevels: "auto-top-levels",
  chaosTotalPresets: "chaos-total-presets",
  chaosRunningPreset: "chaos-running-preset",
  chaosLastRun: "chaos-last-run",
  chaosLastError: "chaos-last-error",
  chaosPresetList: "chaos-preset-list",
  replayBufferActive: "replay-buffer-active",
  replayLastCapture: "replay-last-capture",
  replayLastLabel: "replay-last-label",
  replayLastPath: "replay-last-path",
  replayPlayback: "replay-playback",
  replayOverlay: "replay-overlay",
  replayChapter: "replay-chapter",
  replayError: "replay-error",
  replayLabel: "replay-label",
  pluginDefaultPolicy: "plugin-default-policy",
  pluginVendorCount: "plugin-vendor-count",
  pluginLastCallVendor: "plugin-last-call-vendor",
  pluginLastCallTime: "plugin-last-call-time",
  pluginRecentEventCount: "plugin-recent-event-count",
  pluginLastError: "plugin-last-error",
  pluginVendorList: "plugin-vendor-list",
  pluginVendor: "plugin-vendor",
  pluginRequest: "plugin-request",
  pluginRole: "plugin-role",
  pluginData: "plugin-data",
  overlayEnabled: "overlay-enabled",
  overlayReachable: "overlay-reachable",
  overlayBaseUrl: "overlay-base-url",
  overlayLastChecked: "overlay-last-checked",
  overlayLastError: "overlay-last-error",
  overlayAlertType: "overlay-alert-type",
  overlayAlertUser: "overlay-alert-user",
  overlayChatMessage: "overlay-chat-message",
  overlaySceneName: "overlay-scene-name",
  overlaySubtitleFont: "overlay-subtitle-font",
  overlaySubtitleSize: "overlay-subtitle-size",
  overlaySubtitleLang: "overlay-subtitle-lang",
  overlaySubtitleTextColor: "overlay-subtitle-text-color",
  overlaySubtitleBgColor: "overlay-subtitle-bg-color",
  overlaySubtitleBgOpacity: "overlay-subtitle-bg-opacity",
  overlayLinksList: "overlay-links-list",
  overlayEmbed: "overlay-embed",
  overlayFrameWrap: "overlay-frame-wrap",
  overlayFrame: "overlay-frame",
  overlayTitle: "overlay-title",
  overlayUrl: "overlay-url",
  overlayOpenExternal: "overlay-open-external",
  onboardingObsConnected: "onboarding-obs-connected",
  onboardingHasScan: "onboarding-has-scan",
  onboardingHasGenerated: "onboarding-has-generated",
  onboardingHasVerified: "onboarding-has-verified",
  onboardingSceneCount: "onboarding-scene-count",
  onboardingInputCount: "onboarding-input-count",
  onboardingProgramScene: "onboarding-program-scene",
  onboardingGeneratedFiles: "onboarding-generated-files",
  onboardingVerification: "onboarding-verification",
  onboardingLastError: "onboarding-last-error",
  onboardingChecklist: "onboarding-checklist",
  onboardingStreamType: "onboarding-stream-type",
  onboardingPrimaryMic: "onboarding-primary-mic",
  onboardingGameplayScene: "onboarding-gameplay-scene",
  onboardingCameraScene: "onboarding-camera-scene",
  onboardingOverlayStyle: "onboarding-overlay-style",
  assistantSuggestions: "assistant-suggestions",
  assistantPrompt: "assistant-prompt",
  assistantPlanSummary: "assistant-plan-summary",
  assistantPlanRisk: "assistant-plan-risk",
  assistantPlanStatus: "assistant-plan-status",
  assistantResponse: "assistant-response",
  assistantPlanSteps: "assistant-plan-steps",
  qaCollapseAll: "qa-collapse-all",
  qaExpandAll: "qa-expand-all",
  toastStack: "toast-stack"
};

const el = Object.fromEntries(
  Object.entries(ids).map(([key, id]) => [key, document.getElementById(id)])
);

const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

const state = {
  chaosPresets: [],
  safetyKillSwitch: false,
  autoEnabled: false,
  overlayBaseUrl: "http://127.0.0.1:5555",
  overlayLinks: buildOverlayLinks("http://127.0.0.1:5555"),
  overlayActiveUrl: "",
  overlayActiveTitle: "Overlay Dashboard",
  overlaySttActive: false,
  assistantPlan: null,
  assistantSuggestions: []
};

let socket = null;
let reconnectTimer = null;
let wsAttempt = 0;
const panelControllers = new Map();
const PANEL_COLLAPSE_STORAGE_KEY = "february11.panel-collapse.v1";
const panelCollapseState = readPanelCollapseState();
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
const sttRuntime = {
  supported: typeof SpeechRecognitionCtor === "function",
  wanted: false,
  active: false,
  recognition: null,
  lastInterimText: "",
  lastInterimAt: 0
};

function text(node, value) {
  if (!node) {
    return;
  }
  node.textContent = value;
}

function writeLog(value) {
  text(el.logline, value);
}

function toast(message, level = "ok") {
  if (!el.toastStack) {
    return;
  }

  const node = document.createElement("div");
  node.className = `toast ${level}`;
  node.textContent = message;
  el.toastStack.prepend(node);

  setTimeout(() => {
    node.remove();
  }, 3600);
}

function readPanelCollapseState() {
  try {
    const raw = localStorage.getItem(PANEL_COLLAPSE_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function persistPanelCollapseState() {
  try {
    localStorage.setItem(PANEL_COLLAPSE_STORAGE_KEY, JSON.stringify(panelCollapseState));
  } catch {
    // Ignore local storage write failures.
  }
}

function panelKeyFromHeading(heading, index) {
  const base = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "panel"}-${index}`;
}

function setupPanelCollapseControls() {
  const panels = Array.from(document.querySelectorAll(".grid > .panel"));
  panels.forEach((panel, index) => {
    const first = panel.firstElementChild;
    if (!(first instanceof HTMLHeadingElement) || first.tagName !== "H2") {
      return;
    }

    const headingText = (first.textContent ?? "").trim() || "Panel";
    const panelKey = panelKeyFromHeading(headingText, index);
    panel.dataset.panelKey = panelKey;
    const head = document.createElement("div");
    head.className = "panel-head";

    panel.insertBefore(head, first);
    head.appendChild(first);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "panel-collapse-toggle";
    head.appendChild(toggle);

    const apply = (collapsed, persist = true) => {
      panel.classList.toggle("collapsed", collapsed);
      toggle.textContent = collapsed ? "Expand" : "Collapse";
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${headingText}`);
      panelCollapseState[panelKey] = collapsed;
      if (persist) {
        persistPanelCollapseState();
      }
    };

    toggle.addEventListener("click", () => {
      apply(!panel.classList.contains("collapsed"));
    });

    panelControllers.set(panelKey, apply);
    apply(Boolean(panelCollapseState[panelKey]), false);
  });
}

function setAllPanelsCollapsed(collapsed) {
  for (const apply of panelControllers.values()) {
    apply(collapsed, false);
  }
  persistPanelCollapseState();
}

function expandPanelForElement(node) {
  if (!(node instanceof Element)) {
    return;
  }

  const panel = node.closest(".panel");
  if (!(panel instanceof HTMLElement)) {
    return;
  }

  const panelKey = panel.dataset.panelKey;
  if (!panelKey) {
    return;
  }

  const apply = panelControllers.get(panelKey);
  if (typeof apply === "function") {
    apply(false);
  }
}

function overlayDesignSize(url) {
  const target = typeof url === "string" ? url : "";
  if (target.includes("/overlay/scene")) {
    return { width: 1920, height: 1080 };
  }
  if (target.includes("/overlay/stats")) {
    return { width: 980, height: 140 };
  }
  if (target.includes("/overlay/chat")) {
    return { width: 500, height: 760 };
  }
  if (target.includes("/overlay/alerts")) {
    return { width: 980, height: 760 };
  }
  if (target.includes("/overlay/keyboard")) {
    return { width: 1280, height: 420 };
  }
  if (target.includes("/overlay/subtitles")) {
    return { width: 1920, height: 1080 };
  }
  return { width: 1180, height: 1040 };
}

function applyOverlayFrameFit(contentWidth, contentHeight) {
  if (!(el.overlayFrame instanceof HTMLIFrameElement) || !(el.overlayFrameWrap instanceof HTMLElement)) {
    return;
  }

  const bounds = el.overlayFrameWrap.getBoundingClientRect();
  if (bounds.width <= 0 || bounds.height <= 0) {
    return;
  }

  const width = Math.max(1, Number(contentWidth) || 1);
  const height = Math.max(1, Number(contentHeight) || 1);
  const scale = Math.min(1, bounds.width / width, bounds.height / height);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  el.overlayFrame.style.transformOrigin = "top left";
  el.overlayFrame.style.transform = `scale(${safeScale})`;
  el.overlayFrame.style.width = `${(100 / safeScale).toFixed(4)}%`;
  el.overlayFrame.style.height = `${(100 / safeScale).toFixed(4)}%`;
}

function fitOverlayFrameForCurrentTarget() {
  const size = overlayDesignSize(state.overlayActiveUrl);
  applyOverlayFrameFit(size.width, size.height);
}

function parseUrlOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function normalizeLoopbackHost(host) {
  if (host === "localhost") {
    return "127.0.0.1";
  }
  if (host === "::1") {
    return "127.0.0.1";
  }
  return host;
}

function isOverlayMessageOrigin(origin) {
  if (typeof origin !== "string" || origin.length === 0) {
    return false;
  }

  const known = [parseUrlOrigin(state.overlayBaseUrl), parseUrlOrigin(state.overlayActiveUrl)].filter(Boolean);
  if (known.length === 0) {
    return true;
  }

  try {
    const incoming = new URL(origin);
    return known.some((candidate) => {
      try {
        const expected = new URL(candidate);
        return (
          expected.protocol === incoming.protocol &&
          expected.port === incoming.port &&
          normalizeLoopbackHost(expected.hostname) === normalizeLoopbackHost(incoming.hostname)
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function formatMaybe(value, suffix = "") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }
  return `${Number(value).toFixed(2)}${suffix}`;
}

function formatFrames(total, skipped) {
  if (total === null || skipped === null) {
    return "-";
  }
  return `${total} / skipped ${skipped}`;
}

function phaseTone(phase) {
  if (phase === "connected") {
    return "ok";
  }
  if (phase === "reconnecting" || phase === "connecting") {
    return "warn";
  }
  return "error";
}

function renderPhase(phase) {
  text(el.connectionPill, `PHASE: ${phase}`);
  text(el.obsPhase, phase);

  if (!el.connectionPill) {
    return;
  }

  el.connectionPill.classList.remove("ok", "warn", "error");
  el.connectionPill.classList.add(phaseTone(phase));
}

function renderSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  renderPhase(snapshot.connection.phase);
  text(el.obsAttempt, String(snapshot.connection.reconnectAttempt ?? 0));
  text(
    el.obsNextRetry,
    snapshot.connection.nextRetryInMs === null ? "-" : `${snapshot.connection.nextRetryInMs} ms`
  );
  text(el.obsLastError, snapshot.connection.lastError ?? "-");

  text(el.programScene, snapshot.programSceneName ?? "-");
  text(el.streamActive, String(Boolean(snapshot.streamActive)));
  text(el.streamTimecode, snapshot.streamTimecode ?? "-");
  text(el.recordActive, String(Boolean(snapshot.recordActive)));
  text(el.recordPaused, String(Boolean(snapshot.recordPaused)));
  text(el.recordTimecode, snapshot.recordTimecode ?? "-");

  text(el.cpuUsage, formatMaybe(snapshot.stats.cpuUsage, "%"));
  text(el.memoryUsage, formatMaybe(snapshot.stats.memoryUsage, " MB"));
  text(el.activeFps, formatMaybe(snapshot.stats.activeFps));
  text(el.avgFrameTime, formatMaybe(snapshot.stats.averageFrameTime, " ms"));
  text(el.renderFrames, formatFrames(snapshot.stats.renderTotalFrames, snapshot.stats.renderSkippedFrames));
  text(el.outputFrames, formatFrames(snapshot.stats.outputTotalFrames, snapshot.stats.outputSkippedFrames));
  text(el.lastUpdated, snapshot.updatedAt ?? "-");
}

function renderHealth(health) {
  if (!health) {
    return;
  }

  text(el.healthService, health.service ?? "FEBRUARY11");
  text(el.healthStatus, health.status ?? "-");
  text(el.healthUptime, String(health.uptimeSeconds ?? "-"));
  text(el.healthNow, health.now ?? "-");
}

function renderSafety(status) {
  if (!status) {
    return;
  }

  state.safetyKillSwitch = status.killSwitch === true;
  text(el.safetyKillSwitch, String(Boolean(status.killSwitch)));
  text(el.safetyFallbackScene, status.fallbackScene ?? "-");
  text(el.safetyBudget, `${status.remainingInWindow ?? 0}/${status.maxActionsPerWindow ?? 0} remaining`);
  text(el.safetyLastBlock, status.lastBlockedReason ?? "-");
}

function renderAutoDirector(status) {
  if (!status) {
    return;
  }

  state.autoEnabled = status.enabled === true;
  text(el.autoEnabled, String(Boolean(status.enabled)));
  text(el.autoActiveRule, status.activeRuleId ?? "-");
  text(el.autoPendingRule, status.pendingRuleId ?? "-");
  text(el.autoLastDecision, status.lastDecision ?? "-");
  text(el.autoSwitchCooldown, `${status.switchCooldownMs ?? "-"} ms`);
  const topLevels = Array.isArray(status.topInputLevels)
    ? status.topInputLevels
        .slice(0, 4)
        .map((entry) => {
          const name = typeof entry.inputName === "string" ? entry.inputName : "unknown";
          const level =
            typeof entry.levelDb === "number" && Number.isFinite(entry.levelDb)
              ? `${entry.levelDb.toFixed(1)} dB`
              : "-inf";
          return `${name}: ${level}`;
        })
        .join(" | ")
    : "";
  text(el.autoTopLevels, topLevels || "-");
}

function renderReplayDirector(status) {
  if (!status) {
    return;
  }

  text(el.replayBufferActive, String(Boolean(status.replayBufferActive)));
  text(el.replayLastCapture, status.lastCaptureAt ?? "-");
  text(el.replayLastLabel, status.lastLabel ?? "-");
  text(el.replayLastPath, status.lastReplayPath ?? "-");
  text(el.replayPlayback, String(Boolean(status.playbackTriggered)));
  text(el.replayOverlay, String(Boolean(status.overlayVisible)));
  text(el.replayChapter, String(Boolean(status.chapterCreated)));
  text(el.replayError, status.lastError ?? "-");
}

function renderChaosStatus(status) {
  if (!status) {
    return;
  }

  text(el.chaosTotalPresets, String(status.totalPresets ?? 0));
  text(el.chaosRunningPreset, status.runningPresetId ?? "-");
  text(el.chaosLastRun, status.lastRunAt ?? "-");
  text(el.chaosLastError, status.lastError ?? "-");
}

function renderChaosPresets(presets) {
  if (!Array.isArray(presets)) {
    return;
  }

  state.chaosPresets = presets;
  text(el.chaosTotalPresets, String(presets.length));

  if (!el.chaosPresetList) {
    return;
  }

  el.chaosPresetList.innerHTML = "";

  if (presets.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chaos-item";
    empty.textContent = "No presets loaded.";
    el.chaosPresetList.appendChild(empty);
    return;
  }

  for (const preset of presets) {
    const row = document.createElement("div");
    row.className = "chaos-item";

    const meta = document.createElement("div");
    meta.className = "chaos-meta";

    const title = document.createElement("p");
    title.className = "chaos-title";
    title.textContent = preset.name || preset.id || "Unnamed Preset";
    meta.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "chaos-subtitle";
    subtitle.textContent = `${preset.id} | cooldown ${preset.cooldownMs} ms`;
    meta.appendChild(subtitle);

    const actions = document.createElement("div");
    actions.className = "chaos-actions";

    const runButton = document.createElement("button");
    runButton.type = "button";
    runButton.textContent = "Run";
    runButton.addEventListener("click", () => {
      void runChaosPreset(preset.id);
    });
    actions.appendChild(runButton);

    row.appendChild(meta);
    row.appendChild(actions);
    el.chaosPresetList.appendChild(row);
  }
}

function renderPluginBridge(status) {
  if (!status) {
    return;
  }

  text(el.pluginDefaultPolicy, status.defaultPolicy ?? "deny");
  text(el.pluginVendorCount, String(status.vendorCount ?? 0));
  text(el.pluginLastCallVendor, status.lastCallVendor ?? "-");
  text(el.pluginLastCallTime, status.lastCallAt ?? "-");
  text(
    el.pluginRecentEventCount,
    String(Array.isArray(status.recentVendorEvents) ? status.recentVendorEvents.length : 0)
  );
  text(el.pluginLastError, status.lastError ?? "-");
  renderPluginVendors(status.vendors);
}

function renderPluginVendors(vendors) {
  if (!el.pluginVendorList) {
    return;
  }

  const safeVendors = Array.isArray(vendors) ? vendors : [];
  el.pluginVendorList.innerHTML = "";

  if (safeVendors.length === 0) {
    const empty = document.createElement("div");
    empty.className = "plugin-item";
    empty.textContent = "No plugin permissions loaded.";
    el.pluginVendorList.appendChild(empty);
    return;
  }

  for (const vendor of safeVendors) {
    const row = document.createElement("div");
    row.className = "plugin-item";

    const meta = document.createElement("div");
    meta.className = "plugin-meta";

    const title = document.createElement("p");
    title.className = "plugin-title";
    title.textContent = `${vendor.vendorName} (${vendor.enabled ? "enabled" : "disabled"})`;
    meta.appendChild(title);

    const subtitle = document.createElement("p");
    const requestList =
      Array.isArray(vendor.allowedRequests) && vendor.allowedRequests.length > 0
        ? vendor.allowedRequests.join(", ")
        : "(none)";
    subtitle.className = "plugin-subtitle";
    subtitle.textContent = `requests: ${requestList}`;
    meta.appendChild(subtitle);

    row.appendChild(meta);
    el.pluginVendorList.appendChild(row);
  }
}

function buildOverlayLinks(baseUrl) {
  const safeBase = (baseUrl ?? "").replace(/\/+$/g, "");
  return {
    dashboard: `${safeBase}/dashboard`,
    scene: `${safeBase}/overlay/scene`,
    alerts: `${safeBase}/overlay/alerts`,
    chat: `${safeBase}/overlay/chat`,
    stats: `${safeBase}/overlay/stats`,
    keyboard: `${safeBase}/overlay/keyboard`,
    subtitles: `${safeBase}/overlay/subtitles`
  };
}

function ensureOverlayLinks(payload, fallbackBaseUrl) {
  const fallback = buildOverlayLinks(fallbackBaseUrl);
  const linksCandidate = payload?.links;
  if (linksCandidate && typeof linksCandidate === "object") {
    const links = linksCandidate;
    return {
      dashboard: typeof links.dashboard === "string" && links.dashboard.trim() ? links.dashboard.trim() : fallback.dashboard,
      scene: typeof links.scene === "string" && links.scene.trim() ? links.scene.trim() : fallback.scene,
      alerts: typeof links.alerts === "string" && links.alerts.trim() ? links.alerts.trim() : fallback.alerts,
      chat: typeof links.chat === "string" && links.chat.trim() ? links.chat.trim() : fallback.chat,
      stats: typeof links.stats === "string" && links.stats.trim() ? links.stats.trim() : fallback.stats,
      keyboard:
        typeof links.keyboard === "string" && links.keyboard.trim() ? links.keyboard.trim() : fallback.keyboard,
      subtitles:
        typeof links.subtitles === "string" && links.subtitles.trim()
          ? links.subtitles.trim()
          : fallback.subtitles
    };
  }
  return fallback;
}

async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

function renderOverlayLinks(links) {
  if (!el.overlayLinksList) {
    return;
  }

  const items = [
    ["Dashboard", links.dashboard],
    ["Unified Scene", links.scene],
    ["Alerts", links.alerts],
    ["Chat", links.chat],
    ["Stats", links.stats],
    ["Keyboard", links.keyboard],
    ["Subtitles", links.subtitles]
  ];

  el.overlayLinksList.innerHTML = "";

  for (const [label, url] of items) {
    const row = document.createElement("div");
    row.className = "plugin-item";

    const meta = document.createElement("div");
    meta.className = "plugin-meta";

    const title = document.createElement("p");
    title.className = "plugin-title";
    title.textContent = label;
    meta.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "plugin-subtitle";
    subtitle.textContent = url;
    meta.appendChild(subtitle);

    const actions = document.createElement("div");
    actions.className = "chaos-actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", () => {
      void copyText(url).then((ok) => {
        toast(ok ? "Copied URL" : "Copy failed", ok ? "ok" : "error");
      });
    });
    actions.appendChild(copyButton);

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.textContent = "Load";
    openButton.addEventListener("click", () => {
      setOverlayEmbedTarget(url, label, true);
    });
    actions.appendChild(openButton);

    row.appendChild(meta);
    row.appendChild(actions);
    el.overlayLinksList.appendChild(row);
  }
}

function setOverlayEmbedTarget(url, title = "Overlay", scrollIntoView = false) {
  if (!url) {
    return;
  }

  state.overlayActiveUrl = url;
  state.overlayActiveTitle = title;

  if (el.overlayFrame instanceof HTMLIFrameElement) {
    el.overlayFrame.setAttribute("scrolling", "no");
    if (el.overlayFrame.src !== url) {
      el.overlayFrame.src = url;
    } else {
      fitOverlayFrameForCurrentTarget();
    }
  }

  text(el.overlayTitle, title);
  text(el.overlayUrl, url);
  fitOverlayFrameForCurrentTarget();
  if (scrollIntoView) {
    expandPanelForElement(el.overlayEmbed);
    el.overlayEmbed?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderOverlayBridge(payload) {
  const status = payload?.status && typeof payload.status === "object" ? payload.status : payload;
  if (!status || typeof status !== "object") {
    return;
  }

  const enabled = status.enabled === true;
  const reachable = status.reachable === true;
  const baseUrl =
    typeof status.baseUrl === "string" && status.baseUrl.trim().length > 0
      ? status.baseUrl.trim()
      : "http://127.0.0.1:5555";
  const links = ensureOverlayLinks(payload, baseUrl);

  state.overlayBaseUrl = baseUrl;
  state.overlayLinks = links;

  text(el.overlayEnabled, String(enabled));
  text(el.overlayReachable, String(reachable));
  text(el.overlayBaseUrl, baseUrl);
  text(el.overlayLastChecked, typeof status.lastCheckedAt === "string" ? status.lastCheckedAt : "-");
  text(el.overlayLastError, typeof status.lastError === "string" && status.lastError ? status.lastError : "-");

  renderOverlayLinks(links);
  const knownTargets = Object.values(links);
  if (!state.overlayActiveUrl || !knownTargets.includes(state.overlayActiveUrl)) {
    setOverlayEmbedTarget(links.dashboard, "Overlay Dashboard", false);
  }
}

function renderAssistantSuggestions(payload) {
  if (!el.assistantSuggestions) {
    return;
  }

  const rawSuggestions =
    Array.isArray(payload?.suggestions) ? payload.suggestions : Array.isArray(payload) ? payload : [];
  const suggestions = rawSuggestions
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);

  state.assistantSuggestions = suggestions;
  el.assistantSuggestions.innerHTML = "";

  if (suggestions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "assistant-step-subtitle";
    empty.textContent = "No suggestions yet.";
    el.assistantSuggestions.appendChild(empty);
    return;
  }

  for (const suggestion of suggestions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = suggestion;
    button.addEventListener("click", () => {
      if (el.assistantPrompt instanceof HTMLTextAreaElement) {
        el.assistantPrompt.value = suggestion;
        el.assistantPrompt.focus();
      }
    });
    el.assistantSuggestions.appendChild(button);
  }

  const plannerMode = typeof payload?.planner?.mode === "string" ? payload.planner.mode : "";
  const plannerModel = typeof payload?.planner?.model === "string" ? payload.planner.model : "";
  const currentResponse = (el.assistantResponse?.textContent ?? "").trim();
  if (!currentResponse || currentResponse === "-") {
    if (plannerMode === "openai") {
      text(el.assistantResponse, plannerModel ? `Planner: OpenAI (${plannerModel})` : "Planner: OpenAI");
    } else if (plannerMode === "rules") {
      text(el.assistantResponse, "Planner: Rules (local)");
    }
  }
}

function renderAssistantPlan(plan) {
  const safePlan = plan && typeof plan === "object" ? plan : null;
  state.assistantPlan = safePlan;

  text(el.assistantPlanSummary, safePlan?.summary ?? "-");
  text(el.assistantPlanRisk, safePlan?.risk ?? "-");
  text(el.assistantPlanStatus, safePlan?.status ?? "-");

  if (!el.assistantPlanSteps) {
    return;
  }

  el.assistantPlanSteps.innerHTML = "";
  const steps = Array.isArray(safePlan?.steps) ? safePlan.steps : [];
  if (steps.length === 0) {
    const empty = document.createElement("div");
    empty.className = "assistant-step";
    const title = document.createElement("p");
    title.textContent = "No steps planned.";
    empty.appendChild(title);
    el.assistantPlanSteps.appendChild(empty);
    return;
  }

  for (const step of steps) {
    const row = document.createElement("div");
    row.className = "assistant-step";

    const title = document.createElement("p");
    const name = typeof step.title === "string" ? step.title : step.toolId || "Step";
    const risk = typeof step.risk === "string" ? step.risk : "low";
    title.textContent = `${step.id ?? "step"} | ${name} | risk ${risk}`;
    row.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "assistant-step-subtitle";
    subtitle.textContent = typeof step.description === "string" ? step.description : "";
    row.appendChild(subtitle);

    el.assistantPlanSteps.appendChild(row);
  }
}

function renderOnboardingChecklist(items) {
  if (!el.onboardingChecklist) {
    return;
  }

  const safeItems = Array.isArray(items) ? items : [];
  el.onboardingChecklist.innerHTML = "";

  if (safeItems.length === 0) {
    const empty = document.createElement("div");
    empty.className = "plugin-item";
    empty.textContent = "Run Verify Setup to fill checklist.";
    el.onboardingChecklist.appendChild(empty);
    return;
  }

  for (const item of safeItems) {
    const row = document.createElement("div");
    row.className = "plugin-item";

    const meta = document.createElement("div");
    meta.className = "plugin-meta";

    const title = document.createElement("p");
    title.className = "plugin-title";
    const label = typeof item?.label === "string" ? item.label : "Checklist Item";
    const ok = item?.ok === true;
    title.textContent = `${label} (${ok ? "pass" : "check"})`;
    meta.appendChild(title);

    const subtitle = document.createElement("p");
    subtitle.className = "plugin-subtitle";
    subtitle.textContent = typeof item?.details === "string" ? item.details : "-";
    meta.appendChild(subtitle);

    row.appendChild(meta);
    el.onboardingChecklist.appendChild(row);
  }
}

function renderOnboardingStatus(payload) {
  const status = payload?.status && typeof payload.status === "object" ? payload.status : payload;
  if (!status || typeof status !== "object") {
    return;
  }

  text(el.onboardingObsConnected, String(status.obsConnected === true));
  text(el.onboardingHasScan, String(status.hasScan === true));
  text(el.onboardingHasGenerated, String(status.hasGeneratedProfile === true));
  text(el.onboardingHasVerified, String(status.hasVerified === true));
  text(el.onboardingSceneCount, String(status.sceneCount ?? 0));
  text(el.onboardingInputCount, String(status.inputCount ?? 0));
  text(el.onboardingProgramScene, status.programSceneName ?? "-");

  const fileCount = Array.isArray(status.generatedFiles) ? status.generatedFiles.length : 0;
  text(el.onboardingGeneratedFiles, String(fileCount));

  const verification =
    status.verificationSummary &&
    typeof status.verificationSummary === "object" &&
    Number.isFinite(status.verificationSummary.passed) &&
    Number.isFinite(status.verificationSummary.total)
      ? `${status.verificationSummary.passed}/${status.verificationSummary.total}`
      : "-";
  text(el.onboardingVerification, verification);
  text(el.onboardingLastError, status.lastError ?? "-");
  renderOnboardingChecklist(status.lastChecklist);
}

function readOnboardingQuestionnaire() {
  return {
    streamType: (el.onboardingStreamType?.value ?? "").trim() || "gaming",
    primaryMic: (el.onboardingPrimaryMic?.value ?? "").trim() || undefined,
    gameplayScene: (el.onboardingGameplayScene?.value ?? "").trim() || undefined,
    cameraScene: (el.onboardingCameraScene?.value ?? "").trim() || undefined,
    overlayStyle: (el.onboardingOverlayStyle?.value ?? "").trim() || "clean-dark"
  };
}

async function runOnboardingScan() {
  try {
    const payload = await postJson("/api/onboarding/scan", {});
    renderOnboardingStatus(payload.status ?? payload);
    const sceneCount = Array.isArray(payload?.scan?.sceneNames) ? payload.scan.sceneNames.length : 0;
    writeLog(`Onboarding scan complete: ${sceneCount} scenes found.`);
    toast("Onboarding scan complete", "ok");
  } catch (error) {
    writeLog(`Onboarding scan failed: ${String(error)}`);
    toast(`Onboarding scan failed: ${String(error)}`, "error");
  }
}

async function runOnboardingGenerate() {
  try {
    const questionnaire = readOnboardingQuestionnaire();
    const payload = await postJson("/api/onboarding/generate", { questionnaire });
    renderOnboardingStatus(payload.status ?? payload);

    const files = Array.isArray(payload?.result?.files) ? payload.result.files : [];
    const names = files.map((file) => file.path).join(", ");
    writeLog(
      files.length > 0
        ? `Onboarding generated files: ${names}`
        : "Onboarding generation completed."
    );
    toast("Onboarding starter files generated", "ok");
  } catch (error) {
    writeLog(`Onboarding generate failed: ${String(error)}`);
    toast(`Onboarding generate failed: ${String(error)}`, "error");
  }
}

async function runOnboardingVerify() {
  try {
    const payload = await postJson("/api/onboarding/verify", {});
    renderOnboardingStatus(payload.status ?? payload);

    const summary = payload?.result?.summary;
    const label =
      summary && Number.isFinite(summary.passed) && Number.isFinite(summary.total)
        ? `${summary.passed}/${summary.total}`
        : "complete";
    writeLog(`Onboarding verification: ${label}`);
    toast(`Verification ${label}`, "ok");
  } catch (error) {
    writeLog(`Onboarding verify failed: ${String(error)}`);
    toast(`Onboarding verify failed: ${String(error)}`, "error");
  }
}

function readAssistantPrompt() {
  return (el.assistantPrompt?.value ?? "").trim();
}

async function runAssistantChat() {
  const prompt = readAssistantPrompt();
  if (!prompt) {
    toast("Type a prompt first", "warn");
    return;
  }

  try {
    const payload = await postJson("/api/assistant/chat", { prompt });
    text(el.assistantResponse, payload.message ?? "-");
    renderAssistantPlan(payload.plan);
    renderAssistantSuggestions(payload);
    writeLog(`Assistant reply: ${payload.message ?? "ok"}`);
    toast("Assistant plan generated", "ok");
  } catch (error) {
    writeLog(`Assistant chat failed: ${String(error)}`);
    toast(`Assistant chat failed: ${String(error)}`, "error");
  }
}

async function runAssistantPlan() {
  const prompt = readAssistantPrompt();
  if (!prompt) {
    toast("Type a prompt first", "warn");
    return;
  }

  try {
    const payload = await postJson("/api/assistant/plan", { prompt });
    renderAssistantPlan(payload.plan);
    text(el.assistantResponse, "Plan generated.");
    writeLog(`Assistant plan ready: ${payload?.plan?.id ?? "n/a"}`);
    toast("Assistant plan ready", "ok");
  } catch (error) {
    writeLog(`Assistant plan failed: ${String(error)}`);
    toast(`Assistant plan failed: ${String(error)}`, "error");
  }
}

async function runAssistantExecute() {
  const prompt = readAssistantPrompt();
  const planId = typeof state.assistantPlan?.id === "string" ? state.assistantPlan.id : "";

  if (!planId && !prompt) {
    toast("Generate a plan first or type a prompt", "warn");
    return;
  }

  if (
    !window.confirm(
      planId
        ? "Execute current assistant plan now?"
        : "No saved plan found. Generate and execute from the current prompt?"
    )
  ) {
    return;
  }

  try {
    const payload = await postJson("/api/assistant/execute", planId ? { planId } : { prompt });
    renderAssistantPlan(payload.plan);

    const execution = payload.execution && typeof payload.execution === "object" ? payload.execution : null;
    const ok = execution?.ok === true;
    const completed = Array.isArray(execution?.stepResults) ? execution.stepResults.length : 0;
    text(
      el.assistantResponse,
      ok ? `Execution complete (${completed} steps).` : `Execution stopped (${completed} steps).`
    );
    writeLog(ok ? "Assistant execution complete." : "Assistant execution finished with errors.");
    toast(ok ? "Assistant execution complete" : "Assistant execution had failures", ok ? "ok" : "warn");
  } catch (error) {
    writeLog(`Assistant execute failed: ${String(error)}`);
    toast(`Assistant execute failed: ${String(error)}`, "error");
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    let message = `request failed (${response.status})`;
    try {
      const payload = await response.json();
      const remoteMessage = payload?.error?.message;
      if (typeof remoteMessage === "string" && remoteMessage) {
        message = remoteMessage;
      }
    } catch {
      // Ignore parse errors.
    }
    throw new Error(message);
  }

  return response.json().catch(() => ({}));
}

async function runChaosPreset(presetId) {
  try {
    const result = await postJson(`/api/chaos/presets/${encodeURIComponent(presetId)}/run`);
    writeLog(`Chaos preset executed: ${result?.result?.presetId ?? presetId}`);
    toast(`Chaos preset executed: ${presetId}`, "ok");
  } catch (error) {
    writeLog(`Chaos run failed: ${String(error)}`);
    toast(`Chaos failed: ${String(error)}`, "error");
  }
}

async function captureReplay(label) {
  try {
    const result = await postJson("/api/replay/capture", { label });
    writeLog(`Replay captured: ${result?.result?.label ?? "n/a"}`);
    toast(`Replay captured: ${result?.result?.label ?? "ok"}`, "ok");
  } catch (error) {
    writeLog(`Replay capture failed: ${String(error)}`);
    toast(`Replay failed: ${String(error)}`, "error");
  }
}

async function callPluginVendor() {
  const vendorName = (el.pluginVendor?.value ?? "").trim();
  const requestType = (el.pluginRequest?.value ?? "").trim();
  const role = (el.pluginRole?.value ?? "operator").trim() || "operator";
  const rawData = (el.pluginData?.value ?? "").trim();

  if (!vendorName || !requestType) {
    toast("vendorName and requestType are required", "warn");
    return;
  }

  if (!window.confirm(`Call vendor request?\n${vendorName} :: ${requestType}`)) {
    return;
  }

  let requestData = {};
  if (rawData.length > 0) {
    try {
      requestData = JSON.parse(rawData);
    } catch {
      toast("requestData must be valid JSON", "error");
      return;
    }
  }

  try {
    const result = await postJson("/api/plugins/call", {
      vendorName,
      requestType,
      role,
      requestData
    });
    writeLog(`Vendor request succeeded: ${vendorName}.${requestType}`);
    toast(`Vendor call ok: ${vendorName}.${requestType}`, "ok");
    if (el.pluginData) {
      el.pluginData.value = JSON.stringify(result?.result ?? {}, null, 2);
    }
  } catch (error) {
    writeLog(`Vendor request failed: ${String(error)}`);
    toast(`Vendor call failed: ${String(error)}`, "error");
  }
}

async function probeOverlayService() {
  try {
    const payload = await postJson("/api/overlays/probe");
    renderOverlayBridge(payload);
    writeLog("Overlay service probed.");
    toast("Overlay service probed", payload?.status?.reachable ? "ok" : "warn");
  } catch (error) {
    writeLog(`Overlay probe failed: ${String(error)}`);
    toast(`Overlay probe failed: ${String(error)}`, "error");
  }
}

async function sendOverlayTestAlert() {
  const type = (el.overlayAlertType?.value ?? "").trim() || "follow";
  const username = (el.overlayAlertUser?.value ?? "").trim() || "TestViewer";

  try {
    await postJson("/api/overlays/test-alert", { type, username });
    writeLog(`Overlay alert sent: ${type} (${username})`);
    toast(`Overlay alert sent: ${type}`, "ok");
  } catch (error) {
    writeLog(`Overlay alert failed: ${String(error)}`);
    toast(`Overlay alert failed: ${String(error)}`, "error");
  }
}

async function sendOverlayTestChat() {
  const username = (el.overlayAlertUser?.value ?? "").trim() || "TestViewer";
  const message = (el.overlayChatMessage?.value ?? "").trim() || "Overlay chat test";

  try {
    await postJson("/api/overlays/test-chat", { username, message });
    writeLog("Overlay chat test sent.");
    toast("Overlay chat test sent", "ok");
  } catch (error) {
    writeLog(`Overlay chat failed: ${String(error)}`);
    toast(`Overlay chat failed: ${String(error)}`, "error");
  }
}

async function startOverlayStreamTimer() {
  try {
    await postJson("/api/overlays/start-stream", {});
    writeLog("Overlay stream timer started.");
    toast("Overlay stream timer started", "ok");
  } catch (error) {
    writeLog(`Overlay start stream failed: ${String(error)}`);
    toast(`Overlay start stream failed: ${String(error)}`, "error");
  }
}

async function switchOverlayScene() {
  const scene = (el.overlaySceneName?.value ?? "").trim();
  if (!scene) {
    toast("Enter a scene name first", "warn");
    return;
  }

  try {
    await postJson("/api/overlays/scene", { scene });
    writeLog(`Overlay scene switch requested: ${scene}`);
    toast(`Overlay scene switch: ${scene}`, "ok");
  } catch (error) {
    writeLog(`Overlay scene switch failed: ${String(error)}`);
    toast(`Overlay scene switch failed: ${String(error)}`, "error");
  }
}

function readSubtitleStyleInput() {
  const fontFamily = (el.overlaySubtitleFont?.value ?? "").trim() || "Inter, Segoe UI, sans-serif";
  const sizeRaw = Number(el.overlaySubtitleSize?.value ?? 56);
  const fontSizePx = Number.isFinite(sizeRaw) ? Math.max(18, Math.min(140, Math.round(sizeRaw))) : 56;
  const textColor = (el.overlaySubtitleTextColor?.value ?? "").trim() || "#ffffff";
  const backgroundColor = (el.overlaySubtitleBgColor?.value ?? "").trim() || "#000000";
  const opacityRaw = Number(el.overlaySubtitleBgOpacity?.value ?? 0.45);
  const backgroundOpacity = Number.isFinite(opacityRaw) ? Math.max(0, Math.min(1, opacityRaw)) : 0.45;
  return {
    fontFamily,
    fontSizePx,
    textColor,
    backgroundColor,
    backgroundOpacity
  };
}

async function applyOverlaySubtitleStyle(options = {}) {
  const settings = readSubtitleStyleInput();
  try {
    await postJson("/api/overlays/subtitles/settings", settings);
    if (options.silent !== true) {
      writeLog("Subtitle style updated.");
      toast("Subtitle style updated", "ok");
    }
    return true;
  } catch (error) {
    if (options.silent !== true) {
      writeLog(`Subtitle style update failed: ${String(error)}`);
      toast(`Subtitle style update failed: ${String(error)}`, "error");
    }
    return false;
  }
}

async function pushOverlaySubtitleText(textValue, finalValue = true, options = {}) {
  const text = typeof textValue === "string" ? textValue.trim() : "";
  if (!text) {
    return;
  }

  try {
    await postJson("/api/overlays/subtitles/push", {
      text,
      final: finalValue
    });
  } catch (error) {
    if (options.silent !== true) {
      writeLog(`Subtitle push failed: ${String(error)}`);
      toast(`Subtitle push failed: ${String(error)}`, "error");
    }
  }
}

async function clearOverlaySubtitles(options = {}) {
  try {
    await postJson("/api/overlays/subtitles/clear", {});
    if (options.silent !== true) {
      writeLog("Subtitles cleared.");
      toast("Subtitles cleared", "ok");
    }
  } catch (error) {
    if (options.silent !== true) {
      writeLog(`Subtitle clear failed: ${String(error)}`);
      toast(`Subtitle clear failed: ${String(error)}`, "error");
    }
  }
}

function ensureOverlaySttRecognition() {
  if (!sttRuntime.supported) {
    return null;
  }
  if (sttRuntime.recognition) {
    return sttRuntime.recognition;
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    sttRuntime.active = true;
    state.overlaySttActive = true;
    writeLog("Overlay STT capture active.");
    toast("STT capture active", "ok");
  };

  recognition.onend = () => {
    sttRuntime.active = false;
    state.overlaySttActive = false;
    if (sttRuntime.wanted) {
      window.setTimeout(() => {
        try {
          recognition.start();
        } catch {
          // Ignore re-start errors.
        }
      }, 180);
      return;
    }
    writeLog("Overlay STT capture stopped.");
  };

  recognition.onerror = (event) => {
    const code = typeof event?.error === "string" ? event.error : "unknown";
    writeLog(`Overlay STT error: ${code}`);
    if (code === "not-allowed" || code === "service-not-allowed") {
      sttRuntime.wanted = false;
      toast("Microphone permission denied for STT", "error");
      return;
    }
    if (code === "language-not-supported") {
      sttRuntime.wanted = false;
      toast("STT language is not supported", "error");
    }
  };

  recognition.onresult = (event) => {
    const finals = [];
    let interimText = "";

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const candidate =
        result &&
        result[0] &&
        typeof result[0].transcript === "string"
          ? result[0].transcript
          : "";
      const transcript = candidate.trim();
      if (!transcript) {
        continue;
      }
      if (result.isFinal) {
        finals.push(transcript);
      } else {
        interimText = transcript;
      }
    }

    if (finals.length > 0) {
      sttRuntime.lastInterimText = "";
      const finalSentence = finals.join(" ").trim();
      if (finalSentence) {
        void pushOverlaySubtitleText(finalSentence, true, { silent: true });
      }
    }

    if (interimText) {
      const nowMs = Date.now();
      if (interimText !== sttRuntime.lastInterimText || nowMs - sttRuntime.lastInterimAt >= 220) {
        sttRuntime.lastInterimText = interimText;
        sttRuntime.lastInterimAt = nowMs;
        void pushOverlaySubtitleText(interimText, false, { silent: true });
      }
    }
  };

  sttRuntime.recognition = recognition;
  return recognition;
}

async function startOverlaySttCapture() {
  if (!sttRuntime.supported) {
    toast("STT is not supported by this browser", "error");
    writeLog("STT start failed: Web Speech API not available.");
    return;
  }

  const styleApplied = await applyOverlaySubtitleStyle({ silent: true });
  if (!styleApplied) {
    writeLog("Starting STT anyway even though subtitle style update failed.");
  }

  const recognition = ensureOverlaySttRecognition();
  if (!recognition) {
    toast("STT initialization failed", "error");
    return;
  }

  recognition.lang = (el.overlaySubtitleLang?.value ?? "").trim() || "en-US";
  sttRuntime.wanted = true;
  sttRuntime.lastInterimText = "";

  try {
    recognition.start();
  } catch (error) {
    const message = String(error);
    if (!message.toLowerCase().includes("already started")) {
      sttRuntime.wanted = false;
      writeLog(`STT start failed: ${message}`);
      toast(`STT start failed: ${message}`, "error");
    }
  }
}

function stopOverlaySttCapture() {
  sttRuntime.wanted = false;
  sttRuntime.lastInterimText = "";
  state.overlaySttActive = false;
  if (!sttRuntime.recognition) {
    writeLog("Overlay STT capture already stopped.");
    return;
  }
  try {
    sttRuntime.recognition.stop();
  } catch (error) {
    writeLog(`STT stop failed: ${String(error)}`);
  }
}

function openOverlayLink(type) {
  const links = state.overlayLinks ?? buildOverlayLinks(state.overlayBaseUrl);
  const target = links[type];
  if (!target) {
    return;
  }
  const titles = {
    dashboard: "Overlay Dashboard",
    scene: "Unified Overlay",
    alerts: "Alerts Overlay",
    chat: "Chat Overlay",
    stats: "Stats Overlay",
    keyboard: "Keyboard Overlay",
    subtitles: "Subtitle Overlay"
  };
  const title = Object.prototype.hasOwnProperty.call(titles, type) ? titles[type] : "Overlay";
  setOverlayEmbedTarget(target, title, true);
}

async function autoDetectAndCopyOverlayUrls() {
  try {
    const payload = await postJson("/api/overlays/probe");
    renderOverlayBridge(payload);
    const links = ensureOverlayLinks(payload, state.overlayBaseUrl);
    const blob = [
      `Dashboard: ${links.dashboard}`,
      `Unified Scene: ${links.scene}`,
      `Alerts: ${links.alerts}`,
      `Chat: ${links.chat}`,
      `Stats: ${links.stats}`,
      `Keyboard: ${links.keyboard}`,
      `Subtitles: ${links.subtitles}`
    ].join("\n");
    const copied = await copyText(blob);
    writeLog(copied ? "Overlay URLs auto-detected and copied." : "Overlay URLs detected; copy failed.");
    toast(copied ? "Overlay URLs copied" : "Overlay URLs detected (copy failed)", copied ? "ok" : "warn");
  } catch (error) {
    writeLog(`Overlay auto-detect failed: ${String(error)}`);
    toast(`Overlay auto-detect failed: ${String(error)}`, "error");
  }
}

async function pollHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      throw new Error(`Health request failed (${response.status})`);
    }
    const payload = await response.json();
    renderHealth(payload);
  } catch (error) {
    writeLog(`Health poll failed: ${String(error)}`);
  }
}

async function bootstrapData() {
  const targets = [
    ["/api/status", renderSnapshot],
    ["/api/safety/status", renderSafety],
    ["/api/chaos/status", renderChaosStatus],
    ["/api/chaos/presets", renderChaosPresets],
    ["/api/auto-director/status", renderAutoDirector],
    ["/api/replay/status", renderReplayDirector],
    ["/api/plugins/status", renderPluginBridge],
    ["/api/overlays/status", renderOverlayBridge],
    ["/api/onboarding/status", renderOnboardingStatus],
    ["/api/assistant/suggestions", renderAssistantSuggestions],
    ["/api/health", renderHealth]
  ];

  await Promise.all(
    targets.map(async ([url, renderer]) => {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`request failed (${response.status})`);
        }
        const payload = await response.json();
        renderer(payload);
      } catch (error) {
        writeLog(`Bootstrap failed for ${url}: ${String(error)}`);
      }
    })
  );
}

function scheduleSocketReconnect() {
  if (reconnectTimer) {
    return;
  }

  wsAttempt += 1;
  const delay = Math.min(5000, 700 + wsAttempt * 450);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectSocket();
  }, delay);
}

function connectSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  text(el.wsState, "connecting");
  socket = new WebSocket(wsUrl);

  socket.addEventListener("open", () => {
    wsAttempt = 0;
    text(el.wsState, "open");
    writeLog("Control socket connected.");
  });

  socket.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "snapshot") {
        renderSnapshot(data.payload);
      } else if (data.type === "health") {
        renderHealth(data.payload);
      } else if (data.type === "safety") {
        renderSafety(data.payload);
      } else if (data.type === "chaosStatus") {
        renderChaosStatus(data.payload);
      } else if (data.type === "chaosPresets") {
        renderChaosPresets(data.payload);
      } else if (data.type === "autoDirector") {
        renderAutoDirector(data.payload);
      } else if (data.type === "replayDirector") {
        renderReplayDirector(data.payload);
      } else if (data.type === "pluginBridge") {
        renderPluginBridge(data.payload);
      } else if (data.type === "overlayBridge") {
        renderOverlayBridge(data.payload);
      }
    } catch {
      writeLog("Received invalid socket payload.");
    }
  });

  socket.addEventListener("close", () => {
    text(el.wsState, "closed");
    writeLog("Control socket closed. Reconnecting...");
    scheduleSocketReconnect();
  });

  socket.addEventListener("error", () => {
    text(el.wsState, "error");
    writeLog("Control socket error.");
    try {
      socket.close();
    } catch {
      // Ignore.
    }
  });
}

document.getElementById("btn-connect")?.addEventListener("click", async () => {
  try {
    await postJson("/api/obs/connect");
    writeLog("OBS connect requested.");
  } catch (error) {
    writeLog(`Action failed: connect (${String(error)})`);
  }
});

document.getElementById("btn-reconnect")?.addEventListener("click", async () => {
  try {
    await postJson("/api/obs/reconnect");
    writeLog("OBS reconnect requested.");
  } catch (error) {
    writeLog(`Action failed: reconnect (${String(error)})`);
  }
});

document.getElementById("btn-disconnect")?.addEventListener("click", async () => {
  try {
    await postJson("/api/obs/disconnect");
    writeLog("OBS disconnect requested.");
  } catch (error) {
    writeLog(`Action failed: disconnect (${String(error)})`);
  }
});

document.getElementById("btn-kill-on")?.addEventListener("click", async () => {
  if (!window.confirm("Enable kill switch? This will block guarded automations.")) {
    return;
  }
  try {
    const payload = await postJson("/api/safety/kill-switch", {
      enabled: true,
      reason: "manual dashboard activation"
    });
    renderSafety(payload.status);
    writeLog("Kill switch enabled.");
    toast("Kill switch enabled", "warn");
  } catch (error) {
    writeLog(`Kill switch action failed: ${String(error)}`);
  }
});

document.getElementById("btn-kill-off")?.addEventListener("click", async () => {
  if (!window.confirm("Disable kill switch?")) {
    return;
  }
  try {
    const payload = await postJson("/api/safety/kill-switch", { enabled: false });
    renderSafety(payload.status);
    writeLog("Kill switch disabled.");
    toast("Kill switch disabled", "ok");
  } catch (error) {
    writeLog(`Kill switch action failed: ${String(error)}`);
  }
});

document.getElementById("btn-fallback")?.addEventListener("click", async () => {
  if (!window.confirm("Trigger fallback scene now?")) {
    return;
  }
  try {
    await postJson("/api/safety/fallback-trigger");
    writeLog("Fallback scene triggered.");
    toast("Fallback scene triggered", "warn");
  } catch (error) {
    writeLog(`Fallback failed: ${String(error)}`);
    toast(`Fallback failed: ${String(error)}`, "error");
  }
});

document.getElementById("btn-auto-enable")?.addEventListener("click", async () => {
  try {
    const payload = await postJson("/api/auto-director/enable");
    renderAutoDirector(payload.status);
    writeLog("Auto Director enabled.");
  } catch (error) {
    writeLog(`Auto Director enable failed: ${String(error)}`);
  }
});

document.getElementById("btn-auto-disable")?.addEventListener("click", async () => {
  try {
    const payload = await postJson("/api/auto-director/disable");
    renderAutoDirector(payload.status);
    writeLog("Auto Director disabled.");
  } catch (error) {
    writeLog(`Auto Director disable failed: ${String(error)}`);
  }
});

document.getElementById("btn-auto-reload")?.addEventListener("click", async () => {
  try {
    const payload = await postJson("/api/auto-director/reload");
    renderAutoDirector(payload.status);
    writeLog("Auto Director rules reloaded.");
  } catch (error) {
    writeLog(`Rule reload failed: ${String(error)}`);
  }
});

document.getElementById("btn-chaos-reload")?.addEventListener("click", async () => {
  try {
    const payload = await postJson("/api/chaos/reload");
    renderChaosPresets(payload.presets);
    writeLog("Chaos presets reloaded.");
  } catch (error) {
    writeLog(`Chaos reload failed: ${String(error)}`);
  }
});

document.getElementById("btn-replay-capture")?.addEventListener("click", () => {
  const label = (el.replayLabel?.value ?? "").trim();
  void captureReplay(label);
});

document.getElementById("btn-replay-hide-overlay")?.addEventListener("click", async () => {
  try {
    await postJson("/api/replay/hide-overlay");
    writeLog("Replay overlay hidden.");
  } catch (error) {
    writeLog(`Hide overlay failed: ${String(error)}`);
  }
});

document.getElementById("btn-plugin-call")?.addEventListener("click", () => {
  void callPluginVendor();
});

document.getElementById("btn-plugin-reload")?.addEventListener("click", async () => {
  try {
    const payload = await postJson("/api/plugins/reload");
    renderPluginBridge(payload.status);
    writeLog("Plugin permissions reloaded.");
    toast("Plugin permissions reloaded", "ok");
  } catch (error) {
    writeLog(`Plugin reload failed: ${String(error)}`);
    toast(`Plugin reload failed: ${String(error)}`, "error");
  }
});

document.getElementById("btn-overlay-probe")?.addEventListener("click", () => {
  void probeOverlayService();
});

document.getElementById("btn-overlay-detect-copy")?.addEventListener("click", () => {
  void autoDetectAndCopyOverlayUrls();
});

document.getElementById("btn-overlay-open-dashboard")?.addEventListener("click", () => {
  openOverlayLink("dashboard");
});

document.getElementById("hero-open-overlay-dashboard")?.addEventListener("click", () => {
  openOverlayLink("dashboard");
});

document.getElementById("btn-overlay-open-scene")?.addEventListener("click", () => {
  openOverlayLink("scene");
});

document.getElementById("btn-overlay-open-keyboard")?.addEventListener("click", () => {
  openOverlayLink("keyboard");
});

document.getElementById("btn-overlay-open-subtitles")?.addEventListener("click", () => {
  openOverlayLink("subtitles");
});

document.getElementById("overlay-open-external")?.addEventListener("click", () => {
  if (!state.overlayActiveUrl) {
    return;
  }
  window.open(state.overlayActiveUrl, "_blank", "noopener,noreferrer");
});

document.getElementById("btn-overlay-test-alert")?.addEventListener("click", () => {
  void sendOverlayTestAlert();
});

document.getElementById("btn-overlay-test-chat")?.addEventListener("click", () => {
  void sendOverlayTestChat();
});

document.getElementById("btn-overlay-start-stream")?.addEventListener("click", () => {
  void startOverlayStreamTimer();
});

document.getElementById("btn-overlay-switch-scene")?.addEventListener("click", () => {
  void switchOverlayScene();
});

document.getElementById("btn-overlay-subtitle-style")?.addEventListener("click", () => {
  void applyOverlaySubtitleStyle();
});

document.getElementById("btn-overlay-stt-start")?.addEventListener("click", () => {
  void startOverlaySttCapture();
});

document.getElementById("btn-overlay-stt-stop")?.addEventListener("click", () => {
  stopOverlaySttCapture();
});

document.getElementById("btn-overlay-subtitle-clear")?.addEventListener("click", () => {
  void clearOverlaySubtitles();
});

document.getElementById("btn-onboarding-scan")?.addEventListener("click", () => {
  void runOnboardingScan();
});

document.getElementById("btn-onboarding-generate")?.addEventListener("click", () => {
  void runOnboardingGenerate();
});

document.getElementById("btn-onboarding-verify")?.addEventListener("click", () => {
  void runOnboardingVerify();
});

document.getElementById("btn-assistant-chat")?.addEventListener("click", () => {
  void runAssistantChat();
});

document.getElementById("btn-assistant-plan")?.addEventListener("click", () => {
  void runAssistantPlan();
});

document.getElementById("btn-assistant-execute")?.addEventListener("click", () => {
  void runAssistantExecute();
});

document.getElementById("qa-replay")?.addEventListener("click", () => {
  const label = (el.replayLabel?.value ?? "").trim();
  void captureReplay(label);
});

document.getElementById("qa-kill-toggle")?.addEventListener("click", async () => {
  const enable = !state.safetyKillSwitch;
  const confirmed = window.confirm(
    enable
      ? "Enable kill switch? This will block guarded automations."
      : "Disable kill switch?"
  );
  if (!confirmed) {
    return;
  }
  try {
    const payload = await postJson("/api/safety/kill-switch", {
      enabled: enable,
      reason: enable ? "quickbar toggle" : undefined
    });
    renderSafety(payload.status);
    toast(enable ? "Kill switch enabled" : "Kill switch disabled", enable ? "warn" : "ok");
  } catch (error) {
    toast(`Kill switch toggle failed: ${String(error)}`, "error");
  }
});

document.getElementById("qa-auto-toggle")?.addEventListener("click", async () => {
  try {
    const endpoint = state.autoEnabled ? "/api/auto-director/disable" : "/api/auto-director/enable";
    const payload = await postJson(endpoint);
    renderAutoDirector(payload.status);
    toast(state.autoEnabled ? "Auto Director enabled" : "Auto Director disabled", "ok");
  } catch (error) {
    toast(`Auto Director toggle failed: ${String(error)}`, "error");
  }
});

document.getElementById("qa-chaos-first")?.addEventListener("click", () => {
  const first = state.chaosPresets[0];
  if (!first) {
    toast("No chaos presets available", "warn");
    return;
  }
  void runChaosPreset(first.id);
});

document.getElementById("qa-collapse-all")?.addEventListener("click", () => {
  setAllPanelsCollapsed(true);
  toast("Compact view enabled", "ok");
});

document.getElementById("qa-expand-all")?.addEventListener("click", () => {
  setAllPanelsCollapsed(false);
  toast("Full view restored", "ok");
});

if (el.overlayFrame instanceof HTMLIFrameElement) {
  el.overlayFrame.addEventListener("load", () => {
    fitOverlayFrameForCurrentTarget();
    window.setTimeout(() => {
      fitOverlayFrameForCurrentTarget();
    }, 120);
  });
}

window.addEventListener("resize", () => {
  fitOverlayFrameForCurrentTarget();
});

window.addEventListener("message", (event) => {
  const payload = event.data;
  if (!payload || typeof payload !== "object") {
    return;
  }

  const source = "source" in payload ? payload.source : "";
  const type = "type" in payload ? payload.type : "";
  if (source !== "obs-overlays" || type !== "embed-metrics") {
    return;
  }

  if (!isOverlayMessageOrigin(event.origin)) {
    return;
  }

  const width = "width" in payload ? Number(payload.width) : Number.NaN;
  const height = "height" in payload ? Number(payload.height) : Number.NaN;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return;
  }

  applyOverlayFrameFit(width, height);
});

window.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey && event.shiftKey)) {
    return;
  }

  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "r") {
    event.preventDefault();
    const label = (el.replayLabel?.value ?? "").trim();
    void captureReplay(label);
    return;
  }
  if (key === "k") {
    event.preventDefault();
    document.getElementById("qa-kill-toggle")?.click();
    return;
  }
  if (key === "a") {
    event.preventDefault();
    document.getElementById("qa-auto-toggle")?.click();
  }
});

window.addEventListener("beforeunload", () => {
  stopOverlaySttCapture();
});

if (!sttRuntime.supported) {
  writeLog("Browser STT unavailable. Use Chrome/Edge for subtitle capture.");
}

setupPanelCollapseControls();
void bootstrapData();
connectSocket();
setInterval(() => {
  void pollHealth();
}, 5000);
