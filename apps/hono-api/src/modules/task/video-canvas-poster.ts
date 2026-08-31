import type { AppContext } from "../../types";
import { extractPosterViaMediaWorker } from "../../platform/media-worker/client";
import {
  extractObjectStorageObjectKey,
  resolveObjectStorageConfig,
} from "../asset/rustfs.client";

type ObjectStorageConfig = NonNullable<ReturnType<typeof resolveObjectStorageConfig>>;

type VideoPosterDependencies = {
  resolveStorageConfig: (env: AppContext["env"]) => ObjectStorageConfig | null;
  extractObjectKey: (config: ObjectStorageConfig, rawUrl: string) => string | null;
  extractPoster: (input: {
    videoR2Key: string;
    userId: string;
    timeoutMs: number;
  }) => Promise<{ posterKey: string; posterUrl: string } | null>;
};

const DEFAULT_DEPENDENCIES: VideoPosterDependencies = {
  resolveStorageConfig: resolveObjectStorageConfig,
  extractObjectKey: extractObjectStorageObjectKey,
  extractPoster: extractPosterViaMediaWorker,
};

export type CanvasVideoPosterResolution = {
  thumbnailUrl: string | null;
  posterInline: string | null;
  source: "provider" | "generated_first_frame" | "unavailable";
  errorMessage: string | null;
};

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isDisplayableImageUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || value.startsWith("data:image/");
}

export function readVideoInputPosterUrl(data: Record<string, unknown>): string | null {
  const directCandidates = [data.videoInputPosterUrl, data.firstFrameUrl];
  for (const candidate of directCandidates) {
    const value = readTrimmedString(candidate);
    if (value && isDisplayableImageUrl(value)) return value;
  }
  const referenceImages = Array.isArray(data.referenceImages) ? data.referenceImages : [];
  for (const candidate of referenceImages) {
    const value = readTrimmedString(candidate);
    if (value && isDisplayableImageUrl(value)) return value;
  }
  return null;
}

export function hasPersistedVideoPoster(data: Record<string, unknown>): boolean {
  if (readTrimmedString(data.videoThumbnailUrl)) return true;
  const results = Array.isArray(data.videoResults) ? data.videoResults : [];
  return results.some((result) => {
    if (!result || typeof result !== "object" || Array.isArray(result)) return false;
    const record = result as Record<string, unknown>;
    return Boolean(
      readTrimmedString(record.thumbnailUrl) ||
      readTrimmedString(record.posterInline),
    );
  });
}

export function applyGeneratedVideoPoster(
  data: Record<string, unknown>,
  resolution: CanvasVideoPosterResolution,
): Record<string, unknown> {
  const thumbnailUrl = readTrimmedString(resolution.thumbnailUrl);
  const posterInline = readTrimmedString(resolution.posterInline);
  const rawResults = Array.isArray(data.videoResults) ? data.videoResults : [];
  const results = rawResults.map((result) =>
    result && typeof result === "object" && !Array.isArray(result)
      ? { ...(result as Record<string, unknown>) }
      : result,
  );
  const primaryIndex =
    typeof data.videoPrimaryIndex === "number" &&
    Number.isInteger(data.videoPrimaryIndex) &&
    data.videoPrimaryIndex >= 0
      ? data.videoPrimaryIndex
      : 0;
  const primary = results[primaryIndex];
  if (primary && typeof primary === "object" && !Array.isArray(primary)) {
    results[primaryIndex] = {
      ...(primary as Record<string, unknown>),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
      ...(posterInline ? { posterInline } : {}),
    };
  }
  const {
    videoPosterBackfillError: _previousError,
    ...rest
  } = data;
  return {
    ...rest,
    ...(thumbnailUrl ? { videoThumbnailUrl: thumbnailUrl } : {}),
    ...(results.length ? { videoResults: results } : {}),
    videoPosterBackfillStatus: "ready",
    videoPosterSource: resolution.source,
  };
}

export async function resolveCanvasVideoPoster(
  input: {
    c: AppContext;
    userId: string;
    videoUrl: string;
    thumbnailUrl?: string | null;
    posterInline?: string | null;
  },
  dependencies: VideoPosterDependencies = DEFAULT_DEPENDENCIES,
): Promise<CanvasVideoPosterResolution> {
  const thumbnailUrl = readTrimmedString(input.thumbnailUrl);
  const posterInline = readTrimmedString(input.posterInline);
  if (thumbnailUrl || posterInline) {
    return {
      thumbnailUrl: thumbnailUrl || null,
      posterInline: posterInline || null,
      source: "provider",
      errorMessage: null,
    };
  }

  const config = dependencies.resolveStorageConfig(input.c.env);
  if (!config) {
    return {
      thumbnailUrl: null,
      posterInline: null,
      source: "unavailable",
      errorMessage: "video_poster_storage_not_configured",
    };
  }
  const objectKey = dependencies.extractObjectKey(config, input.videoUrl);
  if (!objectKey) {
    return {
      thumbnailUrl: null,
      posterInline: null,
      source: "unavailable",
      errorMessage: "video_poster_object_key_unresolved",
    };
  }

  try {
    const extracted = await dependencies.extractPoster({
      videoR2Key: objectKey,
      userId: input.userId,
      timeoutMs: 30_000,
    });
    const generatedUrl = readTrimmedString(extracted?.posterUrl);
    if (!generatedUrl) {
      return {
        thumbnailUrl: null,
        posterInline: null,
        source: "unavailable",
        errorMessage: "video_poster_extractor_returned_empty",
      };
    }
    return {
      thumbnailUrl: generatedUrl,
      posterInline: null,
      source: "generated_first_frame",
      errorMessage: null,
    };
  } catch (error) {
    return {
      thumbnailUrl: null,
      posterInline: null,
      source: "unavailable",
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
