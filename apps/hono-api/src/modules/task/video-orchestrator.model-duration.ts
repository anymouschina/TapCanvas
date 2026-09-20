import type { AppContext } from "../../types";
import {
  loadPublicChatEnabledModelCatalogSummary,
  type PublicChatEnabledVideoModelSummary,
} from "../model-catalog/model-catalog.public-chat-summary";

/**
 * 数据驱动地解析某视频模型的合法时长档位（durationOptions），唯一真相源 = 当前
 * 可执行的新 API 运行时目录。禁止在代码里写死 15/10/5。
 *
 * 只允许从当前可执行目录读取。目录读取失败、模型不存在或 durationOptions 缺失都显式失败；
 * 禁止使用 LLM 草稿或代码默认值继续，因为那会让 writer/critic 与真实提交采用不同合同。
 */
export async function resolveModelDurationOptions(input: {
  c: AppContext;
  modelKey: string;
}): Promise<number[]> {
  const wanted = normalizeKey(input.modelKey).replace(/-apimart$/, "");
  if (wanted) {
    const matched = await resolveExecutableVideoModel(input.c, wanted);
    if (!matched) throw new Error(`video_model_not_enabled:${input.modelKey}`);
    const opts = normalizeDurationList(
      matched.videoOptions?.durationOptions.map((option) => option.value) ?? [],
    );
    if (opts.length) return opts;
    throw new Error(`video_model_duration_options_missing:${input.modelKey}`);
  }
  throw new Error("video_model_key_required");
}

function normalizeDurationList(values: number[]): number[] {
  return Array.from(
    new Set(values.map((n) => Math.trunc(Number(n))).filter((n) => Number.isFinite(n) && n > 0)),
  ).sort((a, b) => a - b);
}

function normalizeKey(value: string): string {
  return String(value || "").trim().toLowerCase();
}

/**
 * 解析视频模型的媒体选项（时长/分辨率/画幅），唯一真相源 = 当前可执行的新 API
 * 运行时目录。禁止写死枚举。供工作流按次注入参数做确定性
 * 校验：调用方指定的 resolution/aspectRatio 不在目录内时显式失败，不允许把
 * 非法参数漏给供应商后再收到晦涩报错。
 */
export async function resolveModelMediaOptions(input: {
  c: AppContext;
  modelKey: string;
}): Promise<{
  durationOptions: number[];
  maxReferenceImages: number | null;
  resolutionOptions: string[];
  sizeOptions: string[];
  aspectRatioOptions: string[];
}> {
  const wanted = normalizeKey(input.modelKey).replace(/-apimart$/, "");
  if (!wanted) throw new Error("video_model_key_required");
  const matched = await resolveExecutableVideoModel(input.c, wanted);
  if (!matched) throw new Error(`video_model_not_enabled:${input.modelKey}`);
  const videoOptions = matched.videoOptions;
  if (!videoOptions) {
    throw new Error(`video_model_options_missing:${input.modelKey}`);
  }
  const durationOptions = normalizeDurationList(
    videoOptions.durationOptions.map((option) => option.value),
  );
  const resolutionOptions = normalizeStringList(
    videoOptions.resolutionOptions.map((option) => option.value),
  );
  const sizeOptions = normalizeStringList(
    videoOptions.sizeOptions.map((option) => option.value),
  );
  const aspectRatioOptions = [...new Set([
    ...videoOptions.sizeOptions.flatMap((option) => [option.value, option.aspectRatio]),
    ...videoOptions.orientationOptions.map((option) => option.aspectRatio),
  ])];
  const normalizedAspectRatioOptions = normalizeStringList(aspectRatioOptions);
  if (
    durationOptions.length === 0 ||
    resolutionOptions.length === 0 ||
    normalizedAspectRatioOptions.length === 0
  ) {
    throw new Error(`video_model_options_missing:${input.modelKey}`);
  }
  return {
    durationOptions,
    maxReferenceImages: videoOptions.maxReferenceImages,
    resolutionOptions,
    sizeOptions,
    aspectRatioOptions: normalizedAspectRatioOptions,
  };
}

async function resolveExecutableVideoModel(
  c: AppContext,
  wanted: string,
): Promise<PublicChatEnabledVideoModelSummary | null> {
  const catalog = await loadPublicChatEnabledModelCatalogSummary(c, "");
  if (catalog.error || !catalog.summary) {
    throw new Error(`video_model_catalog_unavailable:${catalog.error || "summary_missing"}`);
  }
  return catalog.summary.videoModels.find((model) => {
    const modelKey = normalizeKey(model.modelKey).replace(/-apimart$/, "");
    const modelAlias = normalizeKey(model.modelAlias ?? "").replace(/-apimart$/, "");
    return modelKey === wanted || modelAlias === wanted;
  }) ?? null;
}

function normalizeStringList(values: readonly (string | null)[]): string[] {
  return [...new Set(values
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean))];
}
