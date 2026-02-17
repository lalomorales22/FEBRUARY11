import { randomUUID } from "node:crypto";

import { AppError } from "../errors.js";
import { LlmPlanner } from "./llm-planner.js";
import { assistantSuggestions, draftPlanFromPrompt, type PromptDraftPlan } from "./prompt.js";
import type {
  AssistantPlanStep,
  AssistantRiskLevel,
  AssistantToolExecutionResult
} from "./tool-registry.js";
import { AssistantToolRegistry } from "./tool-registry.js";

interface LoggerLike {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface ChaosPresetProvider {
  listPresets(): Array<{ id: string }>;
}

export interface AssistantPlan {
  id: string;
  prompt: string;
  summary: string;
  planner: "openai" | "rules";
  status: "draft" | "executed" | "failed";
  risk: AssistantRiskLevel;
  createdAt: string;
  updatedAt: string;
  steps: AssistantPlanStep[];
  notes: string[];
}

export interface AssistantPlanExecution {
  planId: string;
  startedAt: string;
  finishedAt: string;
  ok: boolean;
  continueOnError: boolean;
  stepResults: AssistantToolExecutionResult[];
  stoppedAtStepId: string | null;
}

export interface AssistantChatResult {
  message: string;
  plan: AssistantPlan;
  suggestions: string[];
}

export interface AssistantExecuteInput {
  planId?: string;
  prompt?: string;
  stepIds?: string[];
  continueOnError?: boolean;
}

export interface AssistantServiceConfig {
  toolRegistry: AssistantToolRegistry;
  chaosPresetProvider: ChaosPresetProvider;
  llmPlanner?: LlmPlanner | null;
  logger: LoggerLike;
  maxPlans?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function clampRisk(a: AssistantRiskLevel, b: AssistantRiskLevel): AssistantRiskLevel {
  const rank: Record<AssistantRiskLevel, number> = {
    low: 0,
    medium: 1,
    high: 2
  };
  return rank[a] >= rank[b] ? a : b;
}

function trimString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export class AssistantService {
  private readonly config: AssistantServiceConfig;
  private readonly plans = new Map<string, AssistantPlan>();
  private readonly planOrder: string[] = [];
  private readonly maxPlans: number;
  private readonly llmPlanner: LlmPlanner | null;

  constructor(config: AssistantServiceConfig) {
    this.config = config;
    this.llmPlanner = config.llmPlanner ?? null;
    this.maxPlans =
      typeof config.maxPlans === "number" && Number.isFinite(config.maxPlans) && config.maxPlans > 3
        ? Math.floor(config.maxPlans)
        : 40;
  }

  getSuggestions(): string[] {
    return assistantSuggestions();
  }

  listTools() {
    return this.config.toolRegistry.listTools();
  }

  getPlannerMeta(): { mode: "openai" | "rules"; model: string | null } {
    if (this.llmPlanner && this.llmPlanner.isEnabled()) {
      return { mode: "openai", model: this.llmPlanner.getModel() };
    }
    return { mode: "rules", model: null };
  }

  async createPlan(promptInput: string): Promise<AssistantPlan> {
    const prompt = trimString(promptInput);
    if (!prompt) {
      throw new AppError("prompt is required", {
        statusCode: 400,
        code: "ASSISTANT_PROMPT_REQUIRED"
      });
    }

    const chaosPresetIds = this.config.chaosPresetProvider.listPresets().map((preset) => preset.id);
    const tools = this.listTools();

    let planner: "openai" | "rules" = "rules";
    let draft: PromptDraftPlan;

    if (this.llmPlanner && this.llmPlanner.isEnabled()) {
      try {
        draft = await this.llmPlanner.draftPlan(prompt, {
          tools,
          chaosPresetIds
        });
        planner = "openai";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.config.logger.warn("OpenAI planner unavailable; using deterministic planner", {
          error: message
        });
        const fallback = draftPlanFromPrompt(prompt, { chaosPresetIds });
        draft = {
          ...fallback,
          notes: [`OpenAI planner unavailable: ${message}`, ...fallback.notes]
        };
      }
    } else {
      draft = draftPlanFromPrompt(prompt, { chaosPresetIds });
    }

    let overallRisk: AssistantRiskLevel = "low";
    const steps: AssistantPlanStep[] = draft.calls.map((call, index) => {
      const definition = this.config.toolRegistry.getToolDefinition(call.toolId);
      if (!definition) {
        throw new AppError(`Unsupported assistant tool: ${call.toolId}`, {
          statusCode: 400,
          code: "ASSISTANT_TOOL_UNSUPPORTED"
        });
      }

      overallRisk = clampRisk(overallRisk, definition.risk);
      return {
        id: `step-${index + 1}`,
        toolId: call.toolId,
        title: definition.label,
        description: call.reason || definition.description,
        args: { ...call.args },
        risk: definition.risk,
        requiresConfirmation: definition.requiresConfirmation
      };
    });

    const createdAt = nowIso();
    const plan: AssistantPlan = {
      id: randomUUID(),
      prompt,
      summary: draft.summary,
      planner,
      status: "draft",
      risk: steps.length > 0 ? overallRisk : "low",
      createdAt,
      updatedAt: createdAt,
      steps,
      notes: [...draft.notes]
    };

    this.persistPlan(plan);
    this.config.logger.info("Assistant plan created", {
      planId: plan.id,
      planner: plan.planner,
      stepCount: plan.steps.length
    });
    return this.clonePlan(plan);
  }

  async chat(promptInput: string): Promise<AssistantChatResult> {
    const plan = await this.createPlan(promptInput);
    const message =
      plan.steps.length > 0
        ? `${plan.planner === "openai" ? "OpenAI" : "Rule planner"} generated ${plan.steps.length} ${plan.steps.length === 1 ? "step" : "steps"}. Review before executing.`
        : "No direct actions were inferred. Try a more specific request.";

    return {
      message,
      plan,
      suggestions: this.getSuggestions()
    };
  }

  async execute(input: AssistantExecuteInput): Promise<{ plan: AssistantPlan; execution: AssistantPlanExecution }> {
    const plan = await this.resolvePlan(input);
    if (plan.steps.length === 0) {
      throw new AppError("Cannot execute a plan with no steps", {
        statusCode: 400,
        code: "ASSISTANT_PLAN_EMPTY"
      });
    }

    const selectedStepIds = Array.isArray(input.stepIds)
      ? new Set(
          input.stepIds
            .map((stepId) => trimString(stepId))
            .filter((stepId): stepId is string => stepId !== null)
        )
      : null;
    const steps =
      selectedStepIds && selectedStepIds.size > 0
        ? plan.steps.filter((step) => selectedStepIds.has(step.id))
        : plan.steps;

    if (steps.length === 0) {
      throw new AppError("No matching steps to execute", {
        statusCode: 400,
        code: "ASSISTANT_STEP_SELECTION_EMPTY"
      });
    }

    const continueOnError = input.continueOnError === true;
    const startedAt = nowIso();
    const stepResults: AssistantToolExecutionResult[] = [];
    let stoppedAtStepId: string | null = null;

    for (const step of steps) {
      try {
        const result = await this.config.toolRegistry.executeStep(step);
        stepResults.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        stepResults.push({
          stepId: step.id,
          toolId: step.toolId,
          ok: false,
          message,
          data: {}
        });
        stoppedAtStepId = step.id;
        if (!continueOnError) {
          break;
        }
      }
    }

    const ok = stepResults.every((result) => result.ok);
    const finishedAt = nowIso();
    plan.status = ok ? "executed" : "failed";
    plan.updatedAt = finishedAt;
    this.persistPlan(plan);

    this.config.logger.info("Assistant plan executed", {
      planId: plan.id,
      ok,
      continueOnError,
      stepCount: steps.length,
      failedStepId: stoppedAtStepId
    });

    return {
      plan: this.clonePlan(plan),
      execution: {
        planId: plan.id,
        startedAt,
        finishedAt,
        ok,
        continueOnError,
        stepResults,
        stoppedAtStepId
      }
    };
  }

  private async resolvePlan(input: AssistantExecuteInput): Promise<AssistantPlan> {
    const planId = trimString(input.planId);
    if (planId) {
      const existing = this.plans.get(planId);
      if (!existing) {
        throw new AppError(`Assistant plan not found: ${planId}`, {
          statusCode: 404,
          code: "ASSISTANT_PLAN_NOT_FOUND"
        });
      }
      return this.clonePlan(existing);
    }

    const prompt = trimString(input.prompt);
    if (!prompt) {
      throw new AppError("planId or prompt is required", {
        statusCode: 400,
        code: "ASSISTANT_EXECUTE_INPUT_REQUIRED"
      });
    }
    return this.createPlan(prompt);
  }

  private persistPlan(plan: AssistantPlan): void {
    this.plans.set(plan.id, this.clonePlan(plan));

    const existingIndex = this.planOrder.indexOf(plan.id);
    if (existingIndex >= 0) {
      this.planOrder.splice(existingIndex, 1);
    }
    this.planOrder.push(plan.id);

    while (this.planOrder.length > this.maxPlans) {
      const oldestId = this.planOrder.shift();
      if (oldestId) {
        this.plans.delete(oldestId);
      }
    }
  }

  private clonePlan(plan: AssistantPlan): AssistantPlan {
    return {
      ...plan,
      steps: plan.steps.map((step) => ({
        ...step,
        args: { ...step.args }
      })),
      notes: [...plan.notes]
    };
  }
}
