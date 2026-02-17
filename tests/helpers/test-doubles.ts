import type { ObsStatusSnapshot } from "../../shared/src/types.js";

type EventListener = (event: unknown) => void;

interface BatchRequest {
  requestType: string;
  requestData?: Record<string, unknown>;
}

interface BatchOptions {
  executionType?: "none" | "serialRealtime" | "serialFrame" | "parallel";
  haltOnFailure?: boolean;
}

type ResponseResolver =
  | Record<string, unknown>
  | ((requestData?: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>);

function nowIso(): string {
  return new Date().toISOString();
}

function cloneSnapshot(snapshot: ObsStatusSnapshot): ObsStatusSnapshot {
  return {
    ...snapshot,
    connection: { ...snapshot.connection },
    stats: { ...snapshot.stats }
  };
}

export function createTestLogger(): {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
} {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined
  };
}

export class MockObsManager {
  public calls: Array<{ requestType: string; requestData?: Record<string, unknown> }> = [];
  public batchCalls: Array<{ requests: BatchRequest[]; options?: BatchOptions }> = [];

  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly responseByRequestType = new Map<string, ResponseResolver>();
  private readonly errorByRequestType = new Map<string, Error>();

  private snapshot: ObsStatusSnapshot = {
    connection: {
      phase: "connected",
      reconnectAttempt: 0,
      nextRetryInMs: null,
      lastError: null,
      updatedAt: nowIso()
    },
    streamActive: false,
    streamTimecode: null,
    recordActive: false,
    recordPaused: false,
    recordTimecode: null,
    programSceneName: "InitialScene",
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
    updatedAt: nowIso()
  };

  setSnapshot(value: Partial<ObsStatusSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...value,
      connection: {
        ...this.snapshot.connection,
        ...(value.connection ?? {})
      },
      stats: {
        ...this.snapshot.stats,
        ...(value.stats ?? {})
      },
      updatedAt: nowIso()
    };
  }

  getSnapshot(): ObsStatusSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  isConnected(): boolean {
    return true;
  }

  onEvent(eventName: string, listener: EventListener): () => void {
    const listeners = this.listeners.get(eventName) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(eventName, listeners);

    return () => {
      const active = this.listeners.get(eventName);
      if (!active) {
        return;
      }
      active.delete(listener);
      if (active.size === 0) {
        this.listeners.delete(eventName);
      }
    };
  }

  emit(eventName: string, payload: unknown): void {
    const listeners = this.listeners.get(eventName);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(payload);
    }
  }

  setResponse(requestType: string, resolver: ResponseResolver): void {
    this.responseByRequestType.set(requestType, resolver);
  }

  setError(requestType: string, error: Error): void {
    this.errorByRequestType.set(requestType, error);
  }

  async call(requestType: string, requestData?: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.calls.push({ requestType, requestData });

    const mappedError = this.errorByRequestType.get(requestType);
    if (mappedError) {
      throw mappedError;
    }

    if (
      requestType === "SetCurrentProgramScene" &&
      requestData &&
      typeof requestData.sceneName === "string"
    ) {
      this.snapshot.programSceneName = requestData.sceneName;
      this.snapshot.updatedAt = nowIso();
    }

    const mapped = this.responseByRequestType.get(requestType);
    if (mapped) {
      if (typeof mapped === "function") {
        return mapped(requestData);
      }
      return { ...mapped };
    }

    if (requestType === "GetSceneItemId") {
      return { sceneItemId: 42 };
    }
    if (requestType === "GetReplayBufferStatus") {
      return { outputActive: true };
    }
    if (requestType === "GetLastReplayBufferReplay") {
      return { savedReplayPath: "/tmp/highlight.mp4" };
    }
    if (requestType === "GetRecordStatus") {
      return { outputActive: false };
    }
    if (requestType === "GetInputVolume") {
      return { inputVolumeDb: -24.5, inputVolumeMul: 0.0595 };
    }
    if (requestType === "GetInputList") {
      return {
        inputs: [{ inputName: "Mic/Aux" }, { inputName: "inputname" }, { inputName: "Discord" }]
      };
    }

    return {};
  }

  async callBatch(requests: BatchRequest[], options?: BatchOptions): Promise<unknown[]> {
    this.batchCalls.push({ requests, options });
    return requests.map(() => ({ ok: true }));
  }
}
