export type ObsConnectionPhase =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface ObsConnectionState {
  phase: ObsConnectionPhase;
  reconnectAttempt: number;
  nextRetryInMs: number | null;
  lastError: string | null;
  updatedAt: string;
}

export interface ObsStatsSnapshot {
  cpuUsage: number | null;
  memoryUsage: number | null;
  activeFps: number | null;
  averageFrameTime: number | null;
  renderTotalFrames: number | null;
  renderSkippedFrames: number | null;
  outputTotalFrames: number | null;
  outputSkippedFrames: number | null;
}

export interface ObsStatusSnapshot {
  connection: ObsConnectionState;
  streamActive: boolean;
  streamTimecode: string | null;
  recordActive: boolean;
  recordPaused: boolean;
  recordTimecode: string | null;
  programSceneName: string | null;
  stats: ObsStatsSnapshot;
  updatedAt: string;
}

export interface HealthResponse {
  service: string;
  status: "ok";
  now: string;
  uptimeSeconds: number;
  obsPhase: ObsConnectionPhase;
  reconnectAttempt: number;
  nextRetryInMs: number | null;
}

export interface SafetyStatus {
  killSwitch: boolean;
  fallbackScene: string | null;
  actionsInWindow: number;
  maxActionsPerWindow: number;
  windowMs: number;
  remainingInWindow: number;
  lastBlockedReason: string | null;
  updatedAt: string;
}

export interface ChaosPresetSummary {
  id: string;
  name: string;
  description: string | null;
  cooldownMs: number;
  stepCount: number;
  tags: string[];
}

export interface ChaosEngineStatus {
  loadedAt: string | null;
  runningPresetId: string | null;
  totalPresets: number;
  lastRunAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export interface AutoDirectorRule {
  id: string;
  inputName: string;
  sceneName: string;
  activationDb: number;
  priority: number;
  holdMs: number | null;
}

export interface AutoDirectorLevel {
  inputName: string;
  levelDb: number;
  seenAt: string;
}

export interface AutoDirectorStatus {
  enabled: boolean;
  switchCooldownMs: number;
  hysteresisDb: number;
  defaultHoldMs: number;
  activeRuleId: string | null;
  pendingRuleId: string | null;
  lastSwitchAt: string | null;
  lastDecision: string | null;
  rules: AutoDirectorRule[];
  topInputLevels: AutoDirectorLevel[];
  updatedAt: string;
}

export interface ReplayDirectorStatus {
  replayBufferActive: boolean;
  lastCaptureAt: string | null;
  lastReplayPath: string | null;
  lastLabel: string | null;
  playbackTriggered: boolean;
  chapterCreated: boolean;
  overlayVisible: boolean;
  lastError: string | null;
  mediaInputName: string | null;
  lowerThirdInputName: string | null;
  lowerThirdSceneName: string | null;
  updatedAt: string;
}

export interface ReplayCaptureResult {
  capturedAt: string;
  label: string;
  replayPath: string | null;
  playbackTriggered: boolean;
  chapterCreated: boolean;
  overlayShown: boolean;
}

export interface PluginPermission {
  vendorName: string;
  enabled: boolean;
  allowedRequests: string[];
  allowedRoles: string[];
  notes: string | null;
}

export interface PluginVendorEventSummary {
  vendorName: string;
  eventType: string;
  receivedAt: string;
}

export interface PluginBridgeStatus {
  loadedAt: string | null;
  defaultPolicy: "allow" | "deny";
  vendorCount: number;
  vendors: PluginPermission[];
  lastCallAt: string | null;
  lastCallVendor: string | null;
  lastError: string | null;
  recentVendorEvents: PluginVendorEventSummary[];
  updatedAt: string;
}

export interface OverlayBridgeStatus {
  enabled: boolean;
  baseUrl: string;
  reachable: boolean;
  lastCheckedAt: string | null;
  lastError: string | null;
  updatedAt: string;
}

export type WsServerMessage =
  | { type: "snapshot"; payload: ObsStatusSnapshot }
  | { type: "health"; payload: HealthResponse }
  | { type: "safety"; payload: SafetyStatus }
  | { type: "chaosStatus"; payload: ChaosEngineStatus }
  | { type: "chaosPresets"; payload: ChaosPresetSummary[] }
  | { type: "autoDirector"; payload: AutoDirectorStatus }
  | { type: "replayDirector"; payload: ReplayDirectorStatus }
  | { type: "pluginBridge"; payload: PluginBridgeStatus }
  | { type: "overlayBridge"; payload: OverlayBridgeStatus };
