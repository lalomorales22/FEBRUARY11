import { promises as fs } from "node:fs";

import type { AutoDirectorLevel, AutoDirectorRule, AutoDirectorStatus } from "../../shared/src/types.js";
import { AppError } from "./errors.js";
import type { ObsConnectionManager } from "./obs-manager.js";
import type { SafetyManager } from "./safety-manager.js";

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface MeterPoint {
  inputName: string;
  levelDb: number;
  seenAtMs: number;
}

interface PendingCandidate {
  ruleId: string;
  sinceMs: number;
}

export interface AutoDirectorConfig {
  rulesPath: string;
  obsManager: ObsConnectionManager;
  safetyManager: SafetyManager;
  logger: LoggerLike;
}

type AutoDirectorListener = (status: AutoDirectorStatus) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, value));
}

function getPeakDb(levels: unknown): number | null {
  const queue: unknown[] = [levels];
  let peak: number | null = null;

  while (queue.length > 0) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      for (const child of current) {
        queue.push(child);
      }
      continue;
    }

    if (typeof current !== "number" || !Number.isFinite(current)) {
      continue;
    }

    if (peak === null || current > peak) {
      peak = current;
    }
  }

  return peak;
}

function normalizeInputKey(value: string): string {
  return value.trim().toLowerCase();
}

export class AutoDirector {
  private readonly config: AutoDirectorConfig;
  private readonly listeners = new Set<AutoDirectorListener>();
  private readonly meterByInput = new Map<string, MeterPoint>();
  private readonly resolvedInputNames = new Map<string, string>();

  private unsubscribeMeters: (() => void) | null = null;
  private meterPollTimer: NodeJS.Timeout | null = null;
  private activeRuleId: string | null = null;
  private pending: PendingCandidate | null = null;
  private lastSwitchAtMs = 0;
  private lastDecision: string | null = null;
  private switchInFlight = false;
  private lastEmitMs = 0;
  private lastInputAliasRefreshMs = 0;

  private enabled = false;
  private switchCooldownMs = 2500;
  private hysteresisDb = 3;
  private defaultHoldMs = 900;
  private rules: AutoDirectorRule[] = [];

  constructor(config: AutoDirectorConfig) {
    this.config = config;
  }

  async init(): Promise<void> {
    await this.reloadRules();
    this.start();
  }

  start(): void {
    if (this.unsubscribeMeters) {
      return;
    }

    this.unsubscribeMeters = this.config.obsManager.onEvent("InputVolumeMeters", (event) => {
      this.onVolumeMeters(event);
    });
    this.startPollingFallback();
  }

  stop(): void {
    if (this.unsubscribeMeters) {
      this.unsubscribeMeters();
      this.unsubscribeMeters = null;
    }
    this.stopPollingFallback();
  }

  async reloadRules(): Promise<AutoDirectorStatus> {
    const raw = await fs.readFile(this.config.rulesPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new AppError("AutoDirector rules file must be a JSON object", {
        statusCode: 400,
        code: "AUTO_DIRECTOR_RULES_INVALID"
      });
    }

    this.switchCooldownMs = clampNumber(parsed.switchCooldownMs, 2500, 250, 15000);
    this.hysteresisDb = clampNumber(parsed.hysteresisDb, 3, 0, 24);
    this.defaultHoldMs = clampNumber(parsed.defaultHoldMs, 900, 0, 8000);
    this.enabled = parsed.enabled === true;
    this.rules = this.parseRules(parsed.rules);

    this.lastDecision = "rules-reloaded";
    this.emit(true);
    return this.getStatus();
  }

  setEnabled(enabled: boolean): AutoDirectorStatus {
    this.enabled = enabled;
    this.pending = null;
    if (!enabled) {
      this.activeRuleId = null;
    }
    this.lastDecision = enabled ? "enabled" : "disabled";
    this.emit(true);
    return this.getStatus();
  }

  getStatus(): AutoDirectorStatus {
    return {
      enabled: this.enabled,
      switchCooldownMs: this.switchCooldownMs,
      hysteresisDb: this.hysteresisDb,
      defaultHoldMs: this.defaultHoldMs,
      activeRuleId: this.activeRuleId,
      pendingRuleId: this.pending?.ruleId ?? null,
      lastSwitchAt: this.lastSwitchAtMs > 0 ? new Date(this.lastSwitchAtMs).toISOString() : null,
      lastDecision: this.lastDecision,
      rules: this.rules.map((rule) => ({ ...rule })),
      topInputLevels: this.getTopInputLevels(),
      updatedAt: nowIso()
    };
  }

  subscribe(listener: AutoDirectorListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private parseRules(value: unknown): AutoDirectorRule[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const rules: AutoDirectorRule[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const rawRule = value[index];
      if (!isRecord(rawRule)) {
        continue;
      }

      const inputName =
        typeof rawRule.inputName === "string" ? rawRule.inputName.trim() : "";
      const sceneName =
        typeof rawRule.sceneName === "string" ? rawRule.sceneName.trim() : "";

      if (!inputName || !sceneName) {
        continue;
      }

      const id =
        typeof rawRule.id === "string" && rawRule.id.trim().length > 0
          ? rawRule.id.trim()
          : `${inputName.toLowerCase().replaceAll(/\s+/g, "_")}__${sceneName
              .toLowerCase()
              .replaceAll(/\s+/g, "_")}__${index + 1}`;

      rules.push({
        id,
        inputName,
        sceneName,
        activationDb: clampNumber(rawRule.activationDb, -32, -90, 0),
        priority: clampNumber(rawRule.priority, 50, 0, 1000),
        holdMs:
          typeof rawRule.holdMs === "number" && Number.isFinite(rawRule.holdMs)
            ? Math.max(0, Math.min(10000, Math.floor(rawRule.holdMs)))
            : null
      });
    }

    return rules;
  }

  private onVolumeMeters(event: unknown): void {
    const payload = isRecord(event) ? event : null;
    if (!payload) {
      return;
    }

    const inputs = Array.isArray(payload.inputs) ? payload.inputs : [];
    const nowMs = Date.now();
    for (const input of inputs) {
      if (!isRecord(input)) {
        continue;
      }

      const inputName = typeof input.inputName === "string" ? input.inputName : "";
      if (!inputName) {
        continue;
      }

      const peakDb = getPeakDb(input.inputLevelsDb);
      if (peakDb === null) {
        continue;
      }

      const normalized = normalizeInputKey(inputName);
      this.resolvedInputNames.set(normalized, inputName);
      this.meterByInput.set(normalized, {
        inputName,
        levelDb: peakDb,
        seenAtMs: nowMs
      });
    }

    void this.evaluate(nowMs);
  }

  private async evaluate(nowMs: number): Promise<void> {
    if (!this.enabled || this.rules.length === 0) {
      return;
    }

    if (this.switchInFlight) {
      return;
    }

    if (this.config.safetyManager.getStatus().killSwitch) {
      this.lastDecision = "blocked:kill-switch";
      this.emit();
      return;
    }

    if (nowMs - this.lastSwitchAtMs < this.switchCooldownMs) {
      return;
    }

    const candidates = this.rules
      .map((rule) => {
        const meter = this.meterByInput.get(normalizeInputKey(rule.inputName));
        const levelDb = meter?.levelDb ?? Number.NEGATIVE_INFINITY;
        const seenAtMs = meter?.seenAtMs ?? 0;
        return {
          rule,
          levelDb,
          seenAtMs
        };
      })
      .filter((candidate) => nowMs - candidate.seenAtMs <= 1800)
      .filter((candidate) => candidate.levelDb >= candidate.rule.activationDb)
      .sort((a, b) => {
        if (b.rule.priority !== a.rule.priority) {
          return b.rule.priority - a.rule.priority;
        }
        return b.levelDb - a.levelDb;
      });

    if (candidates.length === 0) {
      this.pending = null;
      this.lastDecision = "no-candidate";
      this.emit();
      return;
    }

    const top = candidates[0];
    const currentScene = this.config.obsManager.getSnapshot().programSceneName;
    const activeRule = this.activeRuleId
      ? this.rules.find((rule) => rule.id === this.activeRuleId) ?? null
      : null;

    if (activeRule && activeRule.id === top.rule.id) {
      this.pending = null;
      this.lastDecision = `holding:${top.rule.id}`;
      this.emit();
      return;
    }

    if (activeRule && activeRule.id !== top.rule.id) {
      const normalizedActiveKey = normalizeInputKey(activeRule.inputName);
      const activeMeterResolved = this.meterByInput.get(normalizedActiveKey);
      const activeDb = activeMeterResolved?.levelDb ?? Number.NEGATIVE_INFINITY;
      if (top.levelDb < activeDb + this.hysteresisDb) {
        this.pending = null;
        this.lastDecision = `hysteresis-hold:${activeRule.id}`;
        this.emit();
        return;
      }
    }

    if (!this.pending || this.pending.ruleId !== top.rule.id) {
      this.pending = { ruleId: top.rule.id, sinceMs: nowMs };
      this.lastDecision = `pending:${top.rule.id}`;
      this.emit();
      return;
    }

    const holdMs = top.rule.holdMs ?? this.defaultHoldMs;
    if (nowMs - this.pending.sinceMs < holdMs) {
      return;
    }

    if (currentScene === top.rule.sceneName) {
      this.activeRuleId = top.rule.id;
      this.pending = null;
      this.lastDecision = `scene-already-live:${top.rule.sceneName}`;
      this.emit(true);
      return;
    }

    const guard = this.config.safetyManager.guardAction(`auto-director:${top.rule.id}`);
    if (!guard.ok) {
      this.pending = null;
      this.lastDecision = `blocked:${guard.reason ?? "unknown"}`;
      this.emit(true);
      return;
    }

    this.switchInFlight = true;
    try {
      await this.config.obsManager.call("SetCurrentProgramScene", {
        sceneName: top.rule.sceneName
      });
      this.lastSwitchAtMs = Date.now();
      this.activeRuleId = top.rule.id;
      this.pending = null;
      this.lastDecision = `switch:${top.rule.sceneName}`;
      this.emit(true);
    } catch (error) {
      this.lastDecision = `error:${error instanceof Error ? error.message : String(error)}`;
      this.emit(true);
    } finally {
      this.switchInFlight = false;
    }
  }

  private startPollingFallback(): void {
    if (this.meterPollTimer) {
      return;
    }

    this.meterPollTimer = setInterval(() => {
      void this.pollRuleInputs();
    }, 700);
  }

  private stopPollingFallback(): void {
    if (this.meterPollTimer) {
      clearInterval(this.meterPollTimer);
      this.meterPollTimer = null;
    }
  }

  private async pollRuleInputs(): Promise<void> {
    if (this.rules.length === 0 || !this.enabled) {
      return;
    }

    if (!this.config.obsManager.isConnected()) {
      return;
    }

    const nowMs = Date.now();
    await this.refreshInputAliases(nowMs);

    const uniqueRuleInputs = new Map<string, string>();
    for (const rule of this.rules) {
      const key = normalizeInputKey(rule.inputName);
      if (!uniqueRuleInputs.has(key)) {
        uniqueRuleInputs.set(key, rule.inputName);
      }
    }

    for (const [normalized, configuredName] of uniqueRuleInputs.entries()) {
      const inputName = this.resolvedInputNames.get(normalized) ?? configuredName;
      try {
        const payload = await this.config.obsManager.call("GetInputVolume", { inputName });
        const levelDb = this.extractVolumeDb(payload);
        if (levelDb === null) {
          continue;
        }

        this.resolvedInputNames.set(normalized, inputName);
        this.meterByInput.set(normalized, {
          inputName,
          levelDb,
          seenAtMs: nowMs
        });
      } catch {
        // Ignore missing/invalid inputs; rule matching will skip stale entries.
      }
    }

    void this.evaluate(nowMs);
  }

  private async refreshInputAliases(nowMs: number): Promise<void> {
    if (nowMs - this.lastInputAliasRefreshMs < 10_000) {
      return;
    }
    this.lastInputAliasRefreshMs = nowMs;

    try {
      const payload = await this.config.obsManager.call("GetInputList");
      const inputs = Array.isArray(payload.inputs) ? payload.inputs : [];
      for (const input of inputs) {
        if (!isRecord(input)) {
          continue;
        }
        const inputName =
          typeof input.inputName === "string" && input.inputName.trim().length > 0
            ? input.inputName.trim()
            : "";
        if (!inputName) {
          continue;
        }
        this.resolvedInputNames.set(normalizeInputKey(inputName), inputName);
      }
    } catch {
      // Ignore list refresh errors; direct lookup can still succeed.
    }
  }

  private extractVolumeDb(payload: Record<string, unknown>): number | null {
    const db = payload.inputVolumeDb;
    if (typeof db === "number" && Number.isFinite(db)) {
      return db;
    }

    const mul = payload.inputVolumeMul;
    if (typeof mul === "number" && Number.isFinite(mul) && mul > 0) {
      return 20 * Math.log10(mul);
    }

    return null;
  }

  private getTopInputLevels(): AutoDirectorLevel[] {
    return [...this.meterByInput.entries()]
      .sort((a, b) => b[1].levelDb - a[1].levelDb)
      .slice(0, 6)
      .map(([, meter]) => ({
        inputName: meter.inputName,
        levelDb: meter.levelDb,
        seenAt: new Date(meter.seenAtMs).toISOString()
      }));
  }

  private emit(force = false): void {
    const nowMs = Date.now();
    if (!force && nowMs - this.lastEmitMs < 300) {
      return;
    }
    this.lastEmitMs = nowMs;

    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.config.logger.error("AutoDirector listener failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}
