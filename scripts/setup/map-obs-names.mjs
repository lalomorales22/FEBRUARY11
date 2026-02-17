#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = process.cwd();

const mappings = new Map([
  ["CAM_MAIN", process.env.OBS_MAIN_SCENE_NAME?.trim() || ""],
  ["GAMEPLAY", process.env.OBS_GAMEPLAY_SCENE_NAME?.trim() || ""],
  ["CAM_REACT", process.env.OBS_REACT_SCENE_NAME?.trim() || ""],
  ["FaceCam", process.env.OBS_FACECAM_SOURCE_NAME?.trim() || ""],
  ["Mic/Aux", process.env.OBS_MIC_INPUT_NAME?.trim() || ""],
  ["Desktop Audio", process.env.OBS_DESKTOP_AUDIO_INPUT_NAME?.trim() || ""],
  ["Discord", process.env.OBS_DISCORD_INPUT_NAME?.trim() || ""]
]);

const effectiveMappings = [...mappings.entries()].filter(([, replacement]) => replacement.length > 0);

if (effectiveMappings.length === 0) {
  console.error("No mapping env vars provided.");
  console.error("Set at least one of:");
  console.error(
    [
      "OBS_MAIN_SCENE_NAME",
      "OBS_GAMEPLAY_SCENE_NAME",
      "OBS_REACT_SCENE_NAME",
      "OBS_FACECAM_SOURCE_NAME",
      "OBS_MIC_INPUT_NAME",
      "OBS_DESKTOP_AUDIO_INPUT_NAME",
      "OBS_DISCORD_INPUT_NAME"
    ].join(", ")
  );
  process.exit(1);
}

const targets = [
  "presets/chaos/kinetic-slam.json",
  "presets/chaos/studio-whip.json",
  "presets/auto-director.default.json"
];

let filesUpdated = 0;
for (const relativeTarget of targets) {
  const filePath = path.join(workspaceRoot, relativeTarget);
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  const transformed = applyMappings(parsed, effectiveMappings);

  if (!transformed.changed) {
    continue;
  }

  await writeFile(filePath, `${JSON.stringify(transformed.value, null, 2)}\n`, "utf8");
  filesUpdated += 1;
  console.log(`Updated ${relativeTarget}`);
}

if (filesUpdated === 0) {
  console.log("No changes needed; placeholders did not match or already updated.");
} else {
  console.log(`Done. Updated ${filesUpdated} file(s).`);
  console.log("Run: npm run dev, then POST /api/chaos/reload and POST /api/auto-director/reload");
}

function applyMappings(value, activeMappings) {
  if (typeof value === "string") {
    for (const [from, to] of activeMappings) {
      if (value === from) {
        return { value: to, changed: true };
      }
    }
    return { value, changed: false };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const transformed = applyMappings(item, activeMappings);
      if (transformed.changed) {
        changed = true;
      }
      return transformed.value;
    });
    return { value: next, changed };
  }

  if (value && typeof value === "object") {
    let changed = false;
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      const transformed = applyMappings(entry, activeMappings);
      if (transformed.changed) {
        changed = true;
      }
      next[key] = transformed.value;
    }
    return { value: next, changed };
  }

  return { value, changed: false };
}
