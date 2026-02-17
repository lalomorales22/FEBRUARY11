interface EnvNumberOptions {
  fallback: number;
  min?: number;
}

function readNumber(name: string, options: EnvNumberOptions): number {
  const raw = process.env[name];
  if (!raw) {
    return options.fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return options.fallback;
  }

  if (options.min !== undefined && parsed < options.min) {
    return options.fallback;
  }

  return parsed;
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

export interface AppConfig {
  appHost: string;
  appPort: number;
  obsHost: string;
  obsPort: number;
  obsPassword: string;
  obsReconnectBaseMs: number;
  obsReconnectMaxMs: number;
  obsStatusPollMs: number;
  chaosPresetsDir: string;
  autoDirectorRulesPath: string;
  safetyFallbackScene: string | null;
  safetyRateLimitWindowMs: number;
  safetyMaxActionsPerWindow: number;
  replayMediaInputName: string | null;
  replayLowerThirdInputName: string | null;
  replayLowerThirdSceneName: string | null;
  replayLowerThirdDurationMs: number;
  replayLowerThirdTemplate: string;
  replayCaptureWaitMs: number;
  replayAutoStartBuffer: boolean;
  replayCreateRecordChapter: boolean;
  replayChapterPrefix: string;
  pluginPermissionsPath: string;
  pluginDefaultPolicy: "allow" | "deny";
  pluginRecentEventLimit: number;
  overlayBridgeEnabled: boolean;
  overlayBridgeBaseUrl: string;
  overlayBridgeRequestTimeoutMs: number;
  overlayBridgePollMs: number;
  openAiApiKey: string | null;
  openAiModel: string;
  openAiBaseUrl: string;
  assistantLlmTimeoutMs: number;
}

export function loadConfig(): AppConfig {
  const fallbackScene = (process.env.SAFETY_FALLBACK_SCENE ?? "").trim();
  const replayMediaInputName = (process.env.REPLAY_MEDIA_INPUT_NAME ?? "").trim();
  const replayLowerThirdInputName = (process.env.REPLAY_LOWER_THIRD_INPUT_NAME ?? "").trim();
  const replayLowerThirdSceneName = (process.env.REPLAY_LOWER_THIRD_SCENE_NAME ?? "").trim();
  const pluginDefaultPolicyRaw = (process.env.PLUGIN_DEFAULT_POLICY ?? "deny").trim().toLowerCase();
  const openAiApiKeyRaw = (process.env.OPENAI_API_KEY ?? "").trim();

  return {
    appHost: process.env.APP_HOST ?? "0.0.0.0",
    appPort: readNumber("APP_PORT", { fallback: 3199, min: 1 }),
    obsHost: process.env.OBS_HOST ?? "127.0.0.1",
    obsPort: readNumber("OBS_PORT", { fallback: 4455, min: 1 }),
    obsPassword: process.env.OBS_PASSWORD ?? "",
    obsReconnectBaseMs: readNumber("OBS_RECONNECT_BASE_MS", {
      fallback: 1250,
      min: 200
    }),
    obsReconnectMaxMs: readNumber("OBS_RECONNECT_MAX_MS", {
      fallback: 20000,
      min: 1000
    }),
    obsStatusPollMs: readNumber("OBS_STATUS_POLL_MS", {
      fallback: 1000,
      min: 250
    }),
    chaosPresetsDir: process.env.CHAOS_PRESETS_DIR ?? "presets/chaos",
    autoDirectorRulesPath:
      process.env.AUTO_DIRECTOR_RULES_PATH ?? "presets/auto-director.default.json",
    safetyFallbackScene: fallbackScene.length > 0 ? fallbackScene : null,
    safetyRateLimitWindowMs: readNumber("SAFETY_RATE_LIMIT_WINDOW_MS", {
      fallback: 60000,
      min: 5000
    }),
    safetyMaxActionsPerWindow: readNumber("SAFETY_MAX_ACTIONS_PER_WINDOW", {
      fallback: 40,
      min: 1
    }),
    replayMediaInputName: replayMediaInputName.length > 0 ? replayMediaInputName : null,
    replayLowerThirdInputName:
      replayLowerThirdInputName.length > 0 ? replayLowerThirdInputName : null,
    replayLowerThirdSceneName:
      replayLowerThirdSceneName.length > 0 ? replayLowerThirdSceneName : null,
    replayLowerThirdDurationMs: readNumber("REPLAY_LOWER_THIRD_DURATION_MS", {
      fallback: 6500,
      min: 500
    }),
    replayLowerThirdTemplate:
      process.env.REPLAY_LOWER_THIRD_TEMPLATE ?? "REPLAY | {label} | {time}",
    replayCaptureWaitMs: readNumber("REPLAY_CAPTURE_WAIT_MS", {
      fallback: 700,
      min: 200
    }),
    replayAutoStartBuffer: readBoolean("REPLAY_AUTO_START_BUFFER", true),
    replayCreateRecordChapter: readBoolean("REPLAY_CREATE_RECORD_CHAPTER", true),
    replayChapterPrefix: process.env.REPLAY_CHAPTER_PREFIX ?? "REPLAY",
    pluginPermissionsPath:
      process.env.PLUGIN_PERMISSIONS_PATH ?? "presets/plugin-permissions.default.json",
    pluginDefaultPolicy:
      pluginDefaultPolicyRaw === "allow" ? "allow" : "deny",
    pluginRecentEventLimit: readNumber("PLUGIN_RECENT_EVENT_LIMIT", {
      fallback: 20,
      min: 1
    }),
    overlayBridgeEnabled: readBoolean("OVERLAY_BRIDGE_ENABLED", true),
    overlayBridgeBaseUrl: process.env.OVERLAY_BRIDGE_BASE_URL ?? "http://127.0.0.1:5555",
    overlayBridgeRequestTimeoutMs: readNumber("OVERLAY_BRIDGE_REQUEST_TIMEOUT_MS", {
      fallback: 2500,
      min: 200
    }),
    overlayBridgePollMs: readNumber("OVERLAY_BRIDGE_POLL_MS", {
      fallback: 10000,
      min: 1000
    }),
    openAiApiKey: openAiApiKeyRaw.length > 0 ? openAiApiKeyRaw : null,
    openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    openAiBaseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
    assistantLlmTimeoutMs: readNumber("ASSISTANT_LLM_TIMEOUT_MS", {
      fallback: 12000,
      min: 1000
    })
  };
}
