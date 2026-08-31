import { createWriteStream } from "node:fs";
import { Readable, Transform, type TransformCallback } from "node:stream";
import { pipeline as streamPipeline } from "node:stream/promises";

import { AppError } from "../../middleware/error";

const DOUYIN_PAGE_HOSTS = new Set([
  "douyin.com",
  "www.douyin.com",
  "iesdouyin.com",
  "www.iesdouyin.com",
  "v.douyin.com",
]);

const DOUYIN_MEDIA_HOST_SUFFIXES = [
  "amemv.com",
  "bytecdn.cn",
  "bytecdn.com",
  "douyincdn.com",
  "douyinvod.com",
  "ixigua.com",
  "ixiguavideo.com",
  "pstatp.com",
  "snssdk.com",
  "zjcdn.com",
] as const;

const MOBILE_SAFARI_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
  "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const ROUTER_DATA_MARKER = "window._ROUTER_DATA = ";
const MAX_REDIRECTS = 5;
const MAX_SHARE_PAGE_CHARS = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type DouyinVideoMetadata = {
  videoId: string;
  title: string;
  durationSec: number;
  playUrl: string;
};

export type DouyinVideoDownloadResult = {
  title: string;
  durationSec: number;
  videoId: string;
  bytes: number;
  mediaHost: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isAsciiDigits(value: string): boolean {
  if (!value) return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 48 || code > 57) return false;
  }
  return true;
}

function hostnameMatchesSuffix(hostname: string, suffix: string): boolean {
  return hostname === suffix || hostname.endsWith(`.${suffix}`);
}

function safeUrlDetails(url: URL): { origin: string; pathname: string } {
  return { origin: url.origin, pathname: url.pathname };
}

function parseHttpsUrl(rawUrl: string, input: { code: string; message: string }): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError(input.message, {
      status: 400,
      code: input.code,
      details: { reason: "invalid_url" },
    });
  }
  if (url.protocol !== "https:") {
    throw new AppError(input.message, {
      status: 400,
      code: input.code,
      details: { reason: "https_required", protocol: url.protocol },
    });
  }
  return url;
}

function resolveHttpsRedirectUrl(input: {
  location: string;
  currentUrl: URL;
  code: string;
  message: string;
  stage: string;
}): URL {
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(input.location, input.currentUrl);
  } catch {
    throw new AppError(input.message, {
      status: 502,
      code: input.code,
      details: {
        stage: input.stage,
        reason: "invalid_redirect_url",
        ...safeUrlDetails(input.currentUrl),
      },
    });
  }
  if (redirectUrl.protocol !== "https:") {
    throw new AppError(input.message, {
      status: 502,
      code: input.code,
      details: {
        stage: input.stage,
        reason: "https_required",
        protocol: redirectUrl.protocol,
        ...safeUrlDetails(input.currentUrl),
      },
    });
  }
  return redirectUrl;
}

export function isDouyinPageUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && DOUYIN_PAGE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function isAllowedDouyinMediaUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      DOUYIN_MEDIA_HOST_SUFFIXES.some((suffix) => hostnameMatchesSuffix(hostname, suffix))
    );
  } catch {
    return false;
  }
}

function readVideoIdFromPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (parts[index] !== "video") continue;
    const candidate = parts[index + 1] ?? "";
    if (isAsciiDigits(candidate)) return candidate;
  }
  return "";
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function resolveDouyinVideoId(pageUrl: string, fetchImpl: FetchLike): Promise<string> {
  let current = parseHttpsUrl(pageUrl, {
    code: "agents_tool_fetch_video_douyin_url_invalid",
    message: "抖音视频 URL 无效",
  });

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!DOUYIN_PAGE_HOSTS.has(current.hostname.toLowerCase())) {
      throw new AppError("抖音短链跳转到了未授权域名", {
        status: 422,
        code: "agents_tool_fetch_video_douyin_redirect_invalid",
        details: { stage: "resolve_video_id", ...safeUrlDetails(current) },
      });
    }

    const directVideoId = readVideoIdFromPath(current.pathname);
    if (directVideoId) return directVideoId;
    if (redirectCount === MAX_REDIRECTS) break;

    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        headers: { "user-agent": MOBILE_SAFARI_USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new AppError("解析抖音短链失败", {
        status: 502,
        code: "agents_tool_fetch_video_douyin_resolve_failed",
        details: {
          stage: "resolve_video_id",
          ...safeUrlDetails(current),
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }

    if (!isRedirectStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      throw new AppError("抖音 URL 中缺少可解析的作品 ID", {
        status: 422,
        code: "agents_tool_fetch_video_douyin_video_id_missing",
        details: {
          stage: "resolve_video_id",
          status: response.status,
          ...safeUrlDetails(current),
        },
      });
    }

    const location = readNonEmptyString(response.headers.get("location"));
    await response.body?.cancel().catch(() => undefined);
    if (!location) {
      throw new AppError("抖音短链响应缺少跳转地址", {
        status: 502,
        code: "agents_tool_fetch_video_douyin_redirect_missing",
        details: { stage: "resolve_video_id", status: response.status },
      });
    }
    current = resolveHttpsRedirectUrl({
      location,
      currentUrl: current,
      code: "agents_tool_fetch_video_douyin_redirect_invalid",
      message: "抖音短链返回了无效跳转地址",
      stage: "resolve_video_id",
    });
  }

  throw new AppError("抖音短链跳转次数超限，未取得作品 ID", {
    status: 422,
    code: "agents_tool_fetch_video_douyin_redirect_exhausted",
    details: { stage: "resolve_video_id", maxRedirects: MAX_REDIRECTS },
  });
}

export function parseDouyinRouterData(html: string, expectedVideoId: string): DouyinVideoMetadata {
  const markerIndex = html.indexOf(ROUTER_DATA_MARKER);
  const scriptEndIndex = markerIndex >= 0 ? html.indexOf("</script>", markerIndex) : -1;
  if (markerIndex < 0 || scriptEndIndex < 0) {
    throw new AppError("抖音分享页缺少结构化作品数据", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_metadata_missing",
      details: { stage: "parse_share_page", videoId: expectedVideoId },
    });
  }

  let rawJson = html.slice(markerIndex + ROUTER_DATA_MARKER.length, scriptEndIndex).trim();
  if (rawJson.endsWith(";")) rawJson = rawJson.slice(0, -1).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch (error) {
    throw new AppError("抖音分享页作品数据不是合法 JSON", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_metadata_invalid",
      details: {
        stage: "parse_share_page",
        videoId: expectedVideoId,
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }

  const root = readRecord(parsed);
  const loaderData = readRecord(root?.loaderData);
  const page = readRecord(loaderData?.["video_(id)/page"]);
  const videoInfo = readRecord(page?.videoInfoRes);
  if (videoInfo?.status_code !== 0) {
    throw new AppError("抖音分享页未返回可用的公开作品", {
      status: 422,
      code: "agents_tool_fetch_video_douyin_access_restricted",
      details: {
        stage: "validate_share_metadata",
        videoId: expectedVideoId,
        statusCode: videoInfo?.status_code ?? null,
      },
    });
  }

  const itemList = Array.isArray(videoInfo.item_list) ? videoInfo.item_list : [];
  const item = itemList
    .map(readRecord)
    .find((candidate) => readNonEmptyString(candidate?.aweme_id) === expectedVideoId);
  if (!item) {
    throw new AppError("抖音分享页返回的作品与请求 ID 不一致", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_video_id_mismatch",
      details: { stage: "validate_share_metadata", videoId: expectedVideoId },
    });
  }

  const riskInfo = readRecord(item.risk_infos);
  if (riskInfo?.reflow_unplayable === true || riskInfo?.reflow_unplayable === 1) {
    throw new AppError("该抖音作品不允许在分享页播放", {
      status: 422,
      code: "agents_tool_fetch_video_douyin_access_restricted",
      details: { stage: "validate_share_metadata", videoId: expectedVideoId },
    });
  }

  const video = readRecord(item.video);
  const durationMs = typeof video?.duration === "number" ? video.duration : Number.NaN;
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new AppError("抖音分享页缺少合法视频时长", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_duration_invalid",
      details: { stage: "validate_share_metadata", videoId: expectedVideoId },
    });
  }

  const playAddress = readRecord(video?.play_addr);
  const playUrls = Array.isArray(playAddress?.url_list) ? playAddress.url_list : [];
  const playUrl = readNonEmptyString(playUrls[0]);
  if (!playUrl || !isAllowedDouyinMediaUrl(playUrl)) {
    let mediaDetails: { origin?: string; pathname?: string; reason?: string } = {
      reason: playUrl ? "media_host_not_allowed" : "play_url_missing",
    };
    if (playUrl) {
      try {
        mediaDetails = { ...mediaDetails, ...safeUrlDetails(new URL(playUrl)) };
      } catch {
        mediaDetails = { reason: "play_url_invalid" };
      }
    }
    throw new AppError("抖音分享页返回了无效的媒体地址", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_media_url_invalid",
      details: { stage: "validate_share_metadata", videoId: expectedVideoId, ...mediaDetails },
    });
  }

  return {
    videoId: expectedVideoId,
    title: readNonEmptyString(item.desc),
    durationSec: Math.round(durationMs / 1000),
    playUrl,
  };
}

async function fetchDouyinMediaResponse(input: {
  playUrl: string;
  sharePageUrl: string;
  fetchImpl: FetchLike;
}): Promise<{ response: Response; finalUrl: URL }> {
  let current = parseHttpsUrl(input.playUrl, {
    code: "agents_tool_fetch_video_douyin_media_url_invalid",
    message: "抖音媒体地址无效",
  });

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    if (!isAllowedDouyinMediaUrl(current.toString())) {
      throw new AppError("抖音媒体跳转到了未授权域名", {
        status: 502,
        code: "agents_tool_fetch_video_douyin_media_redirect_invalid",
        details: { stage: "download_media", ...safeUrlDetails(current) },
      });
    }

    let response: Response;
    try {
      response = await input.fetchImpl(current, {
        redirect: "manual",
        headers: {
          accept: "video/*,*/*;q=0.8",
          referer: input.sharePageUrl,
          "user-agent": MOBILE_SAFARI_USER_AGENT,
        },
        signal: AbortSignal.timeout(5 * 60_000),
      });
    } catch (error) {
      throw new AppError("下载抖音媒体流失败", {
        status: 502,
        code: "agents_tool_fetch_video_douyin_download_failed",
        details: {
          stage: "download_media",
          ...safeUrlDetails(current),
          reason: error instanceof Error ? error.message : String(error),
        },
      });
    }

    if (isRedirectStatus(response.status)) {
      const location = readNonEmptyString(response.headers.get("location"));
      await response.body?.cancel().catch(() => undefined);
      if (!location) {
        throw new AppError("抖音媒体跳转响应缺少地址", {
          status: 502,
          code: "agents_tool_fetch_video_douyin_media_redirect_missing",
          details: { stage: "download_media", status: response.status },
        });
      }
      current = resolveHttpsRedirectUrl({
        location,
        currentUrl: current,
        code: "agents_tool_fetch_video_douyin_media_redirect_invalid",
        message: "抖音媒体返回了无效跳转地址",
        stage: "download_media",
      });
      continue;
    }

    return { response, finalUrl: current };
  }

  throw new AppError("抖音媒体跳转次数超限", {
    status: 502,
    code: "agents_tool_fetch_video_douyin_media_redirect_exhausted",
    details: { stage: "download_media", maxRedirects: MAX_REDIRECTS },
  });
}

async function streamVideoResponseToFile(input: {
  response: Response;
  outputFile: string;
  finalUrl: URL;
}): Promise<number> {
  if (!input.response.ok) {
    await input.response.body?.cancel().catch(() => undefined);
    throw new AppError("抖音媒体服务器返回失败状态", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_media_http_error",
      details: {
        stage: "download_media",
        status: input.response.status,
        ...safeUrlDetails(input.finalUrl),
      },
    });
  }

  const contentType = readNonEmptyString(input.response.headers.get("content-type")).toLowerCase();
  if (!contentType.startsWith("video/")) {
    await input.response.body?.cancel().catch(() => undefined);
    throw new AppError("抖音媒体响应不是视频", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_media_type_invalid",
      details: {
        stage: "download_media",
        contentType: contentType || null,
        ...safeUrlDetails(input.finalUrl),
      },
    });
  }
  if (!input.response.body) {
    throw new AppError("抖音媒体响应缺少内容", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_media_empty",
      details: { stage: "download_media", ...safeUrlDetails(input.finalUrl) },
    });
  }

  const declaredLengthRaw = readNonEmptyString(input.response.headers.get("content-length"));
  const declaredLength = declaredLengthRaw ? Number(declaredLengthRaw) : null;
  if (declaredLength !== null && (!Number.isFinite(declaredLength) || declaredLength <= 0)) {
    await input.response.body.cancel().catch(() => undefined);
    throw new AppError("抖音媒体响应包含非法长度", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_media_length_invalid",
      details: { stage: "download_media", declaredLength: declaredLengthRaw },
    });
  }
  if (declaredLength !== null && declaredLength > MAX_VIDEO_BYTES) {
    await input.response.body.cancel().catch(() => undefined);
    throw new AppError("抖音视频超过允许的下载大小", {
      status: 413,
      code: "agents_tool_fetch_video_douyin_media_too_large",
      details: { stage: "download_media", declaredLength, maxBytes: MAX_VIDEO_BYTES },
    });
  }

  let receivedBytes = 0;
  const byteLimiter = new Transform({
    transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback) {
      if (!(chunk instanceof Uint8Array)) {
        callback(new Error("media stream produced a non-binary chunk"));
        return;
      }
      receivedBytes += chunk.byteLength;
      if (receivedBytes > MAX_VIDEO_BYTES) {
        callback(new Error(`media stream exceeded ${MAX_VIDEO_BYTES} bytes`));
        return;
      }
      callback(null, chunk);
    },
  });

  try {
    await streamPipeline(
      Readable.fromWeb(input.response.body as Parameters<typeof Readable.fromWeb>[0]),
      byteLimiter,
      createWriteStream(input.outputFile, { flags: "wx" }),
    );
  } catch (error) {
    throw new AppError("写入抖音视频文件失败", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_download_failed",
      details: {
        stage: "write_media_file",
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }

  if (receivedBytes <= 0 || (declaredLength !== null && receivedBytes !== declaredLength)) {
    throw new AppError("抖音视频下载字节数与响应不一致", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_media_length_mismatch",
      details: { stage: "write_media_file", declaredLength, receivedBytes },
    });
  }
  return receivedBytes;
}

export async function downloadDouyinVideoToFile(input: {
  pageUrl: string;
  outputFile: string;
  fetchImpl?: FetchLike;
}): Promise<DouyinVideoDownloadResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const videoId = await resolveDouyinVideoId(input.pageUrl, fetchImpl);
  const sharePageUrl = `https://www.iesdouyin.com/share/video/${videoId}/?from_ssr=1`;

  let shareResponse: Response;
  try {
    shareResponse = await fetchImpl(sharePageUrl, {
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": MOBILE_SAFARI_USER_AGENT,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new AppError("读取抖音公开分享页失败", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_share_fetch_failed",
      details: {
        stage: "fetch_share_page",
        videoId,
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }

  if (!shareResponse.ok) {
    await shareResponse.body?.cancel().catch(() => undefined);
    throw new AppError("抖音公开分享页返回失败状态", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_share_http_error",
      details: { stage: "fetch_share_page", videoId, status: shareResponse.status },
    });
  }
  const shareContentType = readNonEmptyString(shareResponse.headers.get("content-type")).toLowerCase();
  if (!shareContentType.startsWith("text/html")) {
    await shareResponse.body?.cancel().catch(() => undefined);
    throw new AppError("抖音公开分享页响应类型无效", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_share_type_invalid",
      details: { stage: "fetch_share_page", videoId, contentType: shareContentType || null },
    });
  }

  const shareHtml = await shareResponse.text();
  if (!shareHtml || shareHtml.length > MAX_SHARE_PAGE_CHARS) {
    throw new AppError("抖音公开分享页内容为空或超过限制", {
      status: 502,
      code: "agents_tool_fetch_video_douyin_share_size_invalid",
      details: {
        stage: "fetch_share_page",
        videoId,
        chars: shareHtml.length,
        maxChars: MAX_SHARE_PAGE_CHARS,
      },
    });
  }

  const metadata = parseDouyinRouterData(shareHtml, videoId);
  const media = await fetchDouyinMediaResponse({
    playUrl: metadata.playUrl,
    sharePageUrl,
    fetchImpl,
  });
  const bytes = await streamVideoResponseToFile({
    response: media.response,
    finalUrl: media.finalUrl,
    outputFile: input.outputFile,
  });

  console.info("[fetch-video] douyin_public_video_downloaded", {
    videoId,
    durationSec: metadata.durationSec,
    bytes,
    mediaHost: media.finalUrl.hostname,
  });

  return {
    videoId,
    title: metadata.title,
    durationSec: metadata.durationSec,
    bytes,
    mediaHost: media.finalUrl.hostname,
  };
}
