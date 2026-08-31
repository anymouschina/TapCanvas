import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FlowRow } from "../flow/flow.repo";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";

// --- Mocks -----------------------------------------------------------------
// Object storage: always "configured", and every PutObject/GetObject resolves.
const sendMock = vi.fn().mockResolvedValue({});
vi.mock("../asset/rustfs.client", () => ({
  resolveObjectStorageConfig: () => ({
    bucket: "test-bucket",
    publicBase: "https://cdn.test",
  }),
  createObjectStorageClientFromConfig: () => ({ send: sendMock }),
}));

// child_process.execFile — ffprobe returns dimensions, ffmpeg is a no-op.
vi.mock("node:child_process", () => ({
  execFile: (cmd: string, _args: unknown, opts: unknown, cb?: unknown) => {
    const callback = (typeof opts === "function" ? opts : cb) as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    if (cmd === "ffprobe") {
      callback(null, "1920x1080\n", "");
      return;
    }
    callback(null, "", "");
  },
}));

// fs/promises — no real disk IO for the extraction helpers.
vi.mock("node:fs/promises", () => ({
  mkdtemp: async () => "/tmp/framesat-test",
  writeFile: async () => undefined,
  rm: async () => undefined,
}));

const uploadFileMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../asset/asset.hosting.stream-upload", () => ({
  putFileToStorage: (...args: unknown[]) => uploadFileMock(...args),
}));

vi.mock("../../platform/node/task-workspace", () => ({
  createTaskWorkspace: async () => ({
    path: "/tmp/framesat-test",
    freeBytesBeforeCreate: 1,
    cleanup: async () => undefined,
  }),
}));

// stream-download: the byte-streaming download helper is unit-tested on its own
// (stream-download.test.ts); here we stub it so the extraction logic runs
// without real disk/network IO.
const streamDownloadMock = vi.fn();
vi.mock("../asset/stream-download", () => ({
  streamDownloadToFile: (...args: unknown[]) => streamDownloadMock(...args),
}));

import { extractFramesAtForAgent } from "./agents-tool-bridge.extract-frames-at";

function makeRow(nodes: Array<Record<string, unknown>>): FlowRow {
  return {
    id: "flow-1",
    name: "Flow",
    data: JSON.stringify({ nodes, edges: [] }),
    owner_id: "user-1",
    project_id: "project-1",
    created_at: "2026-05-31T00:00:00.000Z",
    updated_at: "2026-05-31T00:00:00.000Z",
  } as unknown as FlowRow;
}

const PUBLIC_VIDEO = "https://example.invalid/clip.mp4";

beforeEach(() => {
  sendMock.mockClear();
  uploadFileMock.mockClear();
  streamDownloadMock.mockClear();
  streamDownloadMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractFramesAtForAgent input validation", () => {
  it("throws missing-times when the times array is empty", async () => {
    const err = await extractFramesAtForAgent({
      c: { env: {} } as AppContext,
      row: makeRow([]),
      bodyArgs: { videoUrl: PUBLIC_VIDEO, times: [] },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_extract_frames_missing_times");
  });

  it("throws missing-times when every timestamp is invalid", async () => {
    const err = await extractFramesAtForAgent({
      c: { env: {} } as AppContext,
      row: makeRow([]),
      bodyArgs: { videoUrl: PUBLIC_VIDEO, times: ["nope", -3, -1] },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_extract_frames_missing_times");
  });

  it("throws missing-video when neither videoUrl nor a resolvable node is given", async () => {
    const err = await extractFramesAtForAgent({
      c: { env: {} } as AppContext,
      row: makeRow([]),
      bodyArgs: { times: [1.0, 2.0] },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_extract_frames_missing_video");
  });
});

describe("extractFramesAtForAgent extraction", () => {
  it("extracts one frame per timestamp and returns sorted webp urls with dimensions", async () => {
    const result = await extractFramesAtForAgent({
      c: { env: {} } as AppContext,
      row: makeRow([]),
      bodyArgs: { videoUrl: PUBLIC_VIDEO, times: [2.0, 1.0] },
    });

    expect(result.ok).toBe(true);
    expect(result.frames).toHaveLength(2);
    // ascending time order
    expect(result.frames.map((f) => f.time)).toEqual([1.0, 2.0]);
    for (const frame of result.frames) {
      expect(frame.url.startsWith("https://cdn.test/gen/images/framesat/")).toBe(true);
      expect(frame.url.endsWith(".webp")).toBe(true);
      expect(frame.width).toBe(1920);
      expect(frame.height).toBe(1080);
    }
    // one streaming object-storage upload per extracted frame
    expect(uploadFileMock).toHaveBeenCalledTimes(2);
  });

  it("resolves the video url from a flow node's data.videoUrl", async () => {
    const result = await extractFramesAtForAgent({
      c: { env: {} } as AppContext,
      row: makeRow([
        {
          id: "n1",
          type: "taskNode",
          data: { kind: "video", videoUrl: PUBLIC_VIDEO },
        },
      ]),
      bodyArgs: { nodeId: "n1", times: [0.5] },
    });
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.time).toBe(0.5);
    expect(result.frames[0]!.url.endsWith(".webp")).toBe(true);
  });

  it("normalizes, dedupes and sorts timestamps, dropping invalid values", async () => {
    const result = await extractFramesAtForAgent({
      c: { env: {} } as AppContext,
      row: makeRow([]),
      bodyArgs: { videoUrl: PUBLIC_VIDEO, times: [1.5, "invalid", -1, 0.5, 2.0, 1.5] },
    });
    // "invalid" + -1 dropped, duplicate 1.5 collapsed, sorted ascending.
    expect(result.frames.map((f) => f.time)).toEqual([0.5, 1.5, 2.0]);
  });

  it("wraps unexpected failures as a 502 AppError with the extract-frames code", async () => {
    streamDownloadMock.mockRejectedValueOnce(new Error("network down"));
    const err = await extractFramesAtForAgent({
      c: { env: {} } as AppContext,
      row: makeRow([]),
      bodyArgs: { videoUrl: PUBLIC_VIDEO, times: [1.0] },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_extract_frames_failed");
    expect((err as AppError).status).toBe(502);
  });
});
