import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { mapFlowRowToDto, type FlowRow } from "../flow/flow.repo";
import { sanitizeFlowDataForStorage } from "../flow/flow.service";
import {
  resolveBoundVoiceCards,
  readVoiceCardProfile,
  extractSpokenDialogue,
  dubVideoNodeWithVoiceCard,
  type FlowNodeLike,
  type FlowEdgeLike,
  type VoiceCardProfile,
} from "./voice-card-dub";

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readFlowNodesEdges(row: FlowRow): { nodes: FlowNodeLike[]; edges: FlowEdgeLike[] } {
  const dto = mapFlowRowToDto(row);
  const data = sanitizeFlowDataForStorage(dto.data ?? {}) as Record<string, unknown>;
  const nodes = Array.isArray(data.nodes) ? (data.nodes as FlowNodeLike[]) : [];
  const edges = Array.isArray(data.edges) ? (data.edges as FlowEdgeLike[]) : [];
  return { nodes, edges };
}

function resolveNodeVideoUrl(nodeData: Record<string, unknown>): string {
  const direct = readTrimmedString(nodeData.videoUrl);
  if (direct) return direct;
  const videoResults = Array.isArray(nodeData.videoResults) ? nodeData.videoResults : [];
  for (const item of videoResults) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const url = readTrimmedString((item as Record<string, unknown>).url);
      if (url) return url;
    }
  }
  return "";
}

/** 台词来源：显式 dialogue 字段优先，否则从 clipPrompt/prompt/storyboardPrompt 抽引号对白。 */
function resolveNodeDialogue(nodeData: Record<string, unknown>): string {
  const explicit = readTrimmedString(nodeData.dialogue);
  if (explicit) return explicit;
  return extractSpokenDialogue(
    readTrimmedString(nodeData.clipPrompt),
    readTrimmedString(nodeData.prompt),
    readTrimmedString(nodeData.storyboardPrompt),
  );
}

export type DubVoiceCardToCanvasResult = {
  ok: true;
  videoNodeId: string;
  /** 配音后的成片 url（音轨已 mux 到视频上）。小T 用 flow_patch 把它回写到视频节点 videoUrl。 */
  videoUrl: string;
  /** 合成出的语音 url（可另起音频节点留档）。 */
  audioUrl: string;
  voiceId: string;
  character: string;
  dialogue: string;
  durationSec: number | null;
};

/**
 * 【配音卡 → 视频节点 配音】给一个视频节点配上「直连它的配音卡」的语音：
 * 解析该视频节点的 videoUrl + 台词（引号对白）+ 绑定的 voice_card → 即时 TTS 合成 → mux 到视频。
 * 只产出 url，不直接写节点（与 video_concat/annotate_shot 一致，由小T flow_patch 回写）。
 *
 * args:
 * - videoNodeId (required)：要配音的视频节点 id。
 * - voiceCardNodeId (optional)：显式指定配音卡节点；缺省时取直连该视频节点的 voice_card 上游（第一张）。
 * - dialogue (optional)：显式台词；缺省时读节点 dialogue 字段 / clipPrompt 引号对白。
 * - videoUrl (optional)：显式视频 url；缺省时从节点解析。
 */
export async function dubVoiceCardToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  row: FlowRow | null;
  bodyArgs: unknown;
}): Promise<DubVoiceCardToCanvasResult> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};

  const videoNodeId = readTrimmedString(args.videoNodeId) || readTrimmedString(args.nodeId);
  if (!videoNodeId) {
    throw new AppError("videoNodeId is required", {
      status: 400,
      code: "voice_dub_missing_node",
    });
  }
  if (!input.row) {
    throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
  }

  const { nodes, edges } = readFlowNodesEdges(input.row);
  const videoNode = nodes.find((n) => String(n?.id ?? "") === videoNodeId);
  if (!videoNode) {
    throw new AppError(`video node ${videoNodeId} not found`, {
      status: 404,
      code: "voice_dub_node_not_found",
    });
  }
  const videoData =
    videoNode.data && typeof videoNode.data === "object" && !Array.isArray(videoNode.data)
      ? (videoNode.data as Record<string, unknown>)
      : {};

  const videoUrl = readTrimmedString(args.videoUrl) || resolveNodeVideoUrl(videoData);
  if (!/^https?:\/\//.test(videoUrl)) {
    throw new AppError(`video node ${videoNodeId} has no videoUrl yet`, {
      status: 400,
      code: "voice_dub_no_video",
    });
  }

  const dialogue = readTrimmedString(args.dialogue) || resolveNodeDialogue(videoData);
  if (!dialogue) {
    throw new AppError(`video node ${videoNodeId} has no dialogue to dub (无引号对白)`, {
      status: 400,
      code: "voice_dub_no_dialogue",
    });
  }

  // 配音卡：显式 voiceCardNodeId 优先；否则取直连该视频节点的 voice_card 上游（v1 取第一张；
  // 一镜多角色对白 = v2）。都没有 → 明确报错，指引小T 先建卡+连边。
  let card: VoiceCardProfile | null = null;
  const explicitCardId = readTrimmedString(args.voiceCardNodeId);
  if (explicitCardId) {
    const cardNode = nodes.find((n) => String(n?.id ?? "") === explicitCardId);
    card = readVoiceCardProfile(cardNode);
    if (!card) {
      throw new AppError(`node ${explicitCardId} is not a voice_card`, {
        status: 400,
        code: "voice_dub_not_a_card",
      });
    }
  } else {
    card = resolveBoundVoiceCards(nodes, edges, videoNodeId)[0] ?? null;
    if (!card) {
      throw new AppError(
        `video node ${videoNodeId} 没有直连的配音卡（voice_card）。请先建一张 audioType=voice_card 的音频节点并把 out-audio 连到该视频节点。`,
        { status: 400, code: "voice_dub_no_card" },
      );
    }
  }

  const dubbed = await dubVideoNodeWithVoiceCard(input.c, input.requestUserId, {
    videoUrl,
    dialogueText: dialogue,
    card,
    genderHintText:
      readTrimmedString(videoData.clipPrompt) || readTrimmedString(videoData.prompt),
  });
  if (!dubbed) {
    throw new AppError("voice dub produced no output", {
      status: 502,
      code: "voice_dub_failed",
    });
  }

  return {
    ok: true,
    videoNodeId,
    videoUrl: dubbed.videoUrl,
    audioUrl: dubbed.audioUrl,
    voiceId: dubbed.voiceId,
    character: dubbed.character,
    dialogue: dubbed.dialogue,
    durationSec: dubbed.durationSec,
  };
}
