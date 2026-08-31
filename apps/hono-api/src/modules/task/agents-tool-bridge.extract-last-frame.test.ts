import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowRow } from "../flow/flow.repo";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { extractLastFrameToImage } from "./agents-tool-bridge.extract-last-frame";

const dependencies = vi.hoisted(() => ({
  createAssetRow: vi.fn(),
  createObjectStorageClientFromConfig: vi.fn(),
  extractLastFrameViaMediaWorker: vi.fn(),
  resolveObjectStorageConfig: vi.fn(),
}));

vi.mock("../asset/asset.repo", () => ({
  createAssetRow: dependencies.createAssetRow,
}));

vi.mock("../asset/rustfs.client", () => ({
  createObjectStorageClientFromConfig:
    dependencies.createObjectStorageClientFromConfig,
  resolveObjectStorageConfig: dependencies.resolveObjectStorageConfig,
}));

vi.mock("../../platform/media-worker/client", () => ({
  extractLastFrameViaMediaWorker:
    dependencies.extractLastFrameViaMediaWorker,
}));

function makeRow(nodes: Array<Record<string, unknown>>): FlowRow {
  return {
    id: "flow-1",
    name: "Flow",
    data: JSON.stringify({ nodes, edges: [] }),
    owner_id: "user-1",
    project_id: "project-1",
    created_at: "2026-05-31T00:00:00.000Z",
    updated_at: "2026-05-31T00:00:00.000Z",
  };
}

describe("extractLastFrameToImage input resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.resolveObjectStorageConfig.mockReturnValue(undefined);
    dependencies.extractLastFrameViaMediaWorker.mockResolvedValue(undefined);
  });

  it("throws missing-video when neither videoUrl nor a resolvable node is given", async () => {
    const err = await extractLastFrameToImage({
      c: { env: {} } as AppContext,
      ownerId: "user-1",
      row: makeRow([]),
      bodyArgs: {},
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_extract_frame_missing_video");
  });

  it("throws missing-video when the referenced node has no videoUrl", async () => {
    const err = await extractLastFrameToImage({
      c: { env: {} } as AppContext,
      ownerId: "user-1",
      row: makeRow([{ id: "n1", type: "taskNode", data: { kind: "video" } }]),
      bodyArgs: { nodeId: "n1" },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_extract_frame_missing_video");
  });

  it("resolves a video url from node data before any ffmpeg work", async () => {
    // With a resolvable videoUrl the missing-video gate must pass; depending on
    // whether object storage env is present the next failure is either the
    // storage check or the (unreachable example URL) download/ffmpeg step —
    // both prove the nodeId -> data.videoUrl resolution path executed.
    const err = await extractLastFrameToImage({
      c: { env: {} } as AppContext,
      ownerId: "user-1",
      row: makeRow([
        {
          id: "n1",
          type: "taskNode",
          data: { kind: "video", videoUrl: "https://example.invalid/clip.mp4" },
        },
      ]),
      bodyArgs: { nodeId: "n1" },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).not.toBe("agents_tool_extract_frame_missing_video");
    expect([
      "agents_tool_extract_frame_storage_unconfigured",
      "agents_tool_extract_frame_failed",
    ]).toContain((err as AppError).code);
  });

  it("persists a worker-produced frame as an ID-addressable image asset without returning its URL", async () => {
    const frameUrl = "https://file.beqlee.icu/generated/last-frame.png";
    dependencies.resolveObjectStorageConfig.mockReturnValue({
      endpoint: "https://storage.example.com",
      region: "auto",
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "tapcanvas",
      publicBase: "https://file.beqlee.icu",
      forcePathStyle: true,
    });
    dependencies.createObjectStorageClientFromConfig.mockReturnValue({});
    dependencies.extractLastFrameViaMediaWorker.mockResolvedValue({ frameUrl });
    dependencies.createAssetRow.mockResolvedValue({
      id: "asset-last-frame",
      name: "视频尾帧 · n1",
      data: JSON.stringify({ type: "image", url: frameUrl }),
      owner_id: "user-1",
      project_id: "project-1",
      created_at: "2026-07-30T00:00:00.000Z",
      updated_at: "2026-07-30T00:00:00.000Z",
    });

    const result = await extractLastFrameToImage({
      c: { env: { DB: {} } } as AppContext,
      ownerId: "user-1",
      row: makeRow([
        {
          id: "n1",
          type: "taskNode",
          data: { kind: "video", videoUrl: "https://example.com/clip.mp4" },
        },
      ]),
      bodyArgs: { nodeId: "n1" },
    });

    expect(result).toEqual({
      ok: true,
      reference: {
        referenceId: "asset:asset-last-frame",
        source: "asset",
        nodeId: null,
        assetId: "asset-last-frame",
        assetRefId: null,
        name: "视频尾帧 · n1",
        mediaType: "image",
        ready: true,
      },
      referenceAssetIds: ["asset-last-frame"],
    });
    expect(result).not.toHaveProperty("frameUrl");
    expect(dependencies.createAssetRow).toHaveBeenCalledWith(
      expect.anything(),
      "user-1",
      {
        name: "视频尾帧 · n1",
        data: {
          kind: "generation",
          type: "image",
          url: frameUrl,
          taskKind: "extract_last_frame",
          sourceVideoNodeId: "n1",
        },
        projectId: "project-1",
      },
      expect.any(String),
    );
  });
});
