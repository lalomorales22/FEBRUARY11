import type { SafetyStatus } from "../../shared/src/types.js";
import { AppError } from "./errors.js";

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface GuardOptions {
  bypassKillSwitch?: boolean;
  bypassRateLimit?: boolean;
}

export interface ActionGuardResult {
  ok: boolean;
  reason: string | null;
}

export interface SafetyManagerConfig {
  fallbackScene: string | null;
  maxActionsPerWindow: number;
  windowMs: number;
  logger: LoggerLike;
}

type SafetyListener = (status: SafetyStatus) => void;

function nowIso(): string {
  return new Date().toISOString();
}

export class SafetyManager {
  private readonly config: SafetyManagerConfig;
  private readonly listeners = new Set<SafetyListener>();
  private readonly actionTimestamps: number[] = [];

  private killSwitch = false;
  private lastBlockedReason: string | null = null;
  private updatedAt = nowIso();

  constructor(config: SafetyManagerConfig) {
    this.config = config;
  }

  getStatus(): SafetyStatus {
    this.pruneWindow();
    const actionsInWindow = this.actionTimestamps.length;
    const remainingInWindow = Math.max(0, this.config.maxActionsPerWindow - actionsInWindow);

    return {
      killSwitch: this.killSwitch,
      fallbackScene: this.config.fallbackScene,
      actionsInWindow,
      maxActionsPerWindow: this.config.maxActionsPerWindow,
      windowMs: this.config.windowMs,
      remainingInWindow,
      lastBlockedReason: this.lastBlockedReason,
      updatedAt: this.updatedAt
    };
  }

  subscribe(listener: SafetyListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());

    return () => {
      this.listeners.delete(listener);
    };
  }

  setKillSwitch(enabled: boolean, reason?: string): SafetyStatus {
    this.killSwitch = enabled;
    this.updatedAt = nowIso();

    if (enabled) {
      this.lastBlockedReason = reason ?? "Kill switch enabled";
      this.config.logger.warn("Safety kill switch enabled", { reason: this.lastBlockedReason });
    } else {
      this.lastBlockedReason = null;
      this.config.logger.info("Safety kill switch disabled");
    }

    this.emit();
    return this.getStatus();
  }

  guardAction(actionName: string, options: GuardOptions = {}): ActionGuardResult {
    this.pruneWindow();

    if (this.killSwitch && !options.bypassKillSwitch) {
      const reason = `blocked by kill switch (${actionName})`;
      this.lastBlockedReason = reason;
      this.updatedAt = nowIso();
      this.emit();
      return { ok: false, reason };
    }

    if (!options.bypassRateLimit && this.actionTimestamps.length >= this.config.maxActionsPerWindow) {
      const reason = `rate limited (${actionName})`;
      this.lastBlockedReason = reason;
      this.updatedAt = nowIso();
      this.emit();
      return { ok: false, reason };
    }

    if (!options.bypassRateLimit) {
      this.actionTimestamps.push(Date.now());
    }

    this.updatedAt = nowIso();
    this.emit();
    return { ok: true, reason: null };
  }

  assertAction(actionName: string, options: GuardOptions = {}): void {
    const guard = this.guardAction(actionName, options);
    if (!guard.ok) {
      throw new AppError(guard.reason ?? "Action blocked", {
        statusCode: guard.reason?.startsWith("rate limited") ? 429 : 423,
        code: "SAFETY_BLOCKED"
      });
    }
  }

  getFallbackScene(): string | null {
    return this.config.fallbackScene;
  }

  private emit(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (error) {
        this.config.logger.error("Safety listener failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private pruneWindow(): void {
    const cutoff = Date.now() - this.config.windowMs;
    while (this.actionTimestamps.length > 0 && this.actionTimestamps[0] < cutoff) {
      this.actionTimestamps.shift();
    }
  }
}
