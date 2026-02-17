import type { AssistantToolId } from "./tool-registry.js";

export interface PlannedToolCall {
  toolId: AssistantToolId;
  args: Record<string, unknown>;
  reason: string;
}

export interface PromptDraftPlan {
  summary: string;
  notes: string[];
  calls: PlannedToolCall[];
}

export interface PromptDraftOptions {
  chaosPresetIds: string[];
}

const DEFAULT_SUGGESTIONS = [
  "Reconnect OBS and check overlay status.",
  "Enable auto director and reload rules.",
  "Run the first chaos preset once.",
  "Capture a replay labeled \"clutch moment\".",
  "Switch to fallback scene right now."
];

function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase();
}

function includesAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function pickChaosPresetId(prompt: string, presetIds: string[]): string | null {
  if (presetIds.length === 0) {
    return null;
  }

  const exact = presetIds.find((presetId) => prompt.includes(presetId.toLowerCase()));
  if (exact) {
    return exact;
  }

  return presetIds[0] ?? null;
}

function extractReplayLabel(prompt: string): string | null {
  const quoted = prompt.match(/"([^"]{1,64})"/);
  if (quoted && typeof quoted[1] === "string") {
    return quoted[1].trim() || null;
  }

  if (prompt.includes("clutch")) {
    return "clutch";
  }

  if (prompt.includes("highlight")) {
    return "highlight";
  }

  return null;
}

function uniqueCalls(calls: PlannedToolCall[]): PlannedToolCall[] {
  const dedupe = new Set<string>();
  const unique: PlannedToolCall[] = [];

  for (const call of calls) {
    const key = `${call.toolId}:${JSON.stringify(call.args)}`;
    if (dedupe.has(key)) {
      continue;
    }
    dedupe.add(key);
    unique.push({
      toolId: call.toolId,
      args: { ...call.args },
      reason: call.reason
    });
  }

  return unique;
}

export function assistantSuggestions(): string[] {
  return [...DEFAULT_SUGGESTIONS];
}

export function draftPlanFromPrompt(promptInput: string, options: PromptDraftOptions): PromptDraftPlan {
  const prompt = normalizePrompt(promptInput);
  const notes: string[] = [];
  const calls: PlannedToolCall[] = [];

  if (!prompt) {
    return {
      summary: "No prompt provided.",
      notes: ["Enter a request to generate an action plan."],
      calls: []
    };
  }

  if (includesAny(prompt, ["reconnect", "re-connect", "refresh websocket"])) {
    calls.push({
      toolId: "obs.reconnect",
      args: {},
      reason: "Reconnect OBS before running live actions."
    });
  } else if (
    includesAny(prompt, [
      "connect obs",
      "connect websocket",
      "connect stream",
      "start obs connection"
    ])
  ) {
    calls.push({
      toolId: "obs.connect",
      args: {},
      reason: "Start OBS connection flow."
    });
  }

  if (includesAny(prompt, ["kill switch on", "enable kill", "panic mode", "lock automations"])) {
    calls.push({
      toolId: "safety.kill-switch",
      args: { enabled: true, reason: "assistant prompt" },
      reason: "Enable kill switch for safety."
    });
  }

  if (includesAny(prompt, ["kill switch off", "disable kill", "unlock automations"])) {
    calls.push({
      toolId: "safety.kill-switch",
      args: { enabled: false, reason: "assistant prompt" },
      reason: "Disable kill switch."
    });
  }

  if (includesAny(prompt, ["fallback scene", "emergency scene", "panic scene"])) {
    calls.push({
      toolId: "safety.fallback-scene",
      args: {},
      reason: "Switch to fallback scene immediately."
    });
  }

  if (prompt.includes("auto director")) {
    if (includesAny(prompt, ["enable", "turn on", "start"])) {
      calls.push({
        toolId: "auto.enable",
        args: {},
        reason: "Enable auto director."
      });
    }
    if (includesAny(prompt, ["disable", "turn off", "stop"])) {
      calls.push({
        toolId: "auto.disable",
        args: {},
        reason: "Disable auto director."
      });
    }
    if (includesAny(prompt, ["reload", "refresh", "reread"])) {
      calls.push({
        toolId: "auto.reload",
        args: {},
        reason: "Reload auto-director rules."
      });
    }
  }

  if (includesAny(prompt, ["replay", "clip", "highlight"])) {
    const label = extractReplayLabel(promptInput);
    calls.push({
      toolId: "replay.capture",
      args: label ? { label } : {},
      reason: "Capture replay from replay buffer."
    });
  }

  if (includesAny(prompt, ["chaos", "preset"])) {
    const presetId = pickChaosPresetId(prompt, options.chaosPresetIds);
    if (presetId) {
      calls.push({
        toolId: "chaos.run-preset",
        args: { presetId },
        reason: `Run chaos preset ${presetId}.`
      });
    } else {
      notes.push("No chaos presets are currently loaded.");
    }
  }

  if (includesAny(prompt, ["overlay", "overlays", "overlay service"])) {
    calls.push({
      toolId: "overlays.probe",
      args: {},
      reason: "Verify overlay bridge reachability."
    });
  }

  const unique = uniqueCalls(calls);
  if (unique.length === 0) {
    notes.push("No executable actions were inferred from this prompt.");
    notes.push("Try asking for connect/reconnect, auto-director, replay, chaos, or fallback.");
  }

  const summary =
    unique.length > 0
      ? `Plan contains ${unique.length} ${unique.length === 1 ? "step" : "steps"}.`
      : "No actions planned.";

  return {
    summary,
    notes,
    calls: unique
  };
}
