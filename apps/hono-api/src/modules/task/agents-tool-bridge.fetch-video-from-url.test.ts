import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";

// --- Mocks -----------------------------------------------------------------
// Object storage: always "configured", every PutObject resolves.
const sendMock = vi.fn().mockResolvedValue({});
vi.mock("../asset/rustfs.client", () => ({
  resolveObjectStorageConfig: () => ({
    bucket: "test-bucket",
    publicBase: "https://cdn.test",
  }),
  createObjectStorageClientFromConfig: () => ({ send: sendMock }),
}));

// fs/promises — no real disk IO; readFile yields fake mp4 bytes.
vi.mock("node:fs/promises", () => ({
  mkdtemp: async () => "/tmp/fetchvid-test",
  readFile: async () => Buffer.from("fake-mp4-bytes"),
  rm: async () => undefined,
}));

// child_process.execFile is driven per-test via this programmable handler so we can
// simulate yt-dlp success / arbitrary stderr / ENOENT / generic failure.
type ExecHandler = (
  cmd: string,
  args: string[],
) => { error: (Error & { code?: string | number }) | null; stdout: string; stderr: string };

let execHandler: ExecHandler = () => ({ error: null, stdout: "", stderr: "" });

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: unknown, opts: unknown, cb?: unknown) => {
    const callback = (typeof opts === "function" ? opts : cb) as (
      err: Error | null,
      stdout: string,
      stderr: string,
    ) => void;
    const { error, stdout, stderr } = execHandler(cmd, args as string[]);
    callback(error, stdout, stderr);
  },
}));

import { fetchVideoFromUrlForAgent } from "./agents-tool-bridge.fetch-video-from-url";

const PAGE_URL = "https://www.bilibili.com/video/BV1xx411c7mD";

function ctx(): AppContext {
  return { env: {} } as AppContext;
}

beforeEach(() => {
  sendMock.mockClear();
  execHandler = () => ({ error: null, stdout: "", stderr: "" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchVideoFromUrlForAgent success", () => {
  it("downloads, uploads to R2 and returns an mp4 direct url with metadata", async () => {
    execHandler = (_cmd, args) => {
      // metadata probe (--print) returns title + duration; download is a no-op.
      if (args.includes("--print")) {
        return { error: null, stdout: "万妖图录传 第一集\n183\n", stderr: "" };
      }
      return { error: null, stdout: "", stderr: "" };
    };

    const result = await fetchVideoFromUrlForAgent({ c: ctx(), bodyArgs: { pageUrl: PAGE_URL } });

    expect(result.ok).toBe(true);
    expect(result.sourcePage).toBe(PAGE_URL);
    expect(result.videoUrl.startsWith("https://cdn.test/gen/videos/fetched/")).toBe(true);
    expect(result.videoUrl.endsWith(".mp4")).toBe(true);
    expect(result.title).toBe("万妖图录传 第一集");
    expect(result.durationSec).toBe(183);
    // exactly one PutObject (the fetched mp4)
    expect(sendMock).toHaveBeenCalledTimes(1);
    const putArg = sendMock.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(putArg.input.ContentType).toBe("video/mp4");
  });

  it("still succeeds (omitting metadata) when the probe fails", async () => {
    execHandler = (_cmd, args) => {
      if (args.includes("--print")) {
        return { error: Object.assign(new Error("probe boom"), { code: 1 }), stdout: "", stderr: "" };
      }
      return { error: null, stdout: "", stderr: "" };
    };

    const result = await fetchVideoFromUrlForAgent({ c: ctx(), bodyArgs: { pageUrl: PAGE_URL } });
    expect(result.ok).toBe(true);
    expect(result.title).toBeUndefined();
    expect(result.durationSec).toBeUndefined();
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe("fetchVideoFromUrlForAgent failures", () => {
  it("throws missing-url (400) when pageUrl is absent", async () => {
    const err = await fetchVideoFromUrlForAgent({ c: ctx(), bodyArgs: {} }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_fetch_video_missing_url");
    expect((err as AppError).status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("does not infer DRM from members-only or sign-in stderr", async () => {
    execHandler = () => ({
      error: Object.assign(new Error("exit 1"), { code: 1 }),
      stdout: "",
      stderr: "ERROR: This video is only available to members-only. Please sign in.",
    });
    const err = await fetchVideoFromUrlForAgent({ c: ctx(), bodyArgs: { pageUrl: PAGE_URL } }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_fetch_video_ytdlp_failed");
    expect((err as AppError).status).toBe(502);
    expect((err as AppError).details).toEqual({
      stderr: "ERROR: This video is only available to members-only. Please sign in.",
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("maps ENOENT (yt-dlp missing) to 500 ytdlp_missing", async () => {
    execHandler = () => ({
      error: Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" }),
      stdout: "",
      stderr: "",
    });
    const err = await fetchVideoFromUrlForAgent({ c: ctx(), bodyArgs: { pageUrl: PAGE_URL } }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_fetch_video_ytdlp_missing");
    expect((err as AppError).status).toBe(500);
  });

  it("does not infer unsupported-provider semantics from yt-dlp stderr", async () => {
    execHandler = () => ({
      error: Object.assign(new Error("exit 1"), { code: 1 }),
      stdout: "",
      stderr: "ERROR: Unsupported URL: https://example.invalid/foo",
    });
    const err = await fetchVideoFromUrlForAgent({ c: ctx(), bodyArgs: { pageUrl: PAGE_URL } }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_fetch_video_ytdlp_failed");
    expect((err as AppError).status).toBe(502);
    expect((err as AppError).details).toEqual({
      stderr: "ERROR: Unsupported URL: https://example.invalid/foo",
    });
  });

  it("returns the same explicit yt-dlp failure contract for other process errors", async () => {
    execHandler = () => ({
      error: Object.assign(new Error("exit 1"), { code: 1 }),
      stdout: "",
      stderr: "ERROR: HTTP Error 500: Internal Server Error",
    });
    const err = await fetchVideoFromUrlForAgent({ c: ctx(), bodyArgs: { pageUrl: PAGE_URL } }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("agents_tool_fetch_video_ytdlp_failed");
    expect((err as AppError).status).toBe(502);
    expect((err as AppError).details).toEqual({
      stderr: "ERROR: HTTP Error 500: Internal Server Error",
    });
  });
});
