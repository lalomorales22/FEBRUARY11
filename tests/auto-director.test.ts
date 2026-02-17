import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { AutoDirector } from "../backend/src/auto-director.js";
import { SafetyManager } from "../backend/src/safety-manager.js";
import { MockObsManager, createTestLogger } from "./helpers/test-doubles.js";

async function createRulesFile(enabled = true): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "february11-auto-"));
  const file = path.join(dir, "rules.json");

  await writeFile(
    file,
    JSON.stringify(
      {
        enabled,
        switchCooldownMs: 250,
        hysteresisDb: 3,
        defaultHoldMs: 0,
        rules: [
          {
            id: "mic-cam",
            inputName: "Mic",
            sceneName: "Camera",
            activationDb: -45,
            priority: 100,
            holdMs: 0
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  return file;
}

function createSafety(): SafetyManager {
  return new SafetyManager({
    fallbackScene: null,
    maxActionsPerWindow: 100,
    windowMs: 60_000,
    logger: createTestLogger()
  });
}

async function emitVolumeTwice(obs: MockObsManager): Promise<void> {
  const payload = {
    inputs: [
      {
        inputName: "Mic",
        inputLevelsDb: [[-15, -17]]
      }
    ]
  };

  obs.emit("InputVolumeMeters", payload);
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), 5);
  });
  obs.emit("InputVolumeMeters", payload);
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), 15);
  });
}

test("AutoDirector switches to the winning rule scene after hold confirmation", async () => {
  const rulesPath = await createRulesFile(true);
  const dir = path.dirname(rulesPath);
  const obs = new MockObsManager();
  obs.setSnapshot({ programSceneName: "Gameplay" });

  const director = new AutoDirector({
    rulesPath,
    obsManager: obs as never,
    safetyManager: createSafety(),
    logger: createTestLogger()
  });

  try {
    await director.init();
    await emitVolumeTwice(obs);

    const switched = obs.calls.some(
      (call) =>
        call.requestType === "SetCurrentProgramScene" &&
        call.requestData?.sceneName === "Camera"
    );
    assert.equal(switched, true);

    const status = director.getStatus();
    assert.equal(status.activeRuleId, "mic-cam");
  } finally {
    director.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("AutoDirector respects kill switch and does not execute scene switches", async () => {
  const rulesPath = await createRulesFile(true);
  const dir = path.dirname(rulesPath);
  const obs = new MockObsManager();
  const safety = createSafety();
  safety.setKillSwitch(true, "live emergency");

  const director = new AutoDirector({
    rulesPath,
    obsManager: obs as never,
    safetyManager: safety,
    logger: createTestLogger()
  });

  try {
    await director.init();
    await emitVolumeTwice(obs);

    const switched = obs.calls.some((call) => call.requestType === "SetCurrentProgramScene");
    assert.equal(switched, false);
    assert.match(director.getStatus().lastDecision ?? "", /blocked:kill-switch/);
  } finally {
    director.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
