import { promises as fs } from "node:fs";
import path from "node:path";

import type { ChaosEngineStatus, ChaosPresetSummary } from "../../shared/src/types.js";
import { AppError } from "./errors.js";
import type { ObsConnectionManager } from "./obs-manager.js";
import type { SafetyManager } from "./safety-manager.js";

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface BatchCall {
  requestType: string;
  requestData?: Record<string, unknown>;
}

type ChaosStep =
  | { type: "serial"; steps: ChaosStep[] }
  | { type: "parallel"; steps: ChaosStep[] }
  | { type: "sleep"; ms?: number; frames?: number }
  | { type: "setProgramScene"; sceneName: string }
  | { type: "setPreviewScene"; sceneName: string }
  | { type: "sceneTransition"; transitionName?: string; durationMs?: number; triggerStudioMode?: boolean }
  | {
      type: "sceneItemTransform";
      sceneName: string;
      sceneItemId?: number;
      sceneItemSourceName?: string;
      transform: Record<string, unknown>;
    }
  | {
      type: "sceneItemEnabled";
      sceneName: string;
      sceneItemId?: number;
      sceneItemSourceName?: string;
      enabled: boolean;
    }
  | {
      type: "sourceFilter";
      sourceName: string;
      filterName: string;
      enabled?: boolean;
      settings?: Record<string, unknown>;
      overlay?: boolean;
    }
  | { type: "obsRequest"; requestType: string; requestData?: Record<string, unknown> }
  | {
      type: "batch";
      executionType?: "none" | "serialRealtime" | "serialFrame" | "parallel";
      haltOnFailure?: boolean;
      calls: BatchCall[];
    };

interface ChaosPreset {
  id: string;
  name: string;
  description: string | null;
  cooldownMs: number;
  tags: string[];
  steps: ChaosStep[];
}

interface ChaosRunResult {
  presetId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface ChaosEngineConfig {
  presetsDir: string;
  obsManager: ObsConnectionManager;
  safetyManager: SafetyManager;
  logger: LoggerLike;
}

type ChaosStatusListener = (status: ChaosEngineStatus) => void;
type ChaosPresetListener = (presets: ChaosPresetSummary[]) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function toString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") {
    return fallback;
  }
  return value;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

export class ChaosEngine {
  private readonly config: ChaosEngineConfig;
  private readonly presets = new Map<string, ChaosPreset>();
  private readonly cooldownByPreset = new Map<string, number>();
  private readonly statusListeners = new Set<ChaosStatusListener>();
  private readonly presetListeners = new Set<ChaosPresetListener>();

  private status: ChaosEngineStatus = {
    loadedAt: null,
    runningPresetId: null,
    totalPresets: 0,
    lastRunAt: null,
    lastError: null,
    updatedAt: nowIso()
  };

  constructor(config: ChaosEngineConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    await this.loadPresets();
  }

  async loadPresets(): Promise<ChaosPresetSummary[]> {
    await fs.mkdir(this.config.presetsDir, { recursive: true });

    const entries = await fs.readdir(this.config.presetsDir, { withFileTypes: true });
    const loadedPresets = new Map<string, ChaosPreset>();

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const fullPath = path.join(this.config.presetsDir, entry.name);
      try {
        const raw = await fs.readFile(fullPath, "utf8");
        const parsed = JSON.parse(raw) as unknown;
        const preset = this.parsePreset(parsed, entry.name);
        loadedPresets.set(preset.id, preset);
      } catch (error) {
        this.config.logger.warn("Skipping invalid chaos preset", {
          file: fullPath,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.presets.clear();
    for (const [id, preset] of loadedPresets.entries()) {
      this.presets.set(id, preset);
    }

    this.status = {
      ...this.status,
      loadedAt: nowIso(),
      totalPresets: this.presets.size,
      updatedAt: nowIso()
    };
    this.emitStatus();
    this.emitPresets();

    return this.listPresets();
  }

  listPresets(): ChaosPresetSummary[] {
    return [...this.presets.values()]
      .map((preset) => ({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        cooldownMs: preset.cooldownMs,
        stepCount: preset.steps.length,
        tags: [...preset.tags]
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getStatus(): ChaosEngineStatus {
    return { ...this.status };
  }

  subscribeStatus(listener: ChaosStatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  subscribePresets(listener: ChaosPresetListener): () => void {
    this.presetListeners.add(listener);
    listener(this.listPresets());
    return () => {
      this.presetListeners.delete(listener);
    };
  }

  async runPreset(presetId: string): Promise<ChaosRunResult> {
    const preset = this.presets.get(presetId);
    if (!preset) {
      throw new AppError(`Chaos preset not found: ${presetId}`, {
        statusCode: 404,
        code: "CHAOS_PRESET_NOT_FOUND"
      });
    }

    if (this.status.runningPresetId) {
      throw new AppError(
        `Preset "${this.status.runningPresetId}" is already running. Wait for completion.`,
        {
          statusCode: 409,
          code: "CHAOS_PRESET_BUSY"
        }
      );
    }

    const now = Date.now();
    const cooldownUntil = this.cooldownByPreset.get(presetId) ?? 0;
    if (cooldownUntil > now) {
      throw new AppError(`Preset "${presetId}" is on cooldown for ${cooldownUntil - now}ms`, {
        statusCode: 429,
        code: "CHAOS_COOLDOWN"
      });
    }

    this.config.safetyManager.assertAction(`chaos:${presetId}`);

    const startedAtEpoch = Date.now();
    this.status = {
      ...this.status,
      runningPresetId: presetId,
      lastError: null,
      updatedAt: nowIso()
    };
    this.emitStatus();

    try {
      for (const step of preset.steps) {
        await this.executeStep(step);
      }

      const finishedAtEpoch = Date.now();
      this.cooldownByPreset.set(presetId, finishedAtEpoch + preset.cooldownMs);
      this.status = {
        ...this.status,
        runningPresetId: null,
        lastRunAt: nowIso(),
        updatedAt: nowIso()
      };
      this.emitStatus();

      return {
        presetId,
        startedAt: new Date(startedAtEpoch).toISOString(),
        finishedAt: new Date(finishedAtEpoch).toISOString(),
        durationMs: finishedAtEpoch - startedAtEpoch
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = {
        ...this.status,
        runningPresetId: null,
        lastError: message,
        updatedAt: nowIso()
      };
      this.emitStatus();
      throw new AppError(`Chaos preset failed (${presetId}): ${message}`, {
        statusCode: 500,
        code: "CHAOS_EXECUTION_FAILED"
      });
    }
  }

  private async executeStep(step: ChaosStep): Promise<void> {
    switch (step.type) {
      case "serial": {
        for (const child of step.steps) {
          await this.executeStep(child);
        }
        break;
      }
      case "parallel": {
        await Promise.all(step.steps.map((child) => this.executeStep(child)));
        break;
      }
      case "sleep": {
        if (typeof step.frames === "number" && step.frames > 0) {
          await this.config.obsManager.call("Sleep", { sleepFrames: Math.floor(step.frames) });
          break;
        }

        const ms = Math.max(0, Math.floor(step.ms ?? 0));
        if (ms > 0) {
          await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), ms);
          });
        }
        break;
      }
      case "setProgramScene": {
        await this.config.obsManager.call("SetCurrentProgramScene", {
          sceneName: step.sceneName
        });
        break;
      }
      case "setPreviewScene": {
        await this.config.obsManager.call("SetCurrentPreviewScene", {
          sceneName: step.sceneName
        });
        break;
      }
      case "sceneTransition": {
        if (step.transitionName) {
          await this.config.obsManager.call("SetCurrentSceneTransition", {
            transitionName: step.transitionName
          });
        }
        if (typeof step.durationMs === "number") {
          await this.config.obsManager.call("SetCurrentSceneTransitionDuration", {
            transitionDuration: Math.max(0, Math.floor(step.durationMs))
          });
        }
        if (step.triggerStudioMode === true) {
          await this.config.obsManager.call("TriggerStudioModeTransition");
        }
        break;
      }
      case "sceneItemTransform": {
        const sceneItemId = await this.resolveSceneItemId(
          step.sceneName,
          step.sceneItemId,
          step.sceneItemSourceName
        );
        await this.config.obsManager.call("SetSceneItemTransform", {
          sceneName: step.sceneName,
          sceneItemId,
          sceneItemTransform: step.transform
        });
        break;
      }
      case "sceneItemEnabled": {
        const sceneItemId = await this.resolveSceneItemId(
          step.sceneName,
          step.sceneItemId,
          step.sceneItemSourceName
        );
        await this.config.obsManager.call("SetSceneItemEnabled", {
          sceneName: step.sceneName,
          sceneItemId,
          sceneItemEnabled: step.enabled
        });
        break;
      }
      case "sourceFilter": {
        if (typeof step.enabled === "boolean") {
          await this.config.obsManager.call("SetSourceFilterEnabled", {
            sourceName: step.sourceName,
            filterName: step.filterName,
            filterEnabled: step.enabled
          });
        }
        if (step.settings) {
          await this.config.obsManager.call("SetSourceFilterSettings", {
            sourceName: step.sourceName,
            filterName: step.filterName,
            filterSettings: step.settings,
            overlay: step.overlay !== false
          });
        }
        break;
      }
      case "obsRequest": {
        await this.config.obsManager.call(step.requestType, step.requestData);
        break;
      }
      case "batch": {
        await this.config.obsManager.callBatch(step.calls, {
          executionType: step.executionType ?? "serialRealtime",
          haltOnFailure: step.haltOnFailure !== false
        });
        break;
      }
      default: {
        const exhaustive: never = step;
        throw new Error(`Unsupported chaos step: ${String(exhaustive)}`);
      }
    }
  }

  private async resolveSceneItemId(
    sceneName: string,
    sceneItemId: number | undefined,
    sceneItemSourceName: string | undefined
  ): Promise<number> {
    if (typeof sceneItemId === "number" && Number.isFinite(sceneItemId)) {
      return Math.floor(sceneItemId);
    }

    if (!sceneItemSourceName) {
      throw new Error("sceneItemId or sceneItemSourceName is required");
    }

    const payload = await this.config.obsManager.call("GetSceneItemId", {
      sceneName,
      sourceName: sceneItemSourceName
    });

    const resolved = payload.sceneItemId;
    if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
      throw new Error(`Could not resolve scene item ID for "${sceneItemSourceName}" in "${sceneName}"`);
    }

    return Math.floor(resolved);
  }

  private parsePreset(value: unknown, filename: string): ChaosPreset {
    if (!isObject(value)) {
      throw new Error(`Preset file "${filename}" is not a JSON object`);
    }

    const fallbackId = filename.replace(/\.json$/i, "");
    const id = toString(value.id, fallbackId).trim();
    if (!id) {
      throw new Error(`Preset file "${filename}" has an empty id`);
    }

    const name = toString(value.name, id).trim() || id;
    const description = toString(value.description, "").trim() || null;
    const cooldownMs = Math.max(0, Math.floor(toFiniteNumber(value.cooldownMs, 0)));
    const tags = toStringArray(value.tags);
    const rawSteps = Array.isArray(value.steps) ? value.steps : [];
    const steps = rawSteps.map((step, index) => this.parseStep(step, `${filename}:steps[${index}]`));

    if (steps.length === 0) {
      throw new Error(`Preset "${id}" does not have steps`);
    }

    return {
      id,
      name,
      description,
      cooldownMs,
      tags,
      steps
    };
  }

  private parseStep(value: unknown, pathLabel: string): ChaosStep {
    if (!isObject(value)) {
      throw new Error(`Invalid step at ${pathLabel}`);
    }

    const type = toString(value.type);
    if (!type) {
      throw new Error(`Missing step type at ${pathLabel}`);
    }

    const children = Array.isArray(value.steps) ? value.steps : [];

    switch (type) {
      case "serial":
      case "parallel": {
        return {
          type,
          steps: children.map((step, index) => this.parseStep(step, `${pathLabel}:${type}[${index}]`))
        };
      }
      case "sleep": {
        const ms =
          typeof value.ms === "number" && Number.isFinite(value.ms) ? Math.max(0, Math.floor(value.ms)) : undefined;
        const frames =
          typeof value.frames === "number" && Number.isFinite(value.frames)
            ? Math.max(0, Math.floor(value.frames))
            : undefined;
        return { type, ms, frames };
      }
      case "setProgramScene":
      case "setPreviewScene": {
        const sceneName = toString(value.sceneName).trim();
        if (!sceneName) {
          throw new Error(`Missing sceneName at ${pathLabel}`);
        }

        return {
          type,
          sceneName
        };
      }
      case "sceneTransition": {
        return {
          type,
          transitionName: toString(value.transitionName, "").trim() || undefined,
          durationMs:
            typeof value.durationMs === "number" && Number.isFinite(value.durationMs)
              ? Math.max(0, Math.floor(value.durationMs))
              : undefined,
          triggerStudioMode: value.triggerStudioMode === true
        };
      }
      case "sceneItemTransform": {
        const sceneName = toString(value.sceneName).trim();
        if (!sceneName) {
          throw new Error(`Missing sceneName at ${pathLabel}`);
        }

        return {
          type,
          sceneName,
          sceneItemId:
            typeof value.sceneItemId === "number" && Number.isFinite(value.sceneItemId)
              ? Math.floor(value.sceneItemId)
              : undefined,
          sceneItemSourceName: toString(value.sceneItemSourceName, "").trim() || undefined,
          transform: isObject(value.transform) ? value.transform : {}
        };
      }
      case "sceneItemEnabled": {
        const sceneName = toString(value.sceneName).trim();
        if (!sceneName) {
          throw new Error(`Missing sceneName at ${pathLabel}`);
        }

        return {
          type,
          sceneName,
          sceneItemId:
            typeof value.sceneItemId === "number" && Number.isFinite(value.sceneItemId)
              ? Math.floor(value.sceneItemId)
              : undefined,
          sceneItemSourceName: toString(value.sceneItemSourceName, "").trim() || undefined,
          enabled: value.enabled === true
        };
      }
      case "sourceFilter": {
        const sourceName = toString(value.sourceName).trim();
        const filterName = toString(value.filterName).trim();
        if (!sourceName || !filterName) {
          throw new Error(`Missing sourceName/filterName at ${pathLabel}`);
        }

        return {
          type,
          sourceName,
          filterName,
          enabled: typeof value.enabled === "boolean" ? value.enabled : undefined,
          settings: isObject(value.settings) ? value.settings : undefined,
          overlay: value.overlay !== false
        };
      }
      case "obsRequest": {
        const requestType = toString(value.requestType).trim();
        if (!requestType) {
          throw new Error(`Missing requestType at ${pathLabel}`);
        }

        return {
          type,
          requestType,
          requestData: isObject(value.requestData) ? value.requestData : undefined
        };
      }
      case "batch": {
        const rawCalls = Array.isArray(value.calls) ? value.calls : [];
        const calls = rawCalls
          .filter((call): call is Record<string, unknown> => isObject(call))
          .map((call) => ({
            requestType: toString(call.requestType).trim(),
            requestData: isObject(call.requestData) ? call.requestData : undefined
          }))
          .filter((call) => call.requestType.length > 0);

        if (calls.length === 0) {
          throw new Error(`Batch step has no valid calls at ${pathLabel}`);
        }

        return {
          type,
          executionType:
            toString(value.executionType, "").trim() === ""
              ? undefined
              : (toString(value.executionType).trim() as "none" | "serialRealtime" | "serialFrame" | "parallel"),
          haltOnFailure: value.haltOnFailure !== false,
          calls
        };
      }
      default:
        throw new Error(`Unknown step type "${type}" at ${pathLabel}`);
    }
  }

  private emitStatus(): void {
    const snapshot = this.getStatus();
    for (const listener of this.statusListeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.config.logger.error("Chaos status listener failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private emitPresets(): void {
    const list = this.listPresets();
    for (const listener of this.presetListeners) {
      try {
        listener(list);
      } catch (error) {
        this.config.logger.error("Chaos preset listener failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}
