import type { OverlayBridgeStatus } from "../../shared/src/types.js";
import { AppError } from "./errors.js";

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface OverlayBridgeConfig {
  enabled: boolean;
  baseUrl: string;
  requestTimeoutMs: number;
  logger: LoggerLike;
}

type OverlayListener = (status: OverlayBridgeStatus) => void;

interface OverlayLinks {
  dashboard: string;
  scene: string;
  alerts: string;
  chat: string;
  stats: string;
  keyboard: string;
  subtitles: string;
  avatar: string;
  tracker: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "http://127.0.0.1:5555";
  }
  return trimmed.replace(/\/+$/g, "");
}

export class OverlayBridge {
  private readonly config: OverlayBridgeConfig;
  private readonly listeners = new Set<OverlayListener>();

  private status: OverlayBridgeStatus;

  constructor(config: OverlayBridgeConfig) {
    this.config = {
      ...config,
      baseUrl: normalizeBaseUrl(config.baseUrl)
    };

    this.status = {
      enabled: config.enabled,
      baseUrl: this.config.baseUrl,
      reachable: false,
      lastCheckedAt: null,
      lastError: null,
      updatedAt: nowIso()
    };
  }

  getStatus(): OverlayBridgeStatus {
    return { ...this.status };
  }

  getLinks(): OverlayLinks {
    return {
      dashboard: `${this.config.baseUrl}/dashboard`,
      scene: `${this.config.baseUrl}/overlay/scene`,
      alerts: `${this.config.baseUrl}/overlay/alerts`,
      chat: `${this.config.baseUrl}/overlay/chat`,
      stats: `${this.config.baseUrl}/overlay/stats`,
      keyboard: `${this.config.baseUrl}/overlay/keyboard`,
      subtitles: `${this.config.baseUrl}/overlay/subtitles`,
      avatar: `${this.config.baseUrl}/overlay/avatar`,
      tracker: `${this.config.baseUrl}/overlay/tracker`
    };
  }

  subscribe(listener: OverlayListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async probe(): Promise<OverlayBridgeStatus> {
    if (!this.config.enabled) {
      this.status = {
        ...this.status,
        reachable: false,
        lastCheckedAt: nowIso(),
        lastError: null,
        updatedAt: nowIso()
      };
      this.emit();
      return this.getStatus();
    }

    try {
      await this.request("GET", "/api/stats");
    } catch (error) {
      this.config.logger.debug("Overlay probe failed", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return this.getStatus();
  }

  async testAlert(options: { type: string; username: string; viewers?: number }): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/test-alert", {
      type: options.type,
      username: options.username,
      viewers: options.viewers
    });
  }

  async testChat(options: {
    username: string;
    message: string;
    color?: string;
  }): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/test-chat", {
      username: options.username,
      message: options.message,
      color: options.color
    });
  }

  async getScenes(): Promise<Record<string, unknown>> {
    return this.request("GET", "/api/scenes");
  }

  async switchScene(scene: string): Promise<Record<string, unknown>> {
    if (!scene.trim()) {
      throw new AppError("scene is required", {
        statusCode: 400,
        code: "OVERLAYS_SCENE_REQUIRED"
      });
    }
    return this.request("POST", "/api/scene", { scene });
  }

  async startStream(): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/start-stream", {});
  }

  async updateSubtitleSettings(options: {
    fontFamily?: string;
    fontSizePx?: number;
    textColor?: string;
    backgroundColor?: string;
    backgroundOpacity?: number;
  }): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/subtitles/settings", {
      font_family: options.fontFamily,
      font_size_px: options.fontSizePx,
      text_color: options.textColor,
      background_color: options.backgroundColor,
      background_opacity: options.backgroundOpacity
    });
  }

  async pushSubtitle(options: { text: string; final?: boolean }): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/subtitles/push", {
      text: options.text,
      final: options.final !== false
    });
  }

  async clearSubtitle(): Promise<Record<string, unknown>> {
    return this.request("POST", "/api/subtitles/clear", {});
  }

  private async request(
    method: "GET" | "POST",
    routePath: string,
    body?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (!this.config.enabled) {
      throw new AppError("OBS overlays integration is disabled", {
        statusCode: 503,
        code: "OVERLAYS_DISABLED"
      });
    }

    const path = routePath.startsWith("/") ? routePath : `/${routePath}`;
    const url = `${this.config.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: method === "POST" ? { "content-type": "application/json" } : undefined,
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
        signal: controller.signal
      });

      const raw = await response.text();
      const payload = raw.trim().length > 0 ? asRecord(JSON.parse(raw)) : {};

      if (!response.ok) {
        const upstreamMessage =
          typeof payload.message === "string" && payload.message.trim().length > 0
            ? payload.message.trim()
            : `status ${response.status}`;
        const message = `OBS-overlays upstream error: ${upstreamMessage}`;
        this.markUnreachable(message);
        throw new AppError(message, {
          statusCode: 502,
          code: "OVERLAYS_UPSTREAM_FAILED"
        });
      }

      this.markReachable();
      return payload;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const message =
        error instanceof Error && error.name === "AbortError"
          ? `OBS-overlays request timeout after ${this.config.requestTimeoutMs}ms`
          : `OBS-overlays unavailable: ${error instanceof Error ? error.message : String(error)}`;

      this.markUnreachable(message);
      throw new AppError(message, {
        statusCode: 502,
        code: "OVERLAYS_UNAVAILABLE"
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private markReachable(): void {
    this.status = {
      ...this.status,
      reachable: true,
      lastCheckedAt: nowIso(),
      lastError: null,
      updatedAt: nowIso()
    };
    this.emit();
  }

  private markUnreachable(message: string): void {
    this.status = {
      ...this.status,
      reachable: false,
      lastCheckedAt: nowIso(),
      lastError: message,
      updatedAt: nowIso()
    };
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.config.logger.error("OverlayBridge listener failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}
