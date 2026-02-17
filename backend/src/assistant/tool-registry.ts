import type { AutoDirector } from "../auto-director.js";
import type { ChaosEngine } from "../chaos-engine.js";
import { AppError } from "../errors.js";
import type { ObsConnectionManager } from "../obs-manager.js";
import type { OverlayBridge } from "../overlay-bridge.js";
import type { ReplayDirector } from "../replay-director.js";
import type { SafetyManager } from "../safety-manager.js";

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export type AssistantRiskLevel = "low" | "medium" | "high";
export type AssistantToolId =
  | "obs.connect"
  | "obs.reconnect"
  | "auto.enable"
  | "auto.disable"
  | "auto.reload"
  | "chaos.run-preset"
  | "replay.capture"
  | "overlays.probe"
  | "safety.kill-switch"
  | "safety.fallback-scene";

export interface AssistantToolDefinition {
  id: AssistantToolId;
  label: string;
  description: string;
  risk: AssistantRiskLevel;
  requiresConfirmation: boolean;
}

export interface AssistantPlanStep {
  id: string;
  toolId: AssistantToolId;
  title: string;
  description: string;
  args: Record<string, unknown>;
  risk: AssistantRiskLevel;
  requiresConfirmation: boolean;
}

export interface AssistantToolExecutionResult {
  stepId: string;
  toolId: AssistantToolId;
  ok: boolean;
  message: string;
  data: Record<string, unknown>;
}

export interface AssistantToolRegistryConfig {
  obsManager: ObsConnectionManager;
  safetyManager: SafetyManager;
  autoDirector: AutoDirector;
  chaosEngine: ChaosEngine;
  replayDirector: ReplayDirector;
  overlayBridge: OverlayBridge;
  logger: LoggerLike;
}

const TOOL_DEFINITIONS: AssistantToolDefinition[] = [
  {
    id: "obs.connect",
    label: "Connect OBS",
    description: "Start OBS WebSocket connection flow.",
    risk: "low",
    requiresConfirmation: false
  },
  {
    id: "obs.reconnect",
    label: "Reconnect OBS",
    description: "Force reconnect to OBS WebSocket.",
    risk: "low",
    requiresConfirmation: true
  },
  {
    id: "auto.enable",
    label: "Enable Auto Director",
    description: "Enable auto scene switching rules.",
    risk: "medium",
    requiresConfirmation: true
  },
  {
    id: "auto.disable",
    label: "Disable Auto Director",
    description: "Disable auto scene switching rules.",
    risk: "medium",
    requiresConfirmation: true
  },
  {
    id: "auto.reload",
    label: "Reload Auto Director",
    description: "Reload auto-director rules from disk.",
    risk: "low",
    requiresConfirmation: false
  },
  {
    id: "chaos.run-preset",
    label: "Run Chaos Preset",
    description: "Execute one chaos preset timeline.",
    risk: "high",
    requiresConfirmation: true
  },
  {
    id: "replay.capture",
    label: "Capture Replay",
    description: "Save replay buffer and trigger replay flow.",
    risk: "medium",
    requiresConfirmation: true
  },
  {
    id: "overlays.probe",
    label: "Probe Overlay Service",
    description: "Check OBS-overlays service connectivity.",
    risk: "low",
    requiresConfirmation: false
  },
  {
    id: "safety.kill-switch",
    label: "Set Kill Switch",
    description: "Enable or disable safety kill switch.",
    risk: "high",
    requiresConfirmation: true
  },
  {
    id: "safety.fallback-scene",
    label: "Trigger Fallback Scene",
    description: "Immediately switch to configured fallback scene.",
    risk: "high",
    requiresConfirmation: true
  }
];

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

export class AssistantToolRegistry {
  private readonly config: AssistantToolRegistryConfig;

  constructor(config: AssistantToolRegistryConfig) {
    this.config = config;
  }

  listTools(): AssistantToolDefinition[] {
    return TOOL_DEFINITIONS.map((tool) => ({ ...tool }));
  }

  getToolDefinition(toolId: AssistantToolId): AssistantToolDefinition | null {
    const match = TOOL_DEFINITIONS.find((tool) => tool.id === toolId);
    return match ? { ...match } : null;
  }

  async executeStep(step: AssistantPlanStep): Promise<AssistantToolExecutionResult> {
    const args = step.args ?? {};

    switch (step.toolId) {
      case "obs.connect": {
        this.config.obsManager.manualConnect();
        return {
          stepId: step.id,
          toolId: step.toolId,
          ok: true,
          message: "OBS connect requested.",
          data: { requested: true }
        };
      }
      case "obs.reconnect": {
        this.config.safetyManager.assertAction("assistant:obs-reconnect");
        this.config.obsManager.forceReconnect();
        return {
          stepId: step.id,
          toolId: step.toolId,
          ok: true,
          message: "OBS reconnect requested.",
          data: { requested: true }
        };
      }
      case "auto.enable": {
        this.config.safetyManager.assertAction("assistant:auto-enable");
        const status = this.config.autoDirector.setEnabled(true);
        return {
          stepId: step.id,
          toolId: step.toolId,
          ok: true,
          message: "Auto Director enabled.",
          data: {
            enabled: status.enabled
          }
        };
      }
      case "auto.disable": {
        this.config.safetyManager.assertAction("assistant:auto-disable");
        const status = this.config.autoDirector.setEnabled(false);
        return {
          stepId: step.id,
          toolId: step.toolId,
          ok: true,
          message: "Auto Director disabled.",
          data: {
            enabled: status.enabled
          }
        };
      }
      case "auto.reload": {
        this.config.safetyManager.assertAction("assistant:auto-reload");
        const status = await this.config.autoDirector.reloadRules();
        return {
          stepId: step.id,
          toolId: step.toolId,
          ok: true,
          message: "Auto Director rules reloaded.",
          data: {
            enabled: status.enabled,
            ruleCount: status.rules.length
          }
        };
      }
      case "chaos.run-preset": {
        const presetId = readString(args.presetId);
        if (!presetId) {
          throw new AppError("assistant step is missing presetId", {
            statusCode: 400,
            code: "ASSISTANT_PRESET_REQUIRED"
          });
        }

        const result = await this.config.chaosEngine.runPreset(presetId);
        return {
          stepId: step.id,
          toolId: step.toolId,
          ok: true,
          message: `Chaos preset executed: ${presetId}`,
          data: result as unknown as Record<string, unknown>
        };
      }
      case "replay.capture": {
        const label = readString(args.label) ?? undefined;
        const result = await this.config.replayDirector.captureReplay(label);
        return {
          stepId: step.id,
          toolId: step.toolId,
          ok: true,
          message: `Replay captured: ${result.label}`,
          data: {
            label: result.label,
            replayPath: result.replayPath ?? null,
            playbackTriggered: result.playbackTriggered,
            chapterCreated: result.chapterCreated
          }
        };
      }
      case "overlays.probe": {
        const status = await this.config.overlayBridge.probe();
        return {
          stepId: step.id,
          toolId: step.toolId,
          ok: true,
          message: status.reachable
            ? "Overlay service is reachable."
            : "Overlay service is unreachable.",
          data: {
            reachable: status.reachable,
            baseUrl: status.baseUrl,
            lastError: status.lastError
          }
        };
      }
      case "safety.kill-switch": {
        const enabled = readBoolean(args.enabled);
        if (enabled === null) {
          throw new AppError("assistant step is missing enabled boolean", {
            statusCode: 400,
            code: "ASSISTANT_KILL_SWITCH_VALUE_REQUIRED"
          });
        }

        const reason = readString(args.reason) ?? "assistant request";
        const status = this.config.safetyManager.setKillSwitch(enabled, reason);
        return {
          stepId: step.id,
          toolId: step.toolId,
          ok: true,
          message: enabled ? "Kill switch enabled." : "Kill switch disabled.",
          data: {
            killSwitch: status.killSwitch,
            reason
          }
        };
      }
      case "safety.fallback-scene": {
        const fallbackScene = this.config.safetyManager.getFallbackScene();
        if (!fallbackScene) {
          throw new AppError("No fallback scene configured", {
            statusCode: 400,
            code: "FALLBACK_SCENE_NOT_CONFIGURED"
          });
        }

        this.config.safetyManager.assertAction("assistant:fallback-scene", {
          bypassKillSwitch: true,
          bypassRateLimit: true
        });
        await this.config.obsManager.call("SetCurrentProgramScene", {
          sceneName: fallbackScene
        });
        return {
          stepId: step.id,
          toolId: step.toolId,
          ok: true,
          message: `Switched to fallback scene: ${fallbackScene}`,
          data: {
            fallbackScene
          }
        };
      }
      default: {
        const message = `Unsupported assistant tool: ${step.toolId}`;
        this.config.logger.warn(message);
        throw new AppError(message, {
          statusCode: 400,
          code: "ASSISTANT_TOOL_UNSUPPORTED"
        });
      }
    }
  }
}
