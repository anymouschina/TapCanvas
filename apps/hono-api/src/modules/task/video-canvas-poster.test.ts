import { describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import {
  applyGeneratedVideoPoster,
  hasPersistedVideoPoster,
  readVideoInputPosterUrl,
  resolveCanvasVideoPoster,
} from "./video-canvas-poster";

const storageConfig = {
  provider: "tos" as const,
  endpoint: "https://tos.example.test",
  region: "test",
  bucket: "tapcanvas",
  accessKeyId: "test",
  secretAccessKey: "test",
  publicBase: "https://assets.example.test",
};

describe("video-canvas-poster", () => {
  it("uses the first real input image as the visible placeholder poster", () => {
    expect(readVideoInputPosterUrl({
      referenceImages: ["", "https://assets.example.test/keyframe.png"],
    })).toBe("https://assets.example.test/keyframe.png");
    expect(readVideoInputPosterUrl({
      videoInputPosterUrl: "https://assets.example.test/pinned.png",
      referenceImages: ["https://assets.example.test/fallback.png"],
    })).toBe("https://assets.example.test/pinned.png");
  });

  it("recognizes output thumbnails and inline posters as persisted poster evidence", () => {
    expect(hasPersistedVideoPoster({ videoThumbnailUrl: "https://assets.example.test/poster.jpg" })).toBe(true);
    expect(hasPersistedVideoPoster({ videoResults: [{ posterInline: "data:image/jpeg;base64,abc" }] })).toBe(true);
    expect(hasPersistedVideoPoster({ videoResults: [{ url: "https://assets.example.test/video.mp4" }] })).toBe(false);
  });

  it("extracts a first-frame poster from an already-hosted successful video", async () => {
    const extractPoster = vi.fn().mockResolvedValue({
      posterKey: "gen/video-posters/poster.jpg",
      posterUrl: "https://assets.example.test/gen/video-posters/poster.jpg",
    });
    const resolved = await resolveCanvasVideoPoster({
      c: { env: {} } as AppContext,
      userId: "user-1",
      videoUrl: "https://assets.example.test/gen/videos/video.mp4",
    }, {
      resolveStorageConfig: () => storageConfig,
      extractObjectKey: () => "gen/videos/video.mp4",
      extractPoster,
    });

    expect(resolved).toEqual({
      thumbnailUrl: "https://assets.example.test/gen/video-posters/poster.jpg",
      posterInline: null,
      source: "generated_first_frame",
      errorMessage: null,
    });
    expect(extractPoster).toHaveBeenCalledWith({
      videoR2Key: "gen/videos/video.mp4",
      userId: "user-1",
      timeoutMs: 30_000,
    });
  });

  it("preserves the successful video and returns explicit poster diagnostics when extraction fails", async () => {
    const resolved = await resolveCanvasVideoPoster({
      c: { env: {} } as AppContext,
      userId: "user-1",
      videoUrl: "https://assets.example.test/gen/videos/video.mp4",
    }, {
      resolveStorageConfig: () => storageConfig,
      extractObjectKey: () => "gen/videos/video.mp4",
      extractPoster: vi.fn().mockRejectedValue(new Error("media worker unavailable")),
    });
    expect(resolved).toMatchObject({
      thumbnailUrl: null,
      source: "unavailable",
      errorMessage: "media worker unavailable",
    });
  });

  it("writes a generated poster into both the root field and active video result", () => {
    const next = applyGeneratedVideoPoster({
      videoResults: [{ url: "https://assets.example.test/video.mp4" }],
      videoPrimaryIndex: 0,
      videoPosterBackfillError: "old error",
    }, {
      thumbnailUrl: "https://assets.example.test/poster.jpg",
      posterInline: null,
      source: "generated_first_frame",
      errorMessage: null,
    });
    expect(next).toMatchObject({
      videoThumbnailUrl: "https://assets.example.test/poster.jpg",
      videoResults: [{
        url: "https://assets.example.test/video.mp4",
        thumbnailUrl: "https://assets.example.test/poster.jpg",
      }],
      videoPosterBackfillStatus: "ready",
      videoPosterSource: "generated_first_frame",
    });
    expect(next).not.toHaveProperty("videoPosterBackfillError");
  });
});
