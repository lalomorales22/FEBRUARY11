import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../backend/src/config.js";

function withEnv(overrides: Record<string, string | undefined>, fn: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("loadConfig applies defaults for invalid numbers and parses booleans/policy", () => {
  withEnv(
    {
      APP_PORT: "not-a-number",
      OBS_PORT: "-5",
      REPLAY_AUTO_START_BUFFER: "false",
      REPLAY_CREATE_RECORD_CHAPTER: "0",
      PLUGIN_DEFAULT_POLICY: "allow",
      SAFETY_FALLBACK_SCENE: "  Emergency  "
    },
    () => {
      const config = loadConfig();
      assert.equal(config.appPort, 3199);
      assert.equal(config.obsPort, 4455);
      assert.equal(config.replayAutoStartBuffer, false);
      assert.equal(config.replayCreateRecordChapter, false);
      assert.equal(config.pluginDefaultPolicy, "allow");
      assert.equal(config.safetyFallbackScene, "Emergency");
    }
  );
});
