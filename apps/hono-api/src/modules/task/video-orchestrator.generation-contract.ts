import type { AppContext } from "../../types";
import { ExternalDependencyError } from "../../platform/external-dependency-error";
import {
  isSelectableNewApiModel,
  listNewApiModels,
} from "../new-api-models/new-api-models.service";
import { matchesNewApiRuntimeModelIdentity } from "../new-api-models/new-api-model-identity";

export type VideoReferenceAudioPolicy = {
  /** Zero/zero is the explicit frozen fact that this runtime model exposes no reference-audio input. */
  minimumDurationSeconds: number;
  maximumDurationSeconds: number;
  maximumTotalDurationSeconds?: number;
};

export type VideoGenerationContract = {
  videoModel: string;
  durationOptions: number[];
  maxDurationSeconds: number;
  maxShotDurationSeconds?: number;
  referenceAudioPolicy: VideoReferenceAudioPolicy;
};

async function resolveEnabledRuntimeVideoOptions(input: {
  c: AppContext;
  videoModel: string;
}): Promise<Record<string, unknown>> {
  const videoModel = input.videoModel.trim();
  if (!videoModel) throw new Error("video_generation_model_required");
  // The new-api runtime directory is the only source of truth for whether a
  // model can actually be submitted. The local catalog may enrich passive UI
  // metadata, but requiring a second catalog row here can reject a newly
  // enabled runtime-only model before the provider request is even built.
  const runtimeModels = await listNewApiModels(input.c.env, {
    kind: "video",
    enabled: true,
    fresh: true,
  });
  const runtimeModel = runtimeModels
    .filter(isSelectableNewApiModel)
    .find((model) => matchesNewApiRuntimeModelIdentity(model, videoModel));
  if (!runtimeModel) throw new Error(`video_model_not_enabled:${videoModel}`);
  const videoOptions = runtimeModel.meta &&
      typeof runtimeModel.meta === "object" &&
      !Array.isArray(runtimeModel.meta)
    ? (runtimeModel.meta as Record<string, unknown>).videoOptions
    : null;
  if (!videoOptions || typeof videoOptions !== "object" || Array.isArray(videoOptions)) {
    throw new ExternalDependencyError({ kind: "model_catalog", identity: videoModel,
      field: "videoOptions", code: "video_model_runtime_contract_missing", observed: videoOptions });
  }
  return videoOptions as Record<string, unknown>;
}


export async function resolveVideoModelReferenceAudioPolicy(input: {
  c: AppContext;
  videoModel: string;
}): Promise<VideoReferenceAudioPolicy> {
  return readReferenceAudioPolicy(await resolveEnabledRuntimeVideoOptions(input));
}

function readReferenceAudioPolicy(videoOptions: Record<string, unknown>): VideoReferenceAudioPolicy {
  const declaredMaximum = videoOptions.maxReferenceAudioDurationSeconds;
  const maximumDurationSeconds = Number(declaredMaximum);
  if (Number.isFinite(maximumDurationSeconds) && maximumDurationSeconds > 0) {
    const declaredTotalMaximum = Number(videoOptions.maxReferenceAudioTotalDurationSeconds);
    return {
      minimumDurationSeconds: 1.8,
      maximumDurationSeconds,
      ...(Number.isFinite(declaredTotalMaximum) && declaredTotalMaximum > 0
        ? { maximumTotalDurationSeconds: declaredTotalMaximum }
        : {}),
    };
  }
  if (
    declaredMaximum === undefined &&
    videoOptions.supportsReferenceAudios !== true
  ) {
    return { minimumDurationSeconds: 0, maximumDurationSeconds: 0 };
  }
  if (videoOptions.supportsReferenceAudios === false) {
    return { minimumDurationSeconds: 0, maximumDurationSeconds: 0 };
  }
  // A stale catalog may advertise reference-audio support without publishing
  // the provider's exact duration range.  That is insufficient evidence for
  // sending paid audio inputs, but it must not invalidate the visual video
  // contract. Degrade to no reference audio and let the prompt/default native
  // voice (or silent output) continue.
  return { minimumDurationSeconds: 0, maximumDurationSeconds: 0 };
}

function readStringOptionValues(value: unknown, additionalKeys: string[] = []): string[] {
  if (!Array.isArray(value)) return [];
  const values = value.flatMap((option) => {
    if (typeof option === "string") return [option.trim()];
    if (!option || typeof option !== "object" || Array.isArray(option)) return [];
    const record = option as Record<string, unknown>;
    return ["value", ...additionalKeys]
      .map((key) => typeof record[key] === "string" ? String(record[key]).trim() : "")
      .filter(Boolean);
  });
  return Array.from(new Set(values));
}

function requireVideoModelResolutionOptions(input: {
  videoModel: string;
  videoOptions: Record<string, unknown>;
}): string[] {
  const resolutionOptions = readStringOptionValues(input.videoOptions.resolutionOptions);
  if (resolutionOptions.length === 0) {
    throw new Error(`video_model_resolution_options_missing:${input.videoModel.trim()}`);
  }
  return resolutionOptions;
}

function requireVideoModelAspectOptions(input: {
  videoModel: string;
  videoOptions: Record<string, unknown>;
}): string[] {
  const aspectOptions = readStringOptionValues(input.videoOptions.sizeOptions, ["aspectRatio"]);
  if (aspectOptions.length === 0) {
    throw new Error(`video_model_aspect_options_missing:${input.videoModel.trim()}`);
  }
  return aspectOptions;
}

function requireVideoModelNativeAudioSupport(input: {
  videoModel: string;
  videoOptions: Record<string, unknown>;
}): boolean {
  const supportsNativeAudio = input.videoOptions.supportsNativeAudio;
  // Audio is an enhancement, not a prerequisite for producing the visual
  // deliverable. An old/stale model catalog must therefore degrade to silent
  // video instead of hard-blocking the entire workflow. Explicit true still
  // enables native audio; explicit false and undeclared both mean unavailable.
  return supportsNativeAudio === true;
}

/**
 * Read the exact resolution values exposed by the currently enabled runtime
 * model. Product defaults and billing-table keys are not capability evidence.
 */
export async function resolveVideoModelResolutionOptions(input: {
  c: AppContext;
  videoModel: string;
}): Promise<string[]> {
  const videoOptions = await resolveEnabledRuntimeVideoOptions(input);
  return requireVideoModelResolutionOptions({
    videoModel: input.videoModel,
    videoOptions,
  });
}

/**
 * Read the exact size/aspect values exposed by the same live runtime contract.
 * Some providers use a render size as `value` and declare the canonical ratio
 * in `aspectRatio`, so both explicit fields are valid deterministic evidence.
 */
export async function resolveVideoModelAspectOptions(input: {
  c: AppContext;
  videoModel: string;
}): Promise<string[]> {
  const videoOptions = await resolveEnabledRuntimeVideoOptions(input);
  return requireVideoModelAspectOptions({
    videoModel: input.videoModel,
    videoOptions,
  });
}

export async function resolveVideoModelNativeAudioSupport(input: {
  c: AppContext;
  videoModel: string;
}): Promise<boolean> {
  const videoOptions = await resolveEnabledRuntimeVideoOptions(input);
  return requireVideoModelNativeAudioSupport({
    videoModel: input.videoModel,
    videoOptions,
  });
}

/**
 * Whether the live provider contract accepts reference audio when there is no
 * image or video reference in the same request. This is a media-topology
 * capability, independent from general reference-audio and native-audio
 * support, so callers must not infer it from either of those flags.
 */
export async function resolveVideoModelAudioOnlyReferenceSupport(input: {
  c: AppContext;
  videoModel: string;
}): Promise<boolean> {
  const videoOptions = await resolveEnabledRuntimeVideoOptions(input);
  return videoOptions.supportsAudioOnlyReference === true;
}

function parseReferenceAudioPolicy(value: unknown): VideoReferenceAudioPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const minimumDurationSeconds = Number(record.minimumDurationSeconds);
  const maximumDurationSeconds = Number(record.maximumDurationSeconds);
  if (minimumDurationSeconds === 0 && maximumDurationSeconds === 0) {
    return { minimumDurationSeconds: 0, maximumDurationSeconds: 0 };
  }
  if (
    !Number.isFinite(minimumDurationSeconds) || minimumDurationSeconds <= 0 ||
    !Number.isFinite(maximumDurationSeconds) ||
    maximumDurationSeconds < minimumDurationSeconds
  ) return null;
  return { minimumDurationSeconds, maximumDurationSeconds };
}

function normalizeDurationOptions(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((entry) => Number(entry))
        .filter((entry) => Number.isInteger(entry) && entry > 0),
    ),
  ).sort((a, b) => a - b);
}

export function parseVideoGenerationContract(value: unknown): VideoGenerationContract | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const videoModel = typeof record.videoModel === "string" ? record.videoModel.trim() : "";
  const durationOptions = normalizeDurationOptions(record.durationOptions);
  const maxDurationSeconds = Number(record.maxDurationSeconds);
  const maxShotDurationRaw = record.maxShotDurationSeconds;
  const maxShotDurationSeconds = maxShotDurationRaw === undefined ? undefined : Number(maxShotDurationRaw);
  const referenceAudioPolicy = parseReferenceAudioPolicy(record.referenceAudioPolicy);
  if (
    !videoModel ||
    durationOptions.length === 0 ||
    !Number.isInteger(maxDurationSeconds) ||
    maxDurationSeconds <= 0 ||
    maxDurationSeconds !== durationOptions[durationOptions.length - 1] ||
    !referenceAudioPolicy ||
    (maxShotDurationSeconds !== undefined && (!Number.isFinite(maxShotDurationSeconds) || maxShotDurationSeconds <= 0))
  ) {
    return null;
  }
  return {
    videoModel,
    durationOptions,
    maxDurationSeconds,
    ...(maxShotDurationSeconds !== undefined ? { maxShotDurationSeconds } : {}),
    referenceAudioPolicy,
  };
}

export function readBeatSheetGenerationContract(beatSheet: unknown): VideoGenerationContract | null {
  if (!beatSheet || typeof beatSheet !== "object" || Array.isArray(beatSheet)) return null;
  const meta = (beatSheet as Record<string, unknown>).meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return parseVideoGenerationContract((meta as Record<string, unknown>).generationContract);
}

export function readStoryPlanGenerationContract(storyPlan: unknown): VideoGenerationContract | null {
  if (!storyPlan || typeof storyPlan !== "object" || Array.isArray(storyPlan)) return null;
  return parseVideoGenerationContract(
    (storyPlan as Record<string, unknown>).generationContract,
  );
}

export function videoGenerationContractsEqual(
  left: VideoGenerationContract,
  right: VideoGenerationContract,
): boolean {
  return (
    left.videoModel === right.videoModel &&
    left.maxDurationSeconds === right.maxDurationSeconds &&
    JSON.stringify(left.referenceAudioPolicy) === JSON.stringify(right.referenceAudioPolicy) &&
    left.durationOptions.length === right.durationOptions.length &&
    left.durationOptions.every((value, index) => value === right.durationOptions[index])
  );
}

export function requireStoryPlanGenerationContract(storyPlan: unknown): VideoGenerationContract {
  const contract = readStoryPlanGenerationContract(storyPlan);
  if (!contract) throw new Error("story_plan_generation_contract_missing");
  const videoModel = storyPlan && typeof storyPlan === "object" && !Array.isArray(storyPlan)
    ? String((storyPlan as Record<string, unknown>).videoModel ?? "").trim()
    : "";
  if (!videoModel || videoModel !== contract.videoModel) {
    throw new Error(
      `story_plan_generation_contract_model_mismatch:${videoModel || "missing"}:${contract.videoModel}`,
    );
  }
  return contract;
}

export async function resolveStoryPlanGenerationContract(input: {
  c: AppContext;
  storyPlan: unknown;
  allowCatalogResolution: boolean;
}): Promise<VideoGenerationContract> {
  const record =
    input.storyPlan && typeof input.storyPlan === "object" && !Array.isArray(input.storyPlan)
      ? (input.storyPlan as Record<string, unknown>)
      : null;
  const hasDeclaredContract = record
    ? Object.prototype.hasOwnProperty.call(record, "generationContract")
    : false;
  const snapshotted = readStoryPlanGenerationContract(input.storyPlan);
  if (snapshotted) return requireStoryPlanGenerationContract(input.storyPlan);
  if (hasDeclaredContract) throw new Error("story_plan_generation_contract_invalid");
  if (!input.allowCatalogResolution) return requireStoryPlanGenerationContract(input.storyPlan);

  const videoModel = record ? String(record.videoModel ?? "").trim() : "";
  return resolveVideoGenerationContract({ c: input.c, videoModel });
}

export async function resolveVideoGenerationContract(input: {
  c: AppContext;
  videoModel: string;
}): Promise<VideoGenerationContract> {
  const videoModel = input.videoModel.trim();
  if (!videoModel) throw new Error("video_generation_model_required");
  // Freeze one fresh directory observation. Independently fetching duration,
  // image and audio policies can combine incompatible catalog revisions.
  const videoOptions = await resolveEnabledRuntimeVideoOptions(input);
  const rawDurations = videoOptions.durationOptions;
  const durationValues = Array.isArray(rawDurations) ? rawDurations.map((option: unknown) => (
    option && typeof option === "object" && !Array.isArray(option)
      ? (option as Record<string, unknown>).value : option
  )) : [];
  const normalizedDurations = durationValues.map((value) => (
    typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN
  ));
  if (normalizedDurations.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new ExternalDependencyError({ kind: "model_catalog", identity: videoModel,
      field: "durationOptions", code: "video_generation_duration_options_invalid", observed: rawDurations ?? null });
  }
  const durationOptions = [...new Set(normalizedDurations)].sort((left, right) => left - right);
  if (durationOptions.length === 0) {
    throw new ExternalDependencyError({ kind: "model_catalog", identity: videoModel,
      field: "durationOptions", code: "video_generation_duration_options_missing", observed: rawDurations ?? null });
  }
  const referenceAudioPolicy = readReferenceAudioPolicy(videoOptions);
  return {
    videoModel,
    durationOptions,
    maxDurationSeconds: durationOptions[durationOptions.length - 1],
    referenceAudioPolicy,
  };
}

export async function resolveBeatSheetVideoGenerationContract(input: {
  c: AppContext;
  beatSheet: unknown;
}): Promise<VideoGenerationContract> {
  if (!input.beatSheet || typeof input.beatSheet !== "object" || Array.isArray(input.beatSheet)) {
    throw new Error("beat_sheet_generation_contract_source_missing");
  }
  const meta = (input.beatSheet as Record<string, unknown>).meta;
  const metaRecord = meta && typeof meta === "object" && !Array.isArray(meta)
    ? meta as Record<string, unknown>
    : null;
  const videoModel =
    metaRecord
      ? String(metaRecord.videoModel ?? "").trim()
      : "";
  if (!videoModel) {
    throw new Error("beat_sheet.meta.videoModel_required");
  }
  const aspect = metaRecord ? String(metaRecord.aspect ?? "").trim() : "";
  if (!aspect) throw new Error("beat_sheet.meta.aspect_required");
  const resolution = metaRecord ? String(metaRecord.resolution ?? "").trim() : "";
  if (!resolution) throw new Error("beat_sheet.meta.resolution_required");
  const videoOptions = await resolveEnabledRuntimeVideoOptions({
    c: input.c,
    videoModel,
  });
  const aspectOptions = requireVideoModelAspectOptions({ videoModel, videoOptions });
  if (!aspectOptions.includes(aspect)) {
    throw new Error(
      `beat_sheet.meta.aspect_not_supported:${aspect}:${aspectOptions.join(",")}`,
    );
  }
  const resolutionOptions = requireVideoModelResolutionOptions({ videoModel, videoOptions });
  if (!resolutionOptions.includes(resolution)) {
    throw new Error(
      `beat_sheet.meta.resolution_not_supported:${resolution}:${resolutionOptions.join(",")}`,
    );
  }
  const beats = (input.beatSheet as Record<string, unknown>).beats;
  const containsDialogue = Array.isArray(beats) && beats.some((beat) => {
    if (!beat || typeof beat !== "object" || Array.isArray(beat)) return false;
    const beatRecord = beat as Record<string, unknown>;
    const narrativeAudioPlan = beatRecord.narrativeAudioPlan;
    const narrativeLines = narrativeAudioPlan && typeof narrativeAudioPlan === "object" && !Array.isArray(narrativeAudioPlan)
      ? (narrativeAudioPlan as Record<string, unknown>).lines
      : undefined;
    return (
      (Array.isArray(beatRecord.dialogueScript) && beatRecord.dialogueScript.length > 0) ||
      (Array.isArray(narrativeLines) && narrativeLines.length > 0)
    );
  });
  // Keep dialogue in the authoritative prompt even when the selected model
  // cannot synthesize audio. Production may then deliver a silent visual clip
  // (with an observable degradation) instead of rejecting all video output.
  // Models that declare native_audio still receive generate_audio=true at the
  // provider boundary.
  void containsDialogue;
  const snapshotted = readBeatSheetGenerationContract(input.beatSheet);
  if (snapshotted) {
    if (snapshotted.videoModel !== videoModel) {
      throw new Error(
        `beat_sheet_generation_contract_model_mismatch:${videoModel}:${snapshotted.videoModel}`,
      );
    }
    return snapshotted;
  }
  return resolveVideoGenerationContract({ c: input.c, videoModel });
}
