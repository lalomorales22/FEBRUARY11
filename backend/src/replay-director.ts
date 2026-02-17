import path from "node:path";

import type { ReplayCaptureResult, ReplayDirectorStatus } from "../../shared/src/types.js";
import { AppError } from "./errors.js";
import type { ObsConnectionManager } from "./obs-manager.js";
import type { SafetyManager } from "./safety-manager.js";

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface ReplayDirectorConfig {
  obsManager: ObsConnectionManager;
  safetyManager: SafetyManager;
  logger: LoggerLike;
  mediaInputName: string | null;
  lowerThirdInputName: string | null;
  lowerThirdSceneName: string | null;
  lowerThirdDurationMs: number;
  lowerThirdTemplate: string;
  captureWaitMs: number;
  autoStartBuffer: boolean;
  createRecordChapter: boolean;
  chapterPrefix: string;
}

interface OverlaySceneCache {
  sceneName: string;
  sourceName: string;
  sceneItemId: number;
}

type ReplayListener = (status: ReplayDirectorStatus) => void;

function nowIso(): string {
  return new Date().toISOString();
}

function parseReplayPath(payload: Record<string, unknown>): string | null {
  const keys = [
    "savedReplayPath",
    "lastReplayPath",
    "lastReplayBufferReplayPath",
    "outputPath",
    "path"
  ];

  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

export class ReplayDirector {
  private readonly config: ReplayDirectorConfig;
  private readonly listeners = new Set<ReplayListener>();

  private overlaySceneCache: OverlaySceneCache | null = null;
  private overlayHideTimer: NodeJS.Timeout | undefined;
  private unsubReplayBufferState: (() => void) | null = null;

  private status: ReplayDirectorStatus;

  constructor(config: ReplayDirectorConfig) {
    this.config = config;
    this.status = {
      replayBufferActive: false,
      lastCaptureAt: null,
      lastReplayPath: null,
      lastLabel: null,
      playbackTriggered: false,
      chapterCreated: false,
      overlayVisible: false,
      lastError: null,
      mediaInputName: config.mediaInputName,
      lowerThirdInputName: config.lowerThirdInputName,
      lowerThirdSceneName: config.lowerThirdSceneName,
      updatedAt: nowIso()
    };
  }

  async init(): Promise<void> {
    if (!this.unsubReplayBufferState) {
      this.unsubReplayBufferState = this.config.obsManager.onEvent("ReplayBufferStateChanged", (event) => {
        if (event && typeof event === "object") {
          const payload = event as Record<string, unknown>;
          this.status.replayBufferActive = payload.outputActive === true;
          this.touch();
        }
      });
    }

    await this.refreshReplayBufferStatus();
  }

  stop(): void {
    if (this.overlayHideTimer) {
      clearTimeout(this.overlayHideTimer);
      this.overlayHideTimer = undefined;
    }
    if (this.unsubReplayBufferState) {
      this.unsubReplayBufferState();
      this.unsubReplayBufferState = null;
    }
  }

  getStatus(): ReplayDirectorStatus {
    return { ...this.status };
  }

  subscribe(listener: ReplayListener): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async captureReplay(labelInput?: string): Promise<ReplayCaptureResult> {
    this.config.safetyManager.assertAction("replay:capture");

    const label = this.buildReplayLabel(labelInput);
    let replayPath: string | null = null;
    let playbackTriggered = false;
    let chapterCreated = false;
    let overlayShown = false;

    try {
      const isBufferActive = await this.ensureReplayBufferReady();
      this.status.replayBufferActive = isBufferActive;

      await this.config.obsManager.call("SaveReplayBuffer");
      await this.sleep(this.config.captureWaitMs);

      const replayResponse = await this.config.obsManager.call("GetLastReplayBufferReplay");
      replayPath = parseReplayPath(replayResponse);
      this.status.lastReplayPath = replayPath;

      if (replayPath && this.config.mediaInputName) {
        try {
          await this.loadReplayIntoMediaInput(replayPath);
          playbackTriggered = true;
        } catch (error) {
          this.config.logger.warn("Replay playback trigger failed", {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      try {
        overlayShown = await this.showLowerThird(label, replayPath);
      } catch (error) {
        this.config.logger.warn("Replay lower-third failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      if (this.config.createRecordChapter) {
        try {
          chapterCreated = await this.createChapter(label);
        } catch (error) {
          this.config.logger.warn("Replay chapter creation failed", {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      this.status = {
        ...this.status,
        lastCaptureAt: nowIso(),
        lastLabel: label,
        playbackTriggered,
        chapterCreated,
        overlayVisible: overlayShown ? this.status.overlayVisible : false,
        lastError: null,
        updatedAt: nowIso()
      };
      this.emit();

      return {
        capturedAt: this.status.lastCaptureAt ?? nowIso(),
        label,
        replayPath,
        playbackTriggered,
        chapterCreated,
        overlayShown
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status = {
        ...this.status,
        lastError: message,
        updatedAt: nowIso()
      };
      this.emit();

      throw new AppError(`Replay capture failed: ${message}`, {
        statusCode: 500,
        code: "REPLAY_CAPTURE_FAILED"
      });
    }
  }

  async hideOverlay(): Promise<void> {
    if (!this.config.lowerThirdSceneName || !this.config.lowerThirdInputName) {
      this.status.overlayVisible = false;
      this.touch();
      return;
    }

    const sceneItemId = await this.resolveOverlaySceneItemId();
    await this.config.obsManager.call("SetSceneItemEnabled", {
      sceneName: this.config.lowerThirdSceneName,
      sceneItemId,
      sceneItemEnabled: false
    });
    this.status.overlayVisible = false;
    this.touch();
  }

  private async refreshReplayBufferStatus(): Promise<void> {
    try {
      const payload = await this.config.obsManager.call("GetReplayBufferStatus");
      this.status.replayBufferActive = payload.outputActive === true;
      this.touch();
    } catch (error) {
      this.config.logger.debug("Replay status refresh skipped", {
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async ensureReplayBufferReady(): Promise<boolean> {
    const payload = await this.config.obsManager.call("GetReplayBufferStatus");
    const active = payload.outputActive === true;
    if (active) {
      return true;
    }

    if (!this.config.autoStartBuffer) {
      throw new AppError("Replay buffer is not active", {
        statusCode: 409,
        code: "REPLAY_BUFFER_INACTIVE"
      });
    }

    await this.config.obsManager.call("StartReplayBuffer");
    await this.sleep(450);
    return true;
  }

  private async loadReplayIntoMediaInput(replayPath: string): Promise<void> {
    if (!this.config.mediaInputName) {
      return;
    }

    await this.config.obsManager.call("SetInputSettings", {
      inputName: this.config.mediaInputName,
      inputSettings: {
        local_file: replayPath
      },
      overlay: true
    });

    await this.config.obsManager.call("TriggerMediaInputAction", {
      inputName: this.config.mediaInputName,
      mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART"
    });
  }

  private async showLowerThird(label: string, replayPath: string | null): Promise<boolean> {
    if (!this.config.lowerThirdInputName) {
      return false;
    }

    const timestamp = new Date().toLocaleTimeString();
    const fileName = replayPath ? path.basename(replayPath) : "unknown";
    const text = this.config.lowerThirdTemplate
      .replaceAll("{label}", label)
      .replaceAll("{time}", timestamp)
      .replaceAll("{file}", fileName)
      .replaceAll("{date}", nowIso());

    await this.config.obsManager.call("SetInputSettings", {
      inputName: this.config.lowerThirdInputName,
      inputSettings: {
        text
      },
      overlay: true
    });

    if (!this.config.lowerThirdSceneName) {
      this.status.overlayVisible = false;
      this.touch();
      return true;
    }

    const sceneItemId = await this.resolveOverlaySceneItemId();
    await this.config.obsManager.call("SetSceneItemEnabled", {
      sceneName: this.config.lowerThirdSceneName,
      sceneItemId,
      sceneItemEnabled: true
    });
    this.status.overlayVisible = true;
    this.touch();
    this.scheduleOverlayHide();
    return true;
  }

  private async createChapter(label: string): Promise<boolean> {
    const recordStatus = await this.config.obsManager.call("GetRecordStatus");
    if (recordStatus.outputActive !== true) {
      return false;
    }

    await this.config.obsManager.call("CreateRecordChapter", {
      chapterName: `${this.config.chapterPrefix} ${label}`.trim()
    });
    return true;
  }

  private scheduleOverlayHide(): void {
    if (this.overlayHideTimer) {
      clearTimeout(this.overlayHideTimer);
    }

    this.overlayHideTimer = setTimeout(() => {
      void this.hideOverlay().catch((error) => {
        this.config.logger.warn("Overlay auto-hide failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, this.config.lowerThirdDurationMs);
  }

  private async resolveOverlaySceneItemId(): Promise<number> {
    if (!this.config.lowerThirdSceneName || !this.config.lowerThirdInputName) {
      throw new AppError("Replay overlay scene/input not configured", {
        statusCode: 400,
        code: "REPLAY_OVERLAY_NOT_CONFIGURED"
      });
    }

    if (
      this.overlaySceneCache &&
      this.overlaySceneCache.sceneName === this.config.lowerThirdSceneName &&
      this.overlaySceneCache.sourceName === this.config.lowerThirdInputName
    ) {
      return this.overlaySceneCache.sceneItemId;
    }

    const payload = await this.config.obsManager.call("GetSceneItemId", {
      sceneName: this.config.lowerThirdSceneName,
      sourceName: this.config.lowerThirdInputName
    });

    const sceneItemId = payload.sceneItemId;
    if (typeof sceneItemId !== "number" || !Number.isFinite(sceneItemId)) {
      throw new AppError("Could not resolve replay overlay scene item ID", {
        statusCode: 500,
        code: "REPLAY_OVERLAY_RESOLVE_FAILED"
      });
    }

    this.overlaySceneCache = {
      sceneName: this.config.lowerThirdSceneName,
      sourceName: this.config.lowerThirdInputName,
      sceneItemId: Math.floor(sceneItemId)
    };

    return this.overlaySceneCache.sceneItemId;
  }

  private buildReplayLabel(labelInput?: string): string {
    const trimmed = (labelInput ?? "").trim();
    if (trimmed.length > 0) {
      return trimmed.slice(0, 64);
    }

    const now = new Date();
    const hh = `${now.getHours()}`.padStart(2, "0");
    const mm = `${now.getMinutes()}`.padStart(2, "0");
    const ss = `${now.getSeconds()}`.padStart(2, "0");
    return `Highlight ${hh}:${mm}:${ss}`;
  }

  private async sleep(ms: number): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), ms);
    });
  }

  private touch(): void {
    this.status.updatedAt = nowIso();
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        this.config.logger.error("Replay listener failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
}
