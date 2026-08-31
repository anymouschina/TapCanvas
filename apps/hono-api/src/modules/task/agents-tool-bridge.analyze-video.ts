import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { readNewApiRelay } from "../agents/agents-llm-proxy";
import { mapFlowRowToDto, type FlowRow } from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import {
  ANALYZE_VIDEO_MAX_SEGMENT_SEC,
  needsSegmentSplit,
  sizeAwareMaxSegSec,
  VIDEO_UNDERSTAND_MAX_BYTES,
} from "./video-segment-plan";
import {
  probeVideoDurationSec,
  probeVideoSizeBytes,
  splitVideoUrlToSegments,
  transcodeToUnderstandingProxy,
} from "./agents-tool-bridge.video-split-io";
import { VIDEO_UNDERSTANDING_MODEL_KEY } from "./media-understanding-model";

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const DEFAULT_QA_PROMPT =
  "请客观评估这段视频：①是否真实动态(非静帧壁纸)②主体/产品与人物在镜头间是否一致(无漂移)③相机运镜与物理是否自然真实④是否有失真(拉腿/扭曲/闪烁/塑料感)⑤口播/声音⑥实拍真实感如何。逐项结论 + 总体是否达标(达标/需重打，指出问题)。";

/** 视频理解使用固定的多模态能力通道；调用参数无权覆盖模型。 */
export function resolveVideoUnderstandingModel(): string {
  return VIDEO_UNDERSTANDING_MODEL_KEY;
}

function resolveVideoUrlFromFlowNode(row: FlowRow, nodeId: string): string {
  const dto = mapFlowRowToDto(row);
  const data = sanitizeFlowDataForStorage(dto.data ?? {});
  const nodes = Array.isArray((data as Record<string, unknown>).nodes)
    ? ((data as Record<string, unknown>).nodes as Array<Record<string, unknown>>)
    : [];
  const node = nodes.find((n) => String(n.id ?? "") === nodeId);
  if (!node) return "";
  const d =
    node.data && typeof node.data === "object" && !Array.isArray(node.data)
      ? (node.data as Record<string, unknown>)
      : {};
  const direct = readTrimmedString(d.videoUrl) || readTrimmedString(d.video);
  if (direct) return direct;
  const vr = Array.isArray(d.videoResults) ? d.videoResults : [];
  for (const item of vr) {
    if (item && typeof item === "object") {
      const u = readTrimmedString((item as Record<string, unknown>).url);
      if (u) return u;
    }
  }
  return "";
}

export function extractResponsesText(responseText: string): string {
  try {
    const parsed: unknown = JSON.parse(responseText);
    const data = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
    const output = Array.isArray(data.output) ? data.output : [];
    let text = "";
    for (const item of output) {
      if (item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).type === "message") {
        const message = item as Record<string, unknown>;
        const content = Array.isArray(message.content) ? message.content : [];
        for (const block of content) {
          if (block && typeof block === "object" && !Array.isArray(block)) {
            const outputBlock = block as Record<string, unknown>;
            if (outputBlock.type === "output_text" && typeof outputBlock.text === "string") text += outputBlock.text;
          }
        }
      }
    }
    return text.trim();
  } catch {
    return responseText.trim();
  }
}

export type AnalyzeVideoResult = {
  ok: true;
  text: string;
  videoUrl: string;
  model: string;
  fps: number;
  promptHash: string;
  analysisHash: string;
  segmentCount: number;
  analyzedAt: string;
  dramaticCoverageHash?: string;
};

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalizeJson(record[key])]),
  );
}

function readDramaticCoverageContract(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const valid = value.every((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    return Number.isInteger(Number(record.clipIndex)) && Number(record.clipIndex) >= 0 &&
      Boolean(record.dramaticCoverage) && typeof record.dramaticCoverage === "object" &&
      !Array.isArray(record.dramaticCoverage);
  });
  return valid ? value : null;
}

async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildAnalyzeVideoResult(input: {
  text: string;
  videoUrl: string;
  model: string;
  fps: number;
  prompt: string;
  segmentCount: number;
  dramaticCoverage?: unknown[];
}): Promise<AnalyzeVideoResult> {
  return {
    ok: true,
    text: input.text,
    videoUrl: input.videoUrl,
    model: input.model,
    fps: input.fps,
    promptHash: await sha256Text(input.prompt),
    analysisHash: await sha256Text(input.text),
    segmentCount: input.segmentCount,
    analyzedAt: new Date().toISOString(),
    ...(input.dramaticCoverage
      ? { dramaticCoverageHash: await sha256Text(JSON.stringify(canonicalizeJson(input.dramaticCoverage))) }
      : {}),
  };
}

/**
 * Video understanding for the in-canvas agent (the video workflow's S8 QA needs
 * to score each shot/film, but video-understand was only an HTTP endpoint, not a
 * bridge tool — so analyze_video was unreachable and S8 would stall). Wraps the
 * same /v1/responses input_video call and returns the analysis text. Accepts a
 * direct videoUrl or a nodeId resolved from the current flow.
 */
export async function analyzeVideoForAgent(input: {
  c: AppContext;
  row: FlowRow | null;
  bodyArgs: unknown;
}): Promise<AnalyzeVideoResult> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};

  let videoUrl = readTrimmedString(args.videoUrl) || readTrimmedString(args.url);
  const nodeId = readTrimmedString(args.nodeId);
  if (!videoUrl && nodeId) {
    if (!input.row) throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
    videoUrl = resolveVideoUrlFromFlowNode(input.row, nodeId);
  }
  if (!videoUrl) {
    throw new AppError("videoUrl 或 nodeId(含视频) 必须提供一个", {
      status: 400,
      code: "agents_tool_analyze_video_missing_video",
    });
  }

  const relay = readNewApiRelay(input.c);
  if (!relay) {
    throw new AppError("NEW_API 中转未配置", { status: 500, code: "new_api_not_configured" });
  }

  const model = resolveVideoUnderstandingModel();
  const prompt = readTrimmedString(args.prompt) || readTrimmedString(args.question) || DEFAULT_QA_PROMPT;
  const fps = typeof args.fps === "number" && args.fps > 0 ? args.fps : 1;
  const dramaticCoverage = readDramaticCoverageContract(args.dramaticCoverage);
  if (args.dramaticCoverage !== undefined && !dramaticCoverage) {
    throw new AppError("dramaticCoverage 必须是非空的逐 clip 结构化承载合同", {
      status: 400,
      code: "agents_tool_analyze_video_invalid_dramatic_coverage",
    });
  }
  const analysisPrompt = dramaticCoverage
    ? `${prompt}\n\n【本次 writer 冻结的逐镜戏剧承载事实】${JSON.stringify(dramaticCoverage)}\n` +
      "请逐 clip、逐义务对照真实成片，仅报告视频中实际可见或可听的证据、缺失与影响；不得以合同文字本身当作成片证据。"
    : prompt;

	// A：视频理解模型单段 ≤15s。先 ffprobe 探时长 → >15s 则物理切 ≤15s 段、逐段理解、按时间段合并文本；
	// ≤15s/未知时长走原单段路径（零额外 IO）。
  const durationSec = await probeVideoDurationSec(videoUrl);
  const sizeBytes = await probeVideoSizeBytes(videoUrl);

  // 转【降分辨率 faststart 代理片】再喂理解。两类超时都靠它治：
  //   ① 超高分辨率/大文件(>38MiB)：模型 50MiB 上限 + 超宽 4K 拉取/解码超时；
  //   ② 上游(ARK/doubao-seed)拉不动我们的 TOS 公开域名(TOS public origin)原片——实测即便 4s 小片也直接
  //      "Timeout while processing video_url"。代理片缩到 1280/CRF30 + moov 前置(+faststart)，体积小、
  //      可流式起播，上游"处理"快得多，绕过该超时。
  // 因此默认【总是先转代理】(flag VIDEO_UNDERSTAND_ALWAYS_PROXY 默认 ON)；转码失败回退原片，不阻断。
  let understandUrl = videoUrl;
  let understandSize = sizeBytes;
  const alwaysProxy = (() => {
    const raw = String(
      (input.c.env as Record<string, unknown>)?.VIDEO_UNDERSTAND_ALWAYS_PROXY ??
        globalThis.process?.env?.VIDEO_UNDERSTAND_ALWAYS_PROXY ??
        "1",
    ).trim().toLowerCase();
    return raw !== "0" && raw !== "false" && raw !== "off";
  })();
  if (alwaysProxy || sizeBytes > VIDEO_UNDERSTAND_MAX_BYTES) {
    try {
      const proxy = await transcodeToUnderstandingProxy({ c: input.c, sourceUrl: videoUrl });
      understandUrl = proxy.url;
      understandSize = proxy.sizeBytes;
    } catch {
      // 转码失败 → 退回原片，由下方 size-aware 切段兜底。
    }
  }

	// 切段上限同时受【时长 ≤15s】与【大小 ≤38MiB】约束（代理后通常单段即可）。
  const maxSegSec = sizeAwareMaxSegSec(durationSec, understandSize, ANALYZE_VIDEO_MAX_SEGMENT_SEC);
  if (needsSegmentSplit(durationSec, maxSegSec)) {
    const segments = await splitVideoUrlToSegments({
      c: input.c,
      sourceUrl: understandUrl,
      durationSec,
      maxSegSec,
    });
    const parts: string[] = [];
    for (const seg of segments) {
      const segText = await analyzeOneVideoUrl({
        c: input.c,
        relay,
        videoUrl: seg.url,
        model,
        prompt: analysisPrompt,
        fps,
      });
      parts.push(`【${Math.round(seg.startSec)}–${Math.round(seg.endSec)}s】\n${segText}`);
    }
    return buildAnalyzeVideoResult({
      text:
        `本片时长约 ${Math.round(durationSec)}s，超过视频理解单段上限 ${ANALYZE_VIDEO_MAX_SEGMENT_SEC}s，` +
        `已自动切成 ${segments.length} 段分别理解（时间段标在各节标题，按序拼接即全片）：\n\n` +
        parts.join("\n\n---\n\n"),
      videoUrl,
      model,
      fps,
      prompt: analysisPrompt,
      segmentCount: segments.length,
      ...(dramaticCoverage ? { dramaticCoverage } : {}),
    });
  }

  const text = await analyzeOneVideoUrl({ c: input.c, relay, videoUrl: understandUrl, model, prompt: analysisPrompt, fps });
  return buildAnalyzeVideoResult({
    text,
    videoUrl,
    model,
    fps,
    prompt: analysisPrompt,
    segmentCount: 1,
    ...(dramaticCoverage ? { dramaticCoverage } : {}),
  });
}

/** 单段视频理解（≤15s）：构造 input_video 请求 + 3 次重试，返回理解文本。供整段与逐段复用。
 * 也导出给导演拆解工具（distill-director-breakdown）复用同一 relay/重试 plumbing。 */
export async function analyzeOneVideoUrl(input: {
  c: AppContext;
  relay: { baseUrl: string; token: string };
  videoUrl: string;
  model: string;
  prompt: string;
  fps: number;
}): Promise<string> {
  const requestBody = {
    model: input.model,
    input: [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_video", video_url: input.videoUrl, fps: input.fps },
          { type: "input_text", text: input.prompt },
        ],
      },
    ],
  };
  const targetUrl = `${input.relay.baseUrl}/v1/responses`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetchWithHttpDebugLog(
        input.c,
        targetUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${input.relay.token}` },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(120_000),
        },
        { tag: "agents-tool-analyze-video" },
      );
      if (!res.ok) {
        lastErr = new AppError(`视频理解上游 ${res.status}`, {
          status: res.status >= 500 ? 502 : res.status,
          code: "agents_tool_analyze_video_upstream",
          details: { status: res.status, body: (await res.text().catch(() => "")).slice(0, 300) },
        });
      } else {
        const text = extractResponsesText(await res.text());
        if (text) return text;
        lastErr = new AppError("视频理解未返回文本", {
          status: 502,
          code: "agents_tool_analyze_video_empty",
        });
      }
    } catch (err) {
      lastErr = err;
    }
    if (attempt < 2) await sleep(2000 * (attempt + 1));
  }
  if (lastErr instanceof AppError) throw lastErr;
  throw new AppError("视频理解失败（上游多次重试仍不可用）", {
    status: 502,
    code: "agents_tool_analyze_video_failed",
    details: { message: lastErr instanceof Error ? lastErr.message : String(lastErr) },
  });
}
