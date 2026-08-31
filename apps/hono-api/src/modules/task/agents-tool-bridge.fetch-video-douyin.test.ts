import { describe, expect, it } from "vitest";

import { AppError } from "../../middleware/error";
import {
  isAllowedDouyinMediaUrl,
  isDouyinPageUrl,
  parseDouyinRouterData,
} from "./agents-tool-bridge.fetch-video-douyin";

const VIDEO_ID = "7668901037944684409";
const PLAY_URL = "https://aweme.snssdk.com/aweme/v1/play/?video_id=test";

type RouterFixtureOptions = {
  statusCode?: number;
  itemVideoId?: string;
  title?: string;
  durationMs?: number;
  playUrl?: string;
  reflowUnplayable?: boolean | number;
};

function buildRouterHtml(options: RouterFixtureOptions = {}): string {
  const routerData = {
    loaderData: {
      "video_(id)/page": {
        videoInfoRes: {
          status_code: options.statusCode ?? 0,
          item_list: [
            {
              aweme_id: options.itemVideoId ?? VIDEO_ID,
              desc: options.title ?? "《Bleach — 黑崎一护 无月》",
              risk_infos: {
                reflow_unplayable: options.reflowUnplayable ?? 0,
              },
              video: {
                duration: options.durationMs ?? 37_300,
                play_addr: {
                  url_list: [options.playUrl ?? PLAY_URL],
                },
              },
            },
          ],
        },
      },
    },
  };
  return `<html><script>window._ROUTER_DATA = ${JSON.stringify(routerData)};</script></html>`;
}

async function captureAppError(run: () => unknown): Promise<AppError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("Expected AppError");
}

describe("Douyin URL boundaries", () => {
  it("accepts only explicit HTTPS Douyin page hosts", () => {
    expect(isDouyinPageUrl("https://v.douyin.com/R84Kjl4lW34")).toBe(true);
    expect(isDouyinPageUrl(`https://www.iesdouyin.com/share/video/${VIDEO_ID}/`)).toBe(true);
    expect(isDouyinPageUrl("http://v.douyin.com/R84Kjl4lW34")).toBe(false);
    expect(isDouyinPageUrl("https://v.douyin.com.evil.example/R84Kjl4lW34")).toBe(false);
  });

  it("accepts exact ByteDance media suffixes and rejects suffix confusion", () => {
    expect(isAllowedDouyinMediaUrl(PLAY_URL)).toBe(true);
    expect(isAllowedDouyinMediaUrl("https://video.douyinvod.com/path/video.mp4")).toBe(true);
    expect(isAllowedDouyinMediaUrl("https://snssdk.com.evil.example/path/video.mp4")).toBe(false);
    expect(isAllowedDouyinMediaUrl("http://aweme.snssdk.com/path/video.mp4")).toBe(false);
  });
});

describe("parseDouyinRouterData", () => {
  it("extracts the exact public work metadata and first validated play URL", () => {
    const metadata = parseDouyinRouterData(buildRouterHtml(), VIDEO_ID);

    expect(metadata).toEqual({
      videoId: VIDEO_ID,
      title: "《Bleach — 黑崎一护 无月》",
      durationSec: 37,
      playUrl: PLAY_URL,
    });
  });

  it("fails when the share page reports a non-success status", async () => {
    const error = await captureAppError(() =>
      parseDouyinRouterData(buildRouterHtml({ statusCode: 4 }), VIDEO_ID),
    );

    expect(error.code).toBe("agents_tool_fetch_video_douyin_access_restricted");
    expect(error.status).toBe(422);
  });

  it("fails when returned metadata belongs to another work", async () => {
    const error = await captureAppError(() =>
      parseDouyinRouterData(buildRouterHtml({ itemVideoId: "7000000000000000000" }), VIDEO_ID),
    );

    expect(error.code).toBe("agents_tool_fetch_video_douyin_video_id_mismatch");
  });

  it("fails when the public share metadata marks playback unavailable", async () => {
    const error = await captureAppError(() =>
      parseDouyinRouterData(buildRouterHtml({ reflowUnplayable: 1 }), VIDEO_ID),
    );

    expect(error.code).toBe("agents_tool_fetch_video_douyin_access_restricted");
  });

  it("fails rather than following an unapproved media host", async () => {
    const error = await captureAppError(() =>
      parseDouyinRouterData(
        buildRouterHtml({ playUrl: "https://snssdk.com.evil.example/video.mp4" }),
        VIDEO_ID,
      ),
    );

    expect(error.code).toBe("agents_tool_fetch_video_douyin_media_url_invalid");
  });

  it("fails explicitly when structured router data is absent", async () => {
    const error = await captureAppError(() => parseDouyinRouterData("<html></html>", VIDEO_ID));

    expect(error.code).toBe("agents_tool_fetch_video_douyin_metadata_missing");
  });
});
