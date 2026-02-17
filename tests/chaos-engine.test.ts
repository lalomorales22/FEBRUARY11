import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { ChaosEngine } from "../backend/src/chaos-engine.js";
import { AppError } from "../backend/src/errors.js";
import { SafetyManager } from "../backend/src/safety-manager.js";
import { MockObsManager, createTestLogger } from "./helpers/test-doubles.js";

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

test("ChaosEngine loads valid presets, skips invalid files, and executes a run", async () => {
  const dir = await makeTempDir("february11-chaos-");
  const obsManager = new MockObsManager();
  const safetyManager = new SafetyManager({
    fallbackScene: "EmergencyScene",
    maxActionsPerWindow: 20,
    windowMs: 60_000,
    logger: createTestLogger()
  });

  try {
    await writeFile(
      path.join(dir, "valid.json"),
      JSON.stringify(
        {
          id: "test_preset",
          name: "Test Preset",
          cooldownMs: 1_000,
          steps: [
            { type: "setProgramScene", sceneName: "MainCamera" },
            {
              type: "sceneItemEnabled",
              sceneName: "MainCamera",
              sceneItemSourceName: "ReplayLowerThird",
              enabled: true
            },
            {
              type: "batch",
              calls: [{ requestType: "SetCurrentSceneTransition", requestData: { transitionName: "Fade" } }]
            }
          ]
        },
        null,
        2
      ),
      "utf8"
    );

    await writeFile(path.join(dir, "broken.json"), "{not-json", "utf8");

    const engine = new ChaosEngine({
      presetsDir: dir,
      obsManager: obsManager as never,
      safetyManager,
      logger: createTestLogger()
    });

    const presets = await engine.loadPresets();
    assert.equal(presets.length, 1);
    assert.equal(presets[0].id, "test_preset");

    const run = await engine.runPreset("test_preset");
    assert.equal(run.presetId, "test_preset");

    assert.equal(
      obsManager.calls.some((call) => call.requestType === "SetCurrentProgramScene"),
      true
    );
    assert.equal(obsManager.calls.some((call) => call.requestType === "GetSceneItemId"), true);
    assert.equal(obsManager.calls.some((call) => call.requestType === "SetSceneItemEnabled"), true);
    assert.equal(obsManager.batchCalls.length, 1);

    await assert.rejects(
      () => engine.runPreset("test_preset"),
      (error: unknown) => error instanceof AppError && error.code === "CHAOS_COOLDOWN"
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ChaosEngine returns not found for missing preset IDs", async () => {
  const dir = await makeTempDir("february11-chaos-missing-");
  const engine = new ChaosEngine({
    presetsDir: dir,
    obsManager: new MockObsManager() as never,
    safetyManager: new SafetyManager({
      fallbackScene: null,
      maxActionsPerWindow: 10,
      windowMs: 60_000,
      logger: createTestLogger()
    }),
    logger: createTestLogger()
  });

  try {
    await engine.loadPresets();
    await assert.rejects(
      () => engine.runPreset("does-not-exist"),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "CHAOS_PRESET_NOT_FOUND" &&
        error.statusCode === 404
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
