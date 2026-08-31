import type { AppContext } from "../../types";
import type { ModelParamSpec } from "../model-catalog/model-catalog.schemas";
import {
  listModelCatalogModels,
} from "../model-catalog/model-catalog.service";
import {
  isNonSelectableCatalogModel,
  isSelectableNewApiModel,
  listNewApiModels,
} from "../new-api-models/new-api-models.service";
import { matchesNewApiRuntimeModelIdentity } from "../new-api-models/new-api-model-identity";

export type VideoFinishingRequest = {
  kind: "video_enhance";
  modelKey: string;
  toolVersion: string;
  scene: string;
  resolution: string;
  fps?: number;
};

export type VideoFinishingContract = VideoFinishingRequest & {
  billingSpecKey: string;
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedModelKey(value: unknown): string {
  return trimmed(value).toLowerCase().replace(/-apimart$/, "");
}

function parseOptionalFps(value: unknown): number | undefined | null {
  if (value === undefined) return undefined;
  const fps = Number(value);
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

export function parseVideoFinishingRequest(value: unknown): VideoFinishingRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const fps = parseOptionalFps(record.fps);
  const request: VideoFinishingRequest = {
    kind: "video_enhance",
    modelKey: trimmed(record.modelKey),
    toolVersion: trimmed(record.toolVersion),
    scene: trimmed(record.scene),
    resolution: trimmed(record.resolution),
    ...(typeof fps === "number" ? { fps } : {}),
  };
  if (
    record.kind !== "video_enhance" ||
    !request.modelKey ||
    !request.toolVersion ||
    !request.scene ||
    !request.resolution ||
    fps === null
  ) return null;
  return request;
}

export function parseVideoFinishingContract(value: unknown): VideoFinishingContract | null {
  const request = parseVideoFinishingRequest(value);
  if (!request || !value || typeof value !== "object" || Array.isArray(value)) return null;
  const billingSpecKey = trimmed((value as Record<string, unknown>).billingSpecKey);
  if (!billingSpecKey) return null;
  return { ...request, billingSpecKey };
}

export function readBeatSheetFinishingRequest(beatSheet: unknown): VideoFinishingRequest | null {
  if (!beatSheet || typeof beatSheet !== "object" || Array.isArray(beatSheet)) return null;
  const meta = (beatSheet as Record<string, unknown>).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return parseVideoFinishingRequest((meta as Record<string, unknown>).finishing);
}

export function readBeatSheetFinishingContract(beatSheet: unknown): VideoFinishingContract | null {
  if (!beatSheet || typeof beatSheet !== "object" || Array.isArray(beatSheet)) return null;
  const meta = (beatSheet as Record<string, unknown>).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return parseVideoFinishingContract((meta as Record<string, unknown>).finishingContract);
}

export function readStoryPlanFinishingContract(storyPlan: unknown): VideoFinishingContract | null {
  if (!storyPlan || typeof storyPlan !== "object" || Array.isArray(storyPlan)) return null;
  return parseVideoFinishingContract((storyPlan as Record<string, unknown>).finishingContract);
}

function runtimeParameters(value: unknown): ModelParamSpec[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const parameters = (value as Record<string, unknown>).runtimeParameters;
  return Array.isArray(parameters) ? parameters as ModelParamSpec[] : [];
}

function findParameter(parameters: readonly ModelParamSpec[], keys: readonly string[]): ModelParamSpec {
  const parameter = parameters.find((candidate) => keys.includes(candidate.key));
  if (!parameter) throw new Error(`video_finishing_runtime_parameter_missing:${keys[0]}`);
  return parameter;
}

function requireExactOption(parameter: ModelParamSpec, value: string): void {
  const options = (parameter.options ?? []).map((option) => String(option.value).trim());
  if (options.length === 0) {
    throw new Error(`video_finishing_runtime_options_missing:${parameter.key}`);
  }
  if (!options.includes(value)) {
    throw new Error(`video_finishing_runtime_option_unsupported:${parameter.key}:${value}`);
  }
}

function validateFps(parameter: ModelParamSpec, fps: number | undefined): void {
  if (fps === undefined) return;
  if (typeof parameter.min === "number" && fps < parameter.min) {
    throw new Error(`video_finishing_fps_below_minimum:${fps}:${parameter.min}`);
  }
  if (typeof parameter.max === "number" && fps > parameter.max) {
    throw new Error(`video_finishing_fps_above_maximum:${fps}:${parameter.max}`);
  }
}

export function buildVideoFinishingBillingSpecKey(
  request: Pick<VideoFinishingRequest, "toolVersion" | "resolution" | "fps">,
): string {
  const frameRateBand = typeof request.fps === "number" && request.fps > 30 ? "gt30" : "lte30";
  return `${request.toolVersion}:${request.resolution.toLowerCase()}:${frameRateBand}`;
}

export async function resolveVideoFinishingContract(input: {
  c: AppContext;
  request: VideoFinishingRequest;
}): Promise<VideoFinishingContract> {
  const wanted = normalizedModelKey(input.request.modelKey);
  const [catalogModels, runtimeModels] = await Promise.all([
    listModelCatalogModels(input.c, { kind: "video", enabled: true }),
    listNewApiModels(input.c.env, { kind: "video", enabled: true, fresh: true }),
  ]);
  const catalogModel = catalogModels.find((model) =>
    (normalizedModelKey(model.modelKey) === wanted || normalizedModelKey(model.modelAlias) === wanted) &&
    isNonSelectableCatalogModel(model.modelKey),
  );
  if (!catalogModel) throw new Error(`video_finishing_model_not_enabled:${input.request.modelKey}`);
  const runtimeModel = runtimeModels
    .filter(isSelectableNewApiModel)
    .find((model) => matchesNewApiRuntimeModelIdentity(model, input.request.modelKey));
  if (!runtimeModel) {
    throw new Error(`video_finishing_runtime_contract_missing:${input.request.modelKey}`);
  }
  const parameters = runtimeParameters(runtimeModel.meta);
  requireExactOption(findParameter(parameters, ["tool_version", "toolVersion"]), input.request.toolVersion);
  requireExactOption(findParameter(parameters, ["scene"]), input.request.scene);
  requireExactOption(findParameter(parameters, ["resolution"]), input.request.resolution);
  validateFps(findParameter(parameters, ["fps"]), input.request.fps);
  return {
    ...input.request,
    billingSpecKey: buildVideoFinishingBillingSpecKey(input.request),
  };
}

export async function resolveBeatSheetVideoFinishingContract(input: {
  c: AppContext;
  beatSheet: unknown;
}): Promise<VideoFinishingContract | null> {
  const meta = input.beatSheet && typeof input.beatSheet === "object" && !Array.isArray(input.beatSheet)
    ? (input.beatSheet as Record<string, unknown>).meta
    : null;
  const metaRecord = meta && typeof meta === "object" && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : null;
  const existing = readBeatSheetFinishingContract(input.beatSheet);
  const request = readBeatSheetFinishingRequest(input.beatSheet);
  if (metaRecord && Object.prototype.hasOwnProperty.call(metaRecord, "finishingContract") && !existing) {
    throw new Error("beat_sheet_finishing_contract_invalid");
  }
  if (metaRecord && Object.prototype.hasOwnProperty.call(metaRecord, "finishing") && !request) {
    throw new Error("beat_sheet_finishing_request_invalid");
  }
  if (existing) {
    if (request && (
      request.kind !== existing.kind ||
      request.modelKey !== existing.modelKey ||
      request.toolVersion !== existing.toolVersion ||
      request.scene !== existing.scene ||
      request.resolution !== existing.resolution ||
      request.fps !== existing.fps
    )) {
      throw new Error("beat_sheet_finishing_contract_request_mismatch");
    }
    return existing;
  }
  if (!request) return null;
  return resolveVideoFinishingContract({ c: input.c, request });
}
