import OBSWebSocket from "obs-websocket-js";
import type { ObsStatusSnapshot } from "../../shared/src/types.js";

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface BatchRequest {
  requestType: string;
  requestData?: Record<string, unknown>;
}

interface BatchOptions {
  executionType?: "none" | "serialRealtime" | "serialFrame" | "parallel";
  haltOnFailure?: boolean;
}

export interface ObsManagerConfig {
  host: string;
  port: number;
  password: string;
  reconnectBaseMs: number;
  reconnectMaxMs: number;
  statusPollMs: number;
  logger: LoggerLike;
}

type SnapshotListener = (snapshot: ObsStatusSnapshot) => void;

function readNumber(value: unknown): number | null {
  if (typeof value !== "number") {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return value;
}

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }

  return {};
}

function snapshotNowIso(): string {
  return new Date().toISOString();
}

// Standard event groups + high-volume meter/activity groups.
const EVENT_SUBSCRIPTIONS_MASK = 0x0007ffff;

export class ObsConnectionManager {
  private readonly obs = new OBSWebSocket();
  private readonly config: ObsManagerConfig;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly wsUrl: string;

  private pollTimer: NodeJS.Timeout | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;
  private nextRetryAtMs: number | null = null;
  private started = false;
  private allowReconnect = true;
  private connectInFlight = false;
  private isIdentified = false;

  private snapshot: ObsStatusSnapshot = {
    connection: {
      phase: "idle",
      reconnectAttempt: 0,
      nextRetryInMs: null,
      lastError: null,
      updatedAt: snapshotNowIso()
    },
    streamActive: false,
    streamTimecode: null,
    recordActive: false,
    recordPaused: false,
    recordTimecode: null,
    programSceneName: null,
    stats: {
      cpuUsage: null,
      memoryUsage: null,
      activeFps: null,
      averageFrameTime: null,
      renderTotalFrames: null,
      renderSkippedFrames: null,
      outputTotalFrames: null,
      outputSkippedFrames: null
    },
    updatedAt: snapshotNowIso()
  };

  constructor(config: ObsManagerConfig) {
    this.config = config;
    this.wsUrl = `ws://${config.host}:${config.port}`;

    this.obs.on("ConnectionOpened", () => {
      this.config.logger.info("OBS socket opened", { wsUrl: this.wsUrl });
      this.setConnectionState("connecting");
    });

    this.obs.on("Identified", () => {
      this.config.logger.info("OBS identified", { wsUrl: this.wsUrl });
      this.isIdentified = true;
      this.reconnectAttempt = 0;
      this.nextRetryAtMs = null;
      this.clearReconnectTimer();
      this.setConnectionState("connected", null);
      this.startPolling();
      void this.refreshSnapshot();
    });

    this.obs.on("ConnectionClosed", () => {
      this.config.logger.warn("OBS socket closed");
      this.isIdentified = false;
      this.stopPolling();

      if (!this.allowReconnect) {
        this.setConnectionState("disconnected");
        return;
      }

      this.scheduleReconnect("OBS connection closed");
    });

    this.obs.on("ConnectionError", (error: unknown) => {
      const message = this.stringifyError(error);
      this.config.logger.warn("OBS connection error", { error: message });
      this.setConnectionState("error", message);
    });

    this.obs.on("StreamStateChanged", (event: unknown) => {
      const payload = asRecord(event);
      this.snapshot.streamActive = readBoolean(payload.outputActive);
      this.snapshot.streamTimecode = readString(payload.outputTimecode);
      this.emitSnapshot();
    });

    this.obs.on("RecordStateChanged", (event: unknown) => {
      const payload = asRecord(event);
      this.snapshot.recordActive = readBoolean(payload.outputActive);
      this.snapshot.recordPaused = readBoolean(payload.outputPaused);
      this.snapshot.recordTimecode = readString(payload.outputTimecode);
      this.emitSnapshot();
    });

    this.obs.on("CurrentProgramSceneChanged", (event: unknown) => {
      const payload = asRecord(event);
      this.snapshot.programSceneName = readString(payload.sceneName);
      this.emitSnapshot();
    });
  }

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.allowReconnect = true;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.allowReconnect = false;
    this.isIdentified = false;
    this.stopPolling();
    this.clearReconnectTimer();

    try {
      await this.obs.disconnect();
    } catch {
      // OBS disconnect may throw when already disconnected; ignore.
    }

    this.setConnectionState("disconnected");
  }

  async manualDisconnect(): Promise<void> {
    this.allowReconnect = false;
    await this.stop();
  }

  manualConnect(): void {
    this.allowReconnect = true;
    this.started = true;
    void this.connect();
  }

  forceReconnect(): void {
    this.started = true;
    this.clearReconnectTimer();
    this.stopPolling();
    this.nextRetryAtMs = null;
    this.setConnectionState("reconnecting");

    void (async () => {
      this.allowReconnect = false;
      try {
        await this.obs.disconnect();
      } catch {
        // No-op when already disconnected.
      }

      this.allowReconnect = true;
      void this.connect();
    })();
  }

  getSnapshot(): ObsStatusSnapshot {
    const nextRetryInMs =
      this.nextRetryAtMs === null ? null : Math.max(0, this.nextRetryAtMs - Date.now());

    return {
      ...this.snapshot,
      connection: {
        ...this.snapshot.connection,
        reconnectAttempt: this.reconnectAttempt,
        nextRetryInMs
      },
      stats: { ...this.snapshot.stats }
    };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());

    return () => {
      this.listeners.delete(listener);
    };
  }

  isConnected(): boolean {
    return this.isIdentified && this.snapshot.connection.phase === "connected";
  }

  onEvent(eventName: string, listener: (event: unknown) => void): () => void {
    const wrapped = (event: unknown): void => {
      listener(event);
    };

    this.obs.on(eventName as never, wrapped as never);

    return () => {
      this.obs.off(eventName as never, wrapped as never);
    };
  }

  async call(requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (!this.isConnected()) {
      throw new Error("OBS is not connected");
    }

    const response = await this.obs.call(requestType as never, requestData as never);
    return asRecord(response);
  }

  async callBatch(requests: BatchRequest[], options?: BatchOptions): Promise<unknown[]> {
    if (!this.isConnected()) {
      throw new Error("OBS is not connected");
    }

    const response = await this.obs.callBatch(
      requests.map((request) => ({
        requestType: request.requestType,
        requestData: request.requestData ?? {}
      })) as never,
      options as never
    );

    if (Array.isArray(response)) {
      return response;
    }

    return [];
  }

  private async connect(): Promise<void> {
    if (!this.started || !this.allowReconnect || this.connectInFlight) {
      return;
    }

    this.connectInFlight = true;
    this.setConnectionState(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");

    try {
      await this.obs.connect(this.wsUrl, this.config.password || undefined, {
        eventSubscriptions: EVENT_SUBSCRIPTIONS_MASK
      });
    } catch (error) {
      this.isIdentified = false;
      const message = this.stringifyError(error);
      this.config.logger.warn("OBS connect failed", {
        wsUrl: this.wsUrl,
        error: message,
        reconnectAttempt: this.reconnectAttempt
      });
      this.setConnectionState("error", message);
      this.scheduleReconnect(message);
    } finally {
      this.connectInFlight = false;
    }
  }

  private scheduleReconnect(reason: string): void {
    if (!this.started || !this.allowReconnect) {
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    this.reconnectAttempt += 1;

    const exponentialDelay = Math.min(
      this.config.reconnectMaxMs,
      Math.round(this.config.reconnectBaseMs * Math.pow(1.8, this.reconnectAttempt - 1))
    );
    const jitter = Math.round(exponentialDelay * 0.15 * Math.random());
    const delayMs = Math.min(this.config.reconnectMaxMs, exponentialDelay + jitter);

    this.nextRetryAtMs = Date.now() + delayMs;
    this.setConnectionState("reconnecting", reason);

    this.config.logger.info("Scheduling OBS reconnect", {
      reconnectAttempt: this.reconnectAttempt,
      delayMs
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.nextRetryAtMs = null;
      void this.connect();
    }, delayMs);
  }

  private setConnectionState(
    phase: ObsStatusSnapshot["connection"]["phase"],
    lastError: string | null = null
  ): void {
    this.snapshot.connection = {
      phase,
      reconnectAttempt: this.reconnectAttempt,
      nextRetryInMs:
        this.nextRetryAtMs === null ? null : Math.max(this.nextRetryAtMs - Date.now(), 0),
      lastError,
      updatedAt: snapshotNowIso()
    };
    this.emitSnapshot();
  }

  private startPolling(): void {
    this.stopPolling();
    this.pollTimer = setInterval(() => {
      void this.refreshSnapshot();
    }, this.config.statusPollMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private async refreshSnapshot(): Promise<void> {
    if (!this.isIdentified) {
      return;
    }

    const [stream, record, scene, stats] = await Promise.allSettled([
      this.obs.call("GetStreamStatus"),
      this.obs.call("GetRecordStatus"),
      this.obs.call("GetCurrentProgramScene"),
      this.obs.call("GetStats")
    ]);

    if (stream.status === "fulfilled") {
      const payload = asRecord(stream.value);
      this.snapshot.streamActive = readBoolean(payload.outputActive);
      this.snapshot.streamTimecode = readString(payload.outputTimecode);
    }

    if (record.status === "fulfilled") {
      const payload = asRecord(record.value);
      this.snapshot.recordActive = readBoolean(payload.outputActive);
      this.snapshot.recordPaused = readBoolean(payload.outputPaused);
      this.snapshot.recordTimecode = readString(payload.outputTimecode);
    }

    if (scene.status === "fulfilled") {
      const payload = asRecord(scene.value);
      this.snapshot.programSceneName = readString(payload.currentProgramSceneName);
    }

    if (stats.status === "fulfilled") {
      const payload = asRecord(stats.value);
      this.snapshot.stats = {
        cpuUsage: readNumber(payload.cpuUsage),
        memoryUsage: readNumber(payload.memoryUsage),
        activeFps: readNumber(payload.activeFps),
        averageFrameTime: readNumber(payload.averageFrameRenderTime),
        renderTotalFrames: readNumber(payload.renderTotalFrames),
        renderSkippedFrames: readNumber(payload.renderSkippedFrames),
        outputTotalFrames: readNumber(payload.outputTotalFrames),
        outputSkippedFrames: readNumber(payload.outputSkippedFrames)
      };
    }

    this.emitSnapshot();
  }

  private emitSnapshot(): void {
    this.snapshot.updatedAt = snapshotNowIso();
    const outbound = this.getSnapshot();

    for (const listener of this.listeners) {
      try {
        listener(outbound);
      } catch (error) {
        this.config.logger.error("Snapshot listener failed", {
          error: this.stringifyError(error)
        });
      }
    }
  }

  private stringifyError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "string") {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown OBS error";
    }
  }
}
