import { AppError } from "../errors.js";
import type { PromptDraftPlan, PlannedToolCall } from "./prompt.js";
import type { AssistantToolDefinition, AssistantToolId } from "./tool-registry.js";

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface OpenAiResponse {
  output_text?: unknown;
  output?: unknown;
}

export interface LlmDraftOptions {
  tools: AssistantToolDefinition[];
  chaosPresetIds: string[];
}

export interface LlmPlannerConfig {
  apiKey: string | null;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  logger: LoggerLike;
}

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return "https://api.openai.com/v1";
  }
  return trimmed.replace(/\/+$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  return null;
}

function extractResponseText(payload: OpenAiResponse): string {
  const direct = readString(payload.output_text);
  if (direct) {
    return direct;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const block of output) {
    if (!isRecord(block)) {
      continue;
    }
    if (block.type !== "message") {
      continue;
    }

    const content = Array.isArray(block.content) ? block.content : [];
    for (const part of content) {
      if (!isRecord(part)) {
        continue;
      }

      if (part.type === "output_text") {
        const text = readString(part.text);
        if (text) {
          return text;
        }
      }

      if (part.type === "text") {
        const text = readString(part.text);
        if (text) {
          return text;
        }
      }
    }
  }

  throw new AppError("No text output returned by OpenAI", {
    statusCode: 502,
    code: "ASSISTANT_LLM_EMPTY_OUTPUT"
  });
}

function extractJsonText(text: string): string {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fenced && typeof fenced[1] === "string") {
    return fenced[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  throw new AppError("OpenAI did not return JSON output", {
    statusCode: 502,
    code: "ASSISTANT_LLM_JSON_MISSING"
  });
}

function dedupeCalls(calls: PlannedToolCall[]): PlannedToolCall[] {
  const seen = new Set<string>();
  const unique: PlannedToolCall[] = [];

  for (const call of calls) {
    const key = `${call.toolId}:${JSON.stringify(call.args)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push({
      toolId: call.toolId,
      args: { ...call.args },
      reason: call.reason
    });
  }

  return unique;
}

function buildSystemPrompt(options: LlmDraftOptions): string {
  const toolHelp = options.tools
    .map((tool) => {
      return [
        `${tool.id}`,
        `label=${tool.label}`,
        `risk=${tool.risk}`,
        `requiresConfirmation=${String(tool.requiresConfirmation)}`,
        `description=${tool.description}`
      ].join(" | ");
    })
    .join("\n");

  return [
    "You are the FEBRUARY11 assistant planner for OBS stream operations.",
    "You can only use the tools listed below. Never invent tools or endpoints.",
    "Output ONLY strict JSON (no markdown, no prose outside JSON).",
    "Schema:",
    '{"summary":"string","notes":["string"],"calls":[{"toolId":"string","args":{},"reason":"string"}]}',
    "Planning rules:",
    "- Prefer the smallest safe plan that satisfies user intent.",
    "- Include high-impact actions only when user intent is explicit.",
    "- If intent is unclear, return no calls and add a note.",
    "- For chaos.run-preset args must include presetId from provided preset IDs.",
    "- For safety.kill-switch args must include enabled:boolean and reason:string.",
    "- For replay.capture args may include label:string.",
    "- Keep notes concise.",
    "Available tools:",
    toolHelp,
    `Available chaos preset IDs: ${JSON.stringify(options.chaosPresetIds)}`
  ].join("\n");
}

export class LlmPlanner {
  private readonly config: LlmPlannerConfig;
  private readonly apiKey: string | null;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: LlmPlannerConfig) {
    this.config = config;
    this.apiKey = config.apiKey && config.apiKey.trim().length > 0 ? config.apiKey.trim() : null;
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.timeoutMs =
      Number.isFinite(config.timeoutMs) && config.timeoutMs >= 1000
        ? Math.floor(config.timeoutMs)
        : 12000;
  }

  isEnabled(): boolean {
    return this.apiKey !== null;
  }

  getModel(): string {
    return this.config.model;
  }

  async draftPlan(promptInput: string, options: LlmDraftOptions): Promise<PromptDraftPlan> {
    if (!this.apiKey) {
      throw new AppError("OpenAI API key is not configured", {
        statusCode: 503,
        code: "ASSISTANT_LLM_DISABLED"
      });
    }

    const prompt = readString(promptInput);
    if (!prompt) {
      return {
        summary: "No prompt provided.",
        notes: ["Enter a request to generate an action plan."],
        calls: []
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          temperature: 0.2,
          max_output_tokens: 700,
          text: {
            format: {
              type: "json_schema",
              name: "assistant_plan",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  summary: { type: "string" },
                  notes: {
                    type: "array",
                    items: { type: "string" }
                  },
                  calls: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        toolId: { type: "string" },
                        args: { type: "object" },
                        reason: { type: "string" }
                      },
                      required: ["toolId", "args", "reason"]
                    }
                  }
                },
                required: ["summary", "notes", "calls"]
              }
            }
          },
          input: [
            {
              role: "system",
              content: [{ type: "input_text", text: buildSystemPrompt(options) }]
            },
            {
              role: "user",
              content: [{ type: "input_text", text: prompt }]
            }
          ]
        })
      });

      if (!response.ok) {
        const raw = await response.text();
        throw new AppError(`OpenAI request failed (${response.status}): ${raw.slice(0, 260)}`, {
          statusCode: 502,
          code: "ASSISTANT_LLM_UPSTREAM_FAILED"
        });
      }

      const payload = (await response.json()) as OpenAiResponse;
      const outputText = extractResponseText(payload);
      const parsed = JSON.parse(extractJsonText(outputText)) as unknown;
      return this.sanitizeDraft(parsed, options);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      const message =
        error instanceof Error && error.name === "AbortError"
          ? `OpenAI request timed out after ${this.timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);

      throw new AppError(`OpenAI planner failed: ${message}`, {
        statusCode: 502,
        code: "ASSISTANT_LLM_FAILED"
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private sanitizeDraft(value: unknown, options: LlmDraftOptions): PromptDraftPlan {
    if (!isRecord(value)) {
      throw new AppError("OpenAI planner response must be a JSON object", {
        statusCode: 502,
        code: "ASSISTANT_LLM_INVALID_PAYLOAD"
      });
    }

    const toolMap = new Map<AssistantToolId, AssistantToolDefinition>(
      options.tools.map((tool) => [tool.id, tool])
    );

    const summary = readString(value.summary) ?? "No actions planned.";
    const notesRaw = Array.isArray(value.notes) ? value.notes : [];
    const notes = notesRaw
      .map((entry) => readString(entry))
      .filter((entry): entry is string => entry !== null)
      .slice(0, 8);

    const callsRaw = Array.isArray(value.calls) ? value.calls : [];
    const calls: PlannedToolCall[] = [];

    for (const rawCall of callsRaw) {
      if (!isRecord(rawCall)) {
        continue;
      }
      const rawToolId = readString(rawCall.toolId);
      if (!rawToolId) {
        continue;
      }

      if (!toolMap.has(rawToolId as AssistantToolId)) {
        continue;
      }
      const toolId = rawToolId as AssistantToolId;
      const definition = toolMap.get(toolId);
      if (!definition) {
        continue;
      }

      const rawArgs = isRecord(rawCall.args) ? rawCall.args : {};
      const args: Record<string, unknown> = { ...rawArgs };
      const reason = readString(rawCall.reason) ?? definition.description;

      if (toolId === "chaos.run-preset") {
        const presetIdRaw = readString(args.presetId);
        const presetId = presetIdRaw && options.chaosPresetIds.includes(presetIdRaw)
          ? presetIdRaw
          : options.chaosPresetIds[0] ?? null;

        if (!presetId) {
          notes.push("Chaos preset requested, but no presets are loaded.");
          continue;
        }
        args.presetId = presetId;
      }

      if (toolId === "safety.kill-switch") {
        const enabled = readBoolean(args.enabled);
        if (enabled === null) {
          continue;
        }
        args.enabled = enabled;
        args.reason = readString(args.reason) ?? "assistant request";
      }

      if (toolId === "replay.capture") {
        const label = readString(args.label);
        if (label) {
          args.label = label.slice(0, 64);
        } else {
          delete args.label;
        }
      }

      calls.push({
        toolId,
        args,
        reason
      });
    }

    const deduped = dedupeCalls(calls);
    if (deduped.length === 0 && notes.length === 0) {
      notes.push("No executable actions were inferred from this prompt.");
    }

    return {
      summary,
      notes,
      calls: deduped
    };
  }
}
