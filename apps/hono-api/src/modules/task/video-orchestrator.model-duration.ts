import type { AppContext } from "../../types";
import { listModelCatalogModels } from "../model-catalog/model-catalog.service";

/**
 * 数据驱动地解析某视频模型的合法时长档位（durationOptions），唯一真相源 = modelCatalog
 * 的 videoOptions.durationOptions（管理后台配置）。禁止在代码里写死 15/10/5。
 *
 * 只允许从 modelCatalog 读取。目录读取失败、模型不存在或 durationOptions 缺失都显式失败；
 * 禁止使用 LLM 草稿或代码默认值继续，因为那会让 writer/critic 与真实提交采用不同合同。
 */
export async function resolveModelDurationOptions(input: {
  c: AppContext;
  modelKey: string;
}): Promise<number[]> {
  // catalog 里视频模型 kind 统一是 "video"（不是 image_to_video/text_to_video）；与
  // resolveModelMaxDurationSeconds 对齐，并对 -apimart 后缀归一化匹配（否则查空→拆段退化为单段）。
  const wanted = normalizeKey(input.modelKey).replace(/-apimart$/, "");
  if (wanted) {
    const models = await listModelCatalogModels(input.c, { kind: "video", enabled: true });
    const matched = models.find((m) => {
      const mk = normalizeKey(m.modelKey).replace(/-apimart$/, "");
      const ma = normalizeKey(m.modelAlias ?? "").replace(/-apimart$/, "");
      return mk === wanted || ma === wanted;
    });
    if (!matched) throw new Error(`video_model_not_enabled:${input.modelKey}`);
    const opts = extractDurationOptionsFromMeta(matched.meta);
    if (opts.length) return opts;
    throw new Error(`video_model_duration_options_missing:${input.modelKey}`);
  }
  throw new Error("video_model_key_required");
}

function extractDurationOptionsFromMeta(meta: unknown): number[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const videoOptions = (meta as Record<string, unknown>).videoOptions;
  if (!videoOptions || typeof videoOptions !== "object" || Array.isArray(videoOptions)) {
    return [];
  }
  const durationOptions = (videoOptions as Record<string, unknown>).durationOptions;
  if (!Array.isArray(durationOptions)) return [];
  const out: number[] = [];
  for (const item of durationOptions) {
    if (typeof item === "number" && Number.isFinite(item) && item > 0) {
      out.push(Math.trunc(item));
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const value = (item as Record<string, unknown>).value;
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        out.push(Math.trunc(value));
      }
    }
  }
  return normalizeDurationList(out);
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
 * 解析视频模型的媒体选项（时长/分辨率/画幅），唯一真相源 = modelCatalog 的
 * videoOptions（管理后台配置）。禁止写死枚举。供工作流按次注入参数做确定性
 * 校验：调用方指定的 resolution/aspectRatio 不在目录内时显式失败，不允许把
 * 非法参数漏给供应商后再收到晦涩报错。
 */
export async function resolveModelMediaOptions(input: {
  c: AppContext;
  modelKey: string;
}): Promise<{
  durationOptions: number[];
  resolutionOptions: string[];
  aspectRatioOptions: string[];
}> {
  const wanted = normalizeKey(input.modelKey).replace(/-apimart$/, "");
  if (!wanted) throw new Error("video_model_key_required");
  const models = await listModelCatalogModels(input.c, { kind: "video", enabled: true });
  const matched = models.find((m) => {
    const mk = normalizeKey(m.modelKey).replace(/-apimart$/, "");
    const ma = normalizeKey(m.modelAlias ?? "").replace(/-apimart$/, "");
    return mk === wanted || ma === wanted;
  });
  if (!matched) throw new Error(`video_model_not_enabled:${input.modelKey}`);
  if (!matched.meta || typeof matched.meta !== "object" || Array.isArray(matched.meta)) {
    throw new Error(`video_model_options_missing:${input.modelKey}`);
  }
  const videoOptions = (matched.meta as Record<string, unknown>).videoOptions;
  if (!videoOptions || typeof videoOptions !== "object" || Array.isArray(videoOptions)) {
    throw new Error(`video_model_options_missing:${input.modelKey}`);
  }
  const record = videoOptions as Record<string, unknown>;
  const durationOptions = extractDurationOptionsFromMeta(matched.meta);
  const resolutionOptions = extractStringList(record.resolutionOptions);
  const sizeOptions = Array.isArray(record.sizeOptions) ? record.sizeOptions : [];
  const aspectRatioOptions = [...new Set([
    ...extractStringList(record.aspectRatioOptions),
    ...sizeOptions.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const value = (item as Record<string, unknown>).value;
      return typeof value === "string" && value.trim() ? [value.trim()] : [];
    }),
  ])];
  if (durationOptions.length === 0 || resolutionOptions.length === 0 || aspectRatioOptions.length === 0) {
    throw new Error(`video_model_options_missing:${input.modelKey}`);
  }
  return { durationOptions, resolutionOptions, aspectRatioOptions };
}

function extractStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
    } else if (item && typeof item === "object" && !Array.isArray(item)) {
      const entry = item as Record<string, unknown>;
      const v = typeof entry.value === "string" ? entry.value.trim() : "";
      if (v) out.push(v);
    }
  }
  return [...new Set(out)];
}
