import { promises as fs } from "node:fs";
import path from "node:path";

import type { AutoDirector } from "./auto-director.js";
import { AppError } from "./errors.js";
import type { ObsConnectionManager } from "./obs-manager.js";
import type { OverlayBridge } from "./overlay-bridge.js";
import type { SafetyManager } from "./safety-manager.js";

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface ScanInputSummary {
  inputName: string;
  inputKind: string | null;
  unversionedInputKind: string | null;
}

interface ScanResultSnapshot {
  scannedAt: string;
  programSceneName: string | null;
  sceneNames: string[];
  inputs: ScanInputSummary[];
}

interface FileWriteResult {
  path: string;
  bytes: number;
  kind: "autoDirector" | "sceneBlueprint" | "overlayPreset";
}

interface ChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  details: string;
}

interface VerificationSummary {
  passed: number;
  total: number;
}

export interface OnboardingStatus {
  obsConnected: boolean;
  hasScan: boolean;
  hasGeneratedProfile: boolean;
  hasVerified: boolean;
  sceneCount: number;
  inputCount: number;
  programSceneName: string | null;
  lastScanAt: string | null;
  lastGenerateAt: string | null;
  lastVerifyAt: string | null;
  generatedFiles: string[];
  verificationSummary: VerificationSummary | null;
  lastChecklist: ChecklistItem[];
  lastError: string | null;
  updatedAt: string;
}

export interface OnboardingGenerateInput {
  streamType?: string;
  primaryMic?: string;
  gameplayScene?: string;
  cameraScene?: string;
  overlayStyle?: string;
}

export interface OnboardingServiceConfig {
  rootDir: string;
  obsManager: ObsConnectionManager;
  safetyManager: SafetyManager;
  autoDirector: AutoDirector;
  overlayBridge: OverlayBridge;
  generatedAutoDirectorPath: string;
  sceneBlueprintPath: string;
  overlayPresetPath: string;
  logger: LoggerLike;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function pickByHint(values: string[], hints: string[]): string | null {
  const normalizedHints = hints.map((hint) => hint.toLowerCase());
  const match = values.find((value) => {
    const lower = value.toLowerCase();
    return normalizedHints.some((hint) => lower.includes(hint));
  });
  return match ?? null;
}

export class OnboardingService {
  private readonly config: OnboardingServiceConfig;

  private status: OnboardingStatus = {
    obsConnected: false,
    hasScan: false,
    hasGeneratedProfile: false,
    hasVerified: false,
    sceneCount: 0,
    inputCount: 0,
    programSceneName: null,
    lastScanAt: null,
    lastGenerateAt: null,
    lastVerifyAt: null,
    generatedFiles: [],
    verificationSummary: null,
    lastChecklist: [],
    lastError: null,
    updatedAt: nowIso()
  };

  private lastScan: ScanResultSnapshot | null = null;

  constructor(config: OnboardingServiceConfig) {
    this.config = config;
  }

  getStatus(): OnboardingStatus {
    return {
      ...this.status,
      generatedFiles: [...this.status.generatedFiles],
      lastChecklist: this.status.lastChecklist.map((item) => ({ ...item })),
      verificationSummary: this.status.verificationSummary
        ? { ...this.status.verificationSummary }
        : null
    };
  }

  async scan(): Promise<{
    scannedAt: string;
    programSceneName: string | null;
    sceneNames: string[];
    inputs: ScanInputSummary[];
  }> {
    this.status.obsConnected = this.config.obsManager.isConnected();
    if (!this.status.obsConnected) {
      throw new AppError("OBS is not connected. Connect OBS first.", {
        statusCode: 409,
        code: "ONBOARDING_OBS_DISCONNECTED"
      });
    }

    try {
      const [scenePayload, inputPayload, currentScenePayload] = await Promise.all([
        this.config.obsManager.call("GetSceneList"),
        this.config.obsManager.call("GetInputList"),
        this.config.obsManager.call("GetCurrentProgramScene")
      ]);

      const sceneNames = this.parseSceneNames(scenePayload.scenes);
      const inputs = this.parseInputs(inputPayload.inputs);
      const programSceneName = readString(currentScenePayload.currentProgramSceneName);
      const scannedAt = nowIso();

      this.lastScan = {
        scannedAt,
        programSceneName,
        sceneNames,
        inputs
      };
      this.status = {
        ...this.status,
        obsConnected: true,
        hasScan: true,
        sceneCount: sceneNames.length,
        inputCount: inputs.length,
        programSceneName,
        lastScanAt: scannedAt,
        lastError: null,
        updatedAt: scannedAt
      };

      return {
        scannedAt,
        programSceneName,
        sceneNames: [...sceneNames],
        inputs: inputs.map((input) => ({ ...input }))
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.markError(`Onboarding scan failed: ${message}`);
      throw new AppError(`Onboarding scan failed: ${message}`, {
        statusCode: 500,
        code: "ONBOARDING_SCAN_FAILED"
      });
    }
  }

  async generate(input: OnboardingGenerateInput): Promise<{
    generatedAt: string;
    files: FileWriteResult[];
    profile: Record<string, unknown>;
    notes: string[];
  }> {
    const scan = await this.ensureScan();
    const generatedAt = nowIso();

    const streamType = readString(input.streamType) ?? "gaming";
    const overlayStyle = readString(input.overlayStyle) ?? "clean-dark";
    const primaryMic = readString(input.primaryMic) ?? this.pickMicInput(scan.inputs);
    const gameplayScene =
      readString(input.gameplayScene) ??
      pickByHint(scan.sceneNames, ["gameplay", "game", "play"]) ??
      scan.programSceneName ??
      scan.sceneNames[0] ??
      null;
    const cameraScene =
      readString(input.cameraScene) ??
      pickByHint(scan.sceneNames, ["camera", "facecam", "cam"]) ??
      scan.sceneNames[0] ??
      null;

    const autoDirectorDoc = this.buildAutoDirectorProfile({
      primaryMic,
      gameplayScene,
      cameraScene
    });
    const sceneBlueprintDoc = this.buildSceneBlueprintProfile({
      streamType,
      overlayStyle,
      gameplayScene,
      cameraScene,
      sceneNames: scan.sceneNames
    });
    const overlayDoc = this.buildOverlayProfile({ streamType, overlayStyle });

    try {
      const files = await Promise.all([
        this.writeJsonFile(this.config.generatedAutoDirectorPath, autoDirectorDoc, "autoDirector"),
        this.writeJsonFile(this.config.sceneBlueprintPath, sceneBlueprintDoc, "sceneBlueprint"),
        this.writeJsonFile(this.config.overlayPresetPath, overlayDoc, "overlayPreset")
      ]);

      this.status = {
        ...this.status,
        hasGeneratedProfile: true,
        generatedFiles: files.map((file) => file.path),
        lastGenerateAt: generatedAt,
        lastError: null,
        updatedAt: generatedAt
      };

      const notes = [
        "Generated starter presets.",
        "Review generated files and adjust scene/input names as needed.",
        "Reload auto-director rules after editing generated file."
      ];

      const profile = {
        streamType,
        overlayStyle,
        primaryMic,
        gameplayScene,
        cameraScene
      };

      this.config.logger.info("Onboarding profile generated", {
        generatedAt,
        files: files.map((file) => file.path)
      });

      return {
        generatedAt,
        files,
        profile,
        notes
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.markError(`Onboarding generate failed: ${message}`);
      throw new AppError(`Onboarding generate failed: ${message}`, {
        statusCode: 500,
        code: "ONBOARDING_GENERATE_FAILED"
      });
    }
  }

  async verify(): Promise<{
    verifiedAt: string;
    checks: ChecklistItem[];
    summary: VerificationSummary;
  }> {
    const verifiedAt = nowIso();
    const scan = this.lastScan;
    const overlayStatus = await this.config.overlayBridge.probe();
    const autoDirectorStatus = this.config.autoDirector.getStatus();
    const safetyStatus = this.config.safetyManager.getStatus();

    const checks: ChecklistItem[] = [
      {
        id: "obs-connected",
        label: "OBS Connected",
        ok: this.config.obsManager.isConnected(),
        details: this.config.obsManager.isConnected() ? "Connected" : "Not connected"
      },
      {
        id: "scene-scan",
        label: "Scenes Detected",
        ok: !!scan && scan.sceneNames.length > 0,
        details: scan ? `${scan.sceneNames.length} scenes` : "Run scan first"
      },
      {
        id: "input-scan",
        label: "Inputs Detected",
        ok: !!scan && scan.inputs.length > 0,
        details: scan ? `${scan.inputs.length} inputs` : "Run scan first"
      },
      {
        id: "fallback-config",
        label: "Fallback Scene Configured",
        ok: typeof safetyStatus.fallbackScene === "string" && safetyStatus.fallbackScene.length > 0,
        details: safetyStatus.fallbackScene ?? "SAFETY_FALLBACK_SCENE not set"
      },
      {
        id: "auto-rules",
        label: "Auto Director Rules Loaded",
        ok: autoDirectorStatus.rules.length > 0,
        details: `${autoDirectorStatus.rules.length} rules loaded`
      },
      {
        id: "overlay-probe",
        label: "Overlay Service Reachable",
        ok: overlayStatus.enabled ? overlayStatus.reachable : true,
        details: overlayStatus.enabled
          ? overlayStatus.reachable
            ? "Reachable"
            : overlayStatus.lastError ?? "Not reachable"
          : "Bridge disabled"
      }
    ];

    const summary = {
      passed: checks.filter((item) => item.ok).length,
      total: checks.length
    };

    this.status = {
      ...this.status,
      hasVerified: true,
      lastChecklist: checks.map((item) => ({ ...item })),
      verificationSummary: summary,
      lastVerifyAt: verifiedAt,
      lastError: null,
      updatedAt: verifiedAt
    };

    return {
      verifiedAt,
      checks,
      summary
    };
  }

  private async ensureScan(): Promise<ScanResultSnapshot> {
    if (this.lastScan) {
      return {
        ...this.lastScan,
        sceneNames: [...this.lastScan.sceneNames],
        inputs: this.lastScan.inputs.map((input) => ({ ...input }))
      };
    }
    const result = await this.scan();
    return {
      scannedAt: result.scannedAt,
      programSceneName: result.programSceneName,
      sceneNames: [...result.sceneNames],
      inputs: result.inputs.map((input) => ({ ...input }))
    };
  }

  private parseSceneNames(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const names: string[] = [];
    for (const entry of value) {
      if (!isRecord(entry)) {
        continue;
      }
      const sceneName = readString(entry.sceneName);
      if (sceneName) {
        names.push(sceneName);
      }
    }
    return names;
  }

  private parseInputs(value: unknown): ScanInputSummary[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const inputs: ScanInputSummary[] = [];
    for (const entry of value) {
      if (!isRecord(entry)) {
        continue;
      }
      const inputName = readString(entry.inputName);
      if (!inputName) {
        continue;
      }
      inputs.push({
        inputName,
        inputKind: readString(entry.inputKind),
        unversionedInputKind: readString(entry.unversionedInputKind)
      });
    }
    return inputs;
  }

  private pickMicInput(inputs: ScanInputSummary[]): string | null {
    const names = inputs.map((input) => input.inputName);
    return (
      pickByHint(names, ["mic/aux", "mic", "microphone", "voice", "headset"]) ??
      names[0] ??
      null
    );
  }

  private buildAutoDirectorProfile(data: {
    primaryMic: string | null;
    gameplayScene: string | null;
    cameraScene: string | null;
  }): Record<string, unknown> {
    const rules: Array<Record<string, unknown>> = [];

    if (data.primaryMic && data.cameraScene) {
      rules.push({
        id: "generated_mic_camera",
        inputName: data.primaryMic,
        sceneName: data.cameraScene,
        activationDb: -52,
        priority: 130,
        holdMs: 250
      });
    }

    if (data.primaryMic && data.gameplayScene) {
      rules.push({
        id: "generated_mic_gameplay",
        inputName: data.primaryMic,
        sceneName: data.gameplayScene,
        activationDb: -56,
        priority: 90,
        holdMs: 400
      });
    }

    return {
      enabled: false,
      switchCooldownMs: 2600,
      hysteresisDb: 3,
      defaultHoldMs: 900,
      rules
    };
  }

  private buildSceneBlueprintProfile(data: {
    streamType: string;
    overlayStyle: string;
    gameplayScene: string | null;
    cameraScene: string | null;
    sceneNames: string[];
  }): Record<string, unknown> {
    const scenes: Array<{ name: string; role: "gameplay" | "camera" | "aux" }> = [];
    if (data.gameplayScene) {
      scenes.push({
        name: data.gameplayScene,
        role: "gameplay"
      });
    }
    if (data.cameraScene && data.cameraScene !== data.gameplayScene) {
      scenes.push({
        name: data.cameraScene,
        role: "camera"
      });
    }

    for (const sceneName of data.sceneNames.slice(0, 6)) {
      if (scenes.some((scene) => scene.name === sceneName)) {
        continue;
      }
      scenes.push({
        name: sceneName,
        role: "aux"
      });
    }

    return {
      version: 1,
      generatedAt: nowIso(),
      streamType: data.streamType,
      overlayStyle: data.overlayStyle,
      scenes
    };
  }

  private buildOverlayProfile(data: { streamType: string; overlayStyle: string }): Record<string, unknown> {
    return {
      version: 1,
      generatedAt: nowIso(),
      streamType: data.streamType,
      theme: data.overlayStyle,
      widgets: [
        { id: "alerts", enabled: true },
        { id: "chat", enabled: true },
        { id: "stats", enabled: true }
      ]
    };
  }

  private async writeJsonFile(
    relativePath: string,
    data: Record<string, unknown>,
    kind: FileWriteResult["kind"]
  ): Promise<FileWriteResult> {
    const fullPath = path.resolve(this.config.rootDir, relativePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const content = `${JSON.stringify(data, null, 2)}\n`;
    await fs.writeFile(fullPath, content, "utf8");
    return {
      path: relativePath,
      bytes: Buffer.byteLength(content),
      kind
    };
  }

  private markError(message: string): void {
    this.status = {
      ...this.status,
      lastError: message,
      updatedAt: nowIso()
    };
    this.config.logger.warn(message);
  }
}
