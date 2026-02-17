import "dotenv/config";

import { createServer } from "node:http";
import path from "node:path";

import express, { type NextFunction, type Request, type Response } from "express";
import { WebSocket, WebSocketServer } from "ws";

import type { HealthResponse, WsServerMessage } from "../../shared/src/types.js";
import { AssistantService } from "./assistant/assistant-service.js";
import { LlmPlanner } from "./assistant/llm-planner.js";
import { AssistantToolRegistry } from "./assistant/tool-registry.js";
import { AutoDirector } from "./auto-director.js";
import { ChaosEngine } from "./chaos-engine.js";
import { loadConfig } from "./config.js";
import { AppError, normalizeError } from "./errors.js";
import { logger } from "./logger.js";
import { ObsConnectionManager } from "./obs-manager.js";
import { OnboardingService, type OnboardingGenerateInput } from "./onboarding-service.js";
import { OverlayBridge } from "./overlay-bridge.js";
import { PluginBridge } from "./plugin-bridge.js";
import { ReplayDirector } from "./replay-director.js";
import { SafetyManager } from "./safety-manager.js";

const config = loadConfig();
const app = express();
const httpServer = createServer(app);
const startedAtMs = Date.now();

const obsManager = new ObsConnectionManager({
  host: config.obsHost,
  port: config.obsPort,
  password: config.obsPassword,
  reconnectBaseMs: config.obsReconnectBaseMs,
  reconnectMaxMs: config.obsReconnectMaxMs,
  statusPollMs: config.obsStatusPollMs,
  logger
});

const safetyManager = new SafetyManager({
  fallbackScene: config.safetyFallbackScene,
  maxActionsPerWindow: config.safetyMaxActionsPerWindow,
  windowMs: config.safetyRateLimitWindowMs,
  logger
});

const chaosEngine = new ChaosEngine({
  presetsDir: path.resolve(process.cwd(), config.chaosPresetsDir),
  obsManager,
  safetyManager,
  logger
});

const autoDirector = new AutoDirector({
  rulesPath: path.resolve(process.cwd(), config.autoDirectorRulesPath),
  obsManager,
  safetyManager,
  logger
});

const replayDirector = new ReplayDirector({
  obsManager,
  safetyManager,
  logger,
  mediaInputName: config.replayMediaInputName,
  lowerThirdInputName: config.replayLowerThirdInputName,
  lowerThirdSceneName: config.replayLowerThirdSceneName,
  lowerThirdDurationMs: config.replayLowerThirdDurationMs,
  lowerThirdTemplate: config.replayLowerThirdTemplate,
  captureWaitMs: config.replayCaptureWaitMs,
  autoStartBuffer: config.replayAutoStartBuffer,
  createRecordChapter: config.replayCreateRecordChapter,
  chapterPrefix: config.replayChapterPrefix
});

const pluginBridge = new PluginBridge({
  permissionsPath: path.resolve(process.cwd(), config.pluginPermissionsPath),
  defaultPolicy: config.pluginDefaultPolicy,
  recentEventLimit: config.pluginRecentEventLimit,
  obsManager,
  safetyManager,
  logger
});

const overlayBridge = new OverlayBridge({
  enabled: config.overlayBridgeEnabled,
  baseUrl: config.overlayBridgeBaseUrl,
  requestTimeoutMs: config.overlayBridgeRequestTimeoutMs,
  logger
});

const assistantToolRegistry = new AssistantToolRegistry({
  obsManager,
  safetyManager,
  autoDirector,
  chaosEngine,
  replayDirector,
  overlayBridge,
  logger
});

const llmPlanner = new LlmPlanner({
  apiKey: config.openAiApiKey,
  model: config.openAiModel,
  baseUrl: config.openAiBaseUrl,
  timeoutMs: config.assistantLlmTimeoutMs,
  logger
});

const assistantService = new AssistantService({
  toolRegistry: assistantToolRegistry,
  chaosPresetProvider: chaosEngine,
  llmPlanner,
  logger
});

const onboardingService = new OnboardingService({
  rootDir: process.cwd(),
  obsManager,
  safetyManager,
  autoDirector,
  overlayBridge,
  generatedAutoDirectorPath: "presets/auto-director.generated.json",
  sceneBlueprintPath: "presets/scene-blueprints/default.json",
  overlayPresetPath: "presets/overlays/default.json",
  logger
});

app.use(express.json());

function buildHealth(): HealthResponse {
  const snapshot = obsManager.getSnapshot();
  return {
    service: "FEBRUARY11",
    status: "ok",
    now: new Date().toISOString(),
    uptimeSeconds: Math.floor((Date.now() - startedAtMs) / 1000),
    obsPhase: snapshot.connection.phase,
    reconnectAttempt: snapshot.connection.reconnectAttempt,
    nextRetryInMs: snapshot.connection.nextRetryInMs
  };
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json(buildHealth());
});

app.get("/api/status", (_req: Request, res: Response) => {
  res.status(200).json(obsManager.getSnapshot());
});

app.post("/api/obs/connect", (_req: Request, res: Response) => {
  obsManager.manualConnect();
  res.status(202).json({ ok: true, action: "connect" });
});

app.post("/api/obs/disconnect", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await obsManager.manualDisconnect();
    res.status(202).json({ ok: true, action: "disconnect" });
  } catch (error) {
    next(error);
  }
});

app.post("/api/obs/reconnect", (_req: Request, res: Response) => {
  obsManager.forceReconnect();
  res.status(202).json({ ok: true, action: "reconnect" });
});

app.get("/api/obs/scenes", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = await obsManager.call("GetSceneList");
    const rawScenes = Array.isArray(payload.scenes) ? payload.scenes : [];
    const scenes = rawScenes
      .map((entry) => {
        if (entry && typeof entry === "object") {
          const name = (entry as Record<string, unknown>).sceneName;
          return typeof name === "string" ? name : null;
        }
        return null;
      })
      .filter((item): item is string => item !== null);

    res.status(200).json({ ok: true, scenes });
  } catch (error) {
    next(error);
  }
});

app.post("/api/obs/program-scene", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const payload = body as Record<string, unknown>;
    const sceneName = typeof payload.sceneName === "string" ? payload.sceneName.trim() : "";
    if (!sceneName) {
      throw new AppError("sceneName is required", {
        statusCode: 400,
        code: "SCENE_NAME_REQUIRED"
      });
    }

    await obsManager.call("SetCurrentProgramScene", { sceneName });
    res.status(200).json({ ok: true, sceneName });
  } catch (error) {
    next(error);
  }
});

app.get("/api/obs/inputs", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = await obsManager.call("GetInputList");
    const rawInputs = Array.isArray(payload.inputs) ? payload.inputs : [];
    const inputs = rawInputs
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return null;
        }
        const record = entry as Record<string, unknown>;
        const inputName = typeof record.inputName === "string" ? record.inputName : null;
        const inputKind = typeof record.inputKind === "string" ? record.inputKind : null;
        const unversionedInputKind =
          typeof record.unversionedInputKind === "string" ? record.unversionedInputKind : null;
        if (!inputName) {
          return null;
        }
        return {
          inputName,
          inputKind,
          unversionedInputKind
        };
      })
      .filter(
        (
          item
        ): item is { inputName: string; inputKind: string | null; unversionedInputKind: string | null } =>
          item !== null
      );

    res.status(200).json({ ok: true, inputs });
  } catch (error) {
    next(error);
  }
});

app.get("/api/obs/input-volume", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawName = typeof req.query.inputName === "string" ? req.query.inputName : "";
    const inputName = rawName.trim();
    if (!inputName) {
      throw new AppError("inputName query param is required", {
        statusCode: 400,
        code: "INPUT_NAME_REQUIRED"
      });
    }

    const payload = await obsManager.call("GetInputVolume", { inputName });
    res.status(200).json({ ok: true, inputName, payload });
  } catch (error) {
    next(error);
  }
});

app.get("/api/safety/status", (_req: Request, res: Response) => {
  res.status(200).json(safetyManager.getStatus());
});

app.post("/api/safety/kill-switch", (req: Request, res: Response) => {
  const body = typeof req.body === "object" && req.body !== null ? req.body : {};
  const enabled = (body as Record<string, unknown>).enabled === true;
  const reasonRaw = (body as Record<string, unknown>).reason;
  const reason = typeof reasonRaw === "string" ? reasonRaw : undefined;
  const status = safetyManager.setKillSwitch(enabled, reason);
  res.status(200).json({ ok: true, status });
});

app.post("/api/safety/fallback-trigger", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const fallbackScene = safetyManager.getFallbackScene();
    if (!fallbackScene) {
      throw new AppError(
        "No fallback scene configured. Set SAFETY_FALLBACK_SCENE in your environment.",
        {
          statusCode: 400,
          code: "FALLBACK_SCENE_NOT_CONFIGURED"
        }
      );
    }

    safetyManager.assertAction("safety:fallback-trigger", {
      bypassKillSwitch: true,
      bypassRateLimit: true
    });
    await obsManager.call("SetCurrentProgramScene", { sceneName: fallbackScene });
    res.status(200).json({ ok: true, fallbackScene });
  } catch (error) {
    next(error);
  }
});

app.get("/api/chaos/status", (_req: Request, res: Response) => {
  res.status(200).json(chaosEngine.getStatus());
});

app.get("/api/chaos/presets", (_req: Request, res: Response) => {
  res.status(200).json(chaosEngine.listPresets());
});

app.post("/api/chaos/reload", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const presets = await chaosEngine.loadPresets();
    res.status(200).json({ ok: true, presets });
  } catch (error) {
    next(error);
  }
});

app.post(
  "/api/chaos/presets/:presetId/run",
  async (req: Request<{ presetId: string }>, res: Response, next: NextFunction) => {
    try {
      const result = await chaosEngine.runPreset(req.params.presetId);
      res.status(200).json({ ok: true, result });
    } catch (error) {
      next(error);
    }
  }
);

app.get("/api/auto-director/status", (_req: Request, res: Response) => {
  res.status(200).json(autoDirector.getStatus());
});

app.post("/api/auto-director/enable", (_req: Request, res: Response) => {
  const status = autoDirector.setEnabled(true);
  res.status(200).json({ ok: true, status });
});

app.post("/api/auto-director/disable", (_req: Request, res: Response) => {
  const status = autoDirector.setEnabled(false);
  res.status(200).json({ ok: true, status });
});

app.post("/api/auto-director/reload", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await autoDirector.reloadRules();
    res.status(200).json({ ok: true, status });
  } catch (error) {
    next(error);
  }
});

app.get("/api/replay/status", (_req: Request, res: Response) => {
  res.status(200).json(replayDirector.getStatus());
});

app.post("/api/replay/capture", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const labelRaw = (body as Record<string, unknown>).label;
    const label = typeof labelRaw === "string" ? labelRaw : undefined;
    const result = await replayDirector.captureReplay(label);
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/replay/hide-overlay", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    await replayDirector.hideOverlay();
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/plugins/status", (_req: Request, res: Response) => {
  res.status(200).json(pluginBridge.getStatus());
});

app.get("/api/plugins/vendors", (_req: Request, res: Response) => {
  res.status(200).json(pluginBridge.listVendors());
});

app.post("/api/plugins/reload", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await pluginBridge.reloadPermissions();
    res.status(200).json({ ok: true, status });
  } catch (error) {
    next(error);
  }
});

app.post("/api/plugins/call", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const payload = body as Record<string, unknown>;

    const vendorName = typeof payload.vendorName === "string" ? payload.vendorName : "";
    const requestType = typeof payload.requestType === "string" ? payload.requestType : "";
    const role = typeof payload.role === "string" ? payload.role : "operator";
    const requestData =
      payload.requestData && typeof payload.requestData === "object"
        ? (payload.requestData as Record<string, unknown>)
        : {};

    const result = await pluginBridge.callVendor({
      vendorName,
      requestType,
      role,
      requestData
    });
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/overlays/status", (_req: Request, res: Response) => {
  res.status(200).json({
    status: overlayBridge.getStatus(),
    links: overlayBridge.getLinks()
  });
});

app.post("/api/overlays/probe", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const status = await overlayBridge.probe();
    res.status(200).json({ ok: true, status, links: overlayBridge.getLinks() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/overlays/test-alert", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const payload = body as Record<string, unknown>;

    const type = typeof payload.type === "string" ? payload.type.trim() || "follow" : "follow";
    const username =
      typeof payload.username === "string" ? payload.username.trim() || "TestViewer" : "TestViewer";
    const viewers = typeof payload.viewers === "number" && Number.isFinite(payload.viewers)
      ? Math.max(1, Math.floor(payload.viewers))
      : undefined;

    const result = await overlayBridge.testAlert({ type, username, viewers });
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/overlays/test-chat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const payload = body as Record<string, unknown>;

    const username =
      typeof payload.username === "string" ? payload.username.trim() || "TestViewer" : "TestViewer";
    const message =
      typeof payload.message === "string" ? payload.message.trim() || "This is a test message." : "This is a test message.";
    const color = typeof payload.color === "string" ? payload.color.trim() || undefined : undefined;

    const result = await overlayBridge.testChat({ username, message, color });
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/overlays/scenes", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await overlayBridge.getScenes();
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/overlays/scene", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const scene =
      typeof (body as Record<string, unknown>).scene === "string"
        ? ((body as Record<string, unknown>).scene as string).trim()
        : "";
    const result = await overlayBridge.switchScene(scene);
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/overlays/start-stream", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await overlayBridge.startStream();
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/overlays/subtitles/settings", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const payload = body as Record<string, unknown>;

    const fontFamily = typeof payload.fontFamily === "string" ? payload.fontFamily.trim() || undefined : undefined;
    const fontSizePx =
      typeof payload.fontSizePx === "number" && Number.isFinite(payload.fontSizePx)
        ? Math.max(18, Math.min(140, Math.round(payload.fontSizePx)))
        : undefined;
    const textColor = typeof payload.textColor === "string" ? payload.textColor.trim() || undefined : undefined;
    const backgroundColor =
      typeof payload.backgroundColor === "string" ? payload.backgroundColor.trim() || undefined : undefined;
    const backgroundOpacity =
      typeof payload.backgroundOpacity === "number" && Number.isFinite(payload.backgroundOpacity)
        ? Math.max(0, Math.min(1, payload.backgroundOpacity))
        : undefined;

    const result = await overlayBridge.updateSubtitleSettings({
      fontFamily,
      fontSizePx,
      textColor,
      backgroundColor,
      backgroundOpacity
    });
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/overlays/subtitles/push", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const payload = body as Record<string, unknown>;

    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    const final = payload.final !== false;
    if (!text) {
      throw new AppError("text is required", {
        statusCode: 400,
        code: "OVERLAYS_SUBTITLE_TEXT_REQUIRED"
      });
    }

    const result = await overlayBridge.pushSubtitle({ text, final });
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/overlays/subtitles/clear", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await overlayBridge.clearSubtitle();
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/assistant/suggestions", (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    suggestions: assistantService.getSuggestions(),
    tools: assistantService.listTools(),
    planner: assistantService.getPlannerMeta()
  });
});

app.post("/api/assistant/chat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const payload = body as Record<string, unknown>;
    const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
    const result = await assistantService.chat(prompt);
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/api/assistant/plan", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const payload = body as Record<string, unknown>;
    const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
    const plan = await assistantService.createPlan(prompt);
    res.status(200).json({ ok: true, plan });
  } catch (error) {
    next(error);
  }
});

app.post("/api/assistant/execute", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const payload = body as Record<string, unknown>;

    const planId = typeof payload.planId === "string" ? payload.planId : undefined;
    const prompt = typeof payload.prompt === "string" ? payload.prompt : undefined;
    const stepIds = Array.isArray(payload.stepIds)
      ? payload.stepIds.filter((item): item is string => typeof item === "string")
      : undefined;
    const continueOnError = payload.continueOnError === true;

    const result = await assistantService.execute({
      planId,
      prompt,
      stepIds,
      continueOnError
    });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.get("/api/onboarding/status", (_req: Request, res: Response) => {
  res.status(200).json(onboardingService.getStatus());
});

app.post("/api/onboarding/scan", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const scan = await onboardingService.scan();
    res.status(200).json({
      ok: true,
      scan,
      status: onboardingService.getStatus()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/onboarding/generate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = typeof req.body === "object" && req.body !== null ? req.body : {};
    const payload = body as Record<string, unknown>;
    const questionnaireCandidate =
      payload.questionnaire && typeof payload.questionnaire === "object"
        ? (payload.questionnaire as Record<string, unknown>)
        : payload;
    const questionnaire = questionnaireCandidate as OnboardingGenerateInput;
    const result = await onboardingService.generate(questionnaire);
    res.status(200).json({
      ok: true,
      result,
      status: onboardingService.getStatus()
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/onboarding/verify", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await onboardingService.verify();
    res.status(200).json({
      ok: true,
      result,
      status: onboardingService.getStatus()
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api", (_req: Request, _res: Response, next: NextFunction) => {
  next(new AppError("API route not found", { statusCode: 404, code: "NOT_FOUND" }));
});

const frontendDir = path.resolve(process.cwd(), "frontend");
app.use(express.static(frontendDir));

app.get("*", (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendDir, "index.html"));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const normalized = normalizeError(error);
  logger.error("Request failed", {
    code: normalized.code,
    statusCode: normalized.statusCode,
    message: normalized.message,
    details: normalized.details
  });

  res.status(normalized.statusCode).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details
    }
  });
});

const websocketServer = new WebSocketServer({ server: httpServer, path: "/ws" });
const websocketClients = new Set<WebSocket>();

function send(socket: WebSocket, message: WsServerMessage): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
}

function broadcast(message: WsServerMessage): void {
  for (const socket of websocketClients) {
    send(socket, message);
  }
}

websocketServer.on("connection", (socket) => {
  websocketClients.add(socket);

  send(socket, { type: "snapshot", payload: obsManager.getSnapshot() });
  send(socket, { type: "health", payload: buildHealth() });
  send(socket, { type: "safety", payload: safetyManager.getStatus() });
  send(socket, { type: "chaosStatus", payload: chaosEngine.getStatus() });
  send(socket, { type: "chaosPresets", payload: chaosEngine.listPresets() });
  send(socket, { type: "autoDirector", payload: autoDirector.getStatus() });
  send(socket, { type: "replayDirector", payload: replayDirector.getStatus() });
  send(socket, { type: "pluginBridge", payload: pluginBridge.getStatus() });
  send(socket, { type: "overlayBridge", payload: overlayBridge.getStatus() });

  socket.on("close", () => {
    websocketClients.delete(socket);
  });
});

const unsubObs = obsManager.subscribe((snapshot) => {
  broadcast({ type: "snapshot", payload: snapshot });
});
const unsubSafety = safetyManager.subscribe((status) => {
  broadcast({ type: "safety", payload: status });
});
const unsubChaosStatus = chaosEngine.subscribeStatus((status) => {
  broadcast({ type: "chaosStatus", payload: status });
});
const unsubChaosPresets = chaosEngine.subscribePresets((presets) => {
  broadcast({ type: "chaosPresets", payload: presets });
});
const unsubAutoDirector = autoDirector.subscribe((status) => {
  broadcast({ type: "autoDirector", payload: status });
});
const unsubReplayDirector = replayDirector.subscribe((status) => {
  broadcast({ type: "replayDirector", payload: status });
});
const unsubPluginBridge = pluginBridge.subscribe((status) => {
  broadcast({ type: "pluginBridge", payload: status });
});
const unsubOverlayBridge = overlayBridge.subscribe((status) => {
  broadcast({ type: "overlayBridge", payload: status });
});

const healthBroadcastInterval = setInterval(() => {
  broadcast({ type: "health", payload: buildHealth() });
}, 2000);
const overlayProbeInterval = setInterval(() => {
  void overlayBridge.probe();
}, config.overlayBridgePollMs);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info("Shutting down FEBRUARY11", { signal });

  clearInterval(healthBroadcastInterval);
  clearInterval(overlayProbeInterval);

  unsubObs();
  unsubSafety();
  unsubChaosStatus();
  unsubChaosPresets();
  unsubAutoDirector();
  unsubReplayDirector();
  unsubPluginBridge();
  unsubOverlayBridge();

  autoDirector.stop();
  replayDirector.stop();
  pluginBridge.stop();

  for (const socket of websocketClients) {
    try {
      socket.close(1001, "Server shutdown");
    } catch {
      // Ignore.
    }
  }

  await obsManager.stop();

  await new Promise<void>((resolve) => {
    websocketServer.close(() => resolve());
  });

  await new Promise<void>((resolve) => {
    httpServer.close(() => resolve());
  });

  process.exit(0);
}

async function bootstrap(): Promise<void> {
  await overlayBridge.probe();
  await pluginBridge.init();
  await chaosEngine.init();
  await autoDirector.init();
  await replayDirector.init();
  obsManager.start();

  httpServer.listen(config.appPort, config.appHost, () => {
    logger.info("FEBRUARY11 server started", {
      appHost: config.appHost,
      appPort: config.appPort,
      obsHost: config.obsHost,
      obsPort: config.obsPort
    });
  });
}

void bootstrap().catch((error) => {
  logger.error("Failed to bootstrap FEBRUARY11", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
