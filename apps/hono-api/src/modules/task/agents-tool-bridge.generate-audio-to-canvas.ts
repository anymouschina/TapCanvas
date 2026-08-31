import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import type { FlowRow } from "../flow/flow.repo";
import {
  synthesizeSpeechToStorage,
  synthesizeDoubaoSpeechToStorage,
  isDoubaoSpeechModel,
  generateMusicToStorage,
} from "../apiKey/audio-speech";
import { requireSelectableAudioModel } from "../new-api-models/new-api-audio-model";
import { resolveTeamCreditsCostForTask } from "../billing/billing.service";
import {
  releaseTeamCreditsOnFailure,
  requireSufficientTeamCredits,
  settleTeamCreditsOnSuccess,
} from "../team/team.service";
import { listDoubaoSeedAudioVoices } from "../apiKey/seed-audio-voices";
import { autoPickVoiceId, voiceCardDisplayFields } from "./voice-card-dub";
import { inferCharacterGender } from "./face-dna";
import {
  pickVoiceForRole,
  characterGenderHintFromCards,
  collectLibVoiceMeta,
} from "./video-orchestrator.asset-selfheal";
import { listMaterialAssets } from "../material/material.repo";
import { getPrismaClient } from "../../platform/node/prisma";
import { persistFlowPatch, readFlowNodes } from "./video-orchestrator.flow-io";
import { maybeAutoRegisterVoiceCard } from "./material-auto-register";
import { registerGeneratedMediaAsset } from "../asset/asset.hosting";

// 【音频节点生成工具·补工具缺口】此前 agent(小T) 唯一的语音工具是 tapcanvas_voice_card_dub，它必须挂在
// 一个已有视频节点上（做「TTS + mux 到视频」），画布无视频节点时就无法凭空出一段音频/试听音色/建配音卡。
// 本工具直接走 /audio/speech 的 TTS 核心（synthesizeSpeechToStorage），把语音合成成独立音频节点落画布：
//  - audioType=speech（默认）：把 text 合成为配音/旁白音频节点（可连到视频/成片节点作音轨）。
//  - audioType=voice_card：建「配音卡」（可复用音色锚，voiceCharacter=角色名）；带 text 则同时出一段试听。
//  - audioType=music：曲风/氛围描述（text）→ MiniMax music 生成独立 BGM/环境音节点（与 /audio/music
//    路由同口径按次计费；lyricsMode 默认 instrumental 纯音乐）。mixExclude=true 标记「独立素材」——
//    collectComposeAudioNodeIds 收编混音时跳过（章级 BGM 用户在剪辑软件自行拼接，混进成片=双轨打架）。
//    上游无时长参数：短曲诉求写进 prompt（如「30秒短引子/可循环」），成品时长以实际为准。
// 与角色卡「成对生成」：出角色卡时同时对该角色调本工具（audioType=voice_card + voiceCharacter）建声音卡。

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export type GenerateAudioToCanvasResult = {
  ok: true;
  flowId: string;
  nodeId: string;
  audioUrl: string;
  assetId: string;
  durationSec: number | null;
  voiceId: string;
  audioType: string;
  voiceCharacter: string;
};

async function resolveCanvasProjectId(input: {
  row: FlowRow | null;
  flowId: string;
  chapterId?: string;
}): Promise<string> {
  const rowProjectId = readTrimmedString(input.row?.project_id);
  if (rowProjectId) return rowProjectId;
  const prisma = getPrismaClient();
  if (input.chapterId) {
    const chapter = await prisma.chapters.findUnique({
      where: { id: input.chapterId },
      select: { project_id: true },
    });
    const chapterProjectId = readTrimmedString(chapter?.project_id);
    if (chapterProjectId) return chapterProjectId;
  }
  const flow = await prisma.flows.findUnique({
    where: { id: input.flowId },
    select: { project_id: true },
  });
  const flowProjectId = readTrimmedString(flow?.project_id);
  if (flowProjectId) return flowProjectId;
  throw new AppError("音频资产缺少所属项目，未开始生成", {
    status: 400,
    code: "audio_asset_project_missing",
    details: { flowId: input.flowId, chapterId: input.chapterId ?? null },
  });
}

export async function generateAudioToCanvas(input: {
  c: AppContext;
  requestUserId: string;
  devBypass: boolean;
  flowId: string;
  row: FlowRow | null;
  bodyArgs: unknown;
  chapterId?: string;
}): Promise<GenerateAudioToCanvasResult> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};
  // 允许 { node: { data: {...} } }（与生图工具对称）或扁平 { text, voiceId, ... } 两种入参。
  const node =
    args.node && typeof args.node === "object" && !Array.isArray(args.node)
      ? (args.node as Record<string, unknown>)
      : {};
  const nodeData =
    node.data && typeof node.data === "object" && !Array.isArray(node.data)
      ? (node.data as Record<string, unknown>)
      : args;

  const text = readTrimmedString(nodeData.text);
  const voiceId =
    readTrimmedString(nodeData.voiceId) || readTrimmedString(nodeData.doubaoVoiceId);
  const requireExactVoiceId = nodeData.requireExactVoiceId === true;
  const audioType = (readTrimmedString(nodeData.audioType) || "speech").toLowerCase();
  if (audioType !== "speech" && audioType !== "music" && audioType !== "voice_card") {
    throw new AppError("audioType 必须是 speech、music 或 voice_card", {
      status: 400,
      code: "audio_gen_type_invalid",
      details: { audioType },
    });
  }
  const voiceCharacter =
    readTrimmedString(nodeData.voiceCharacter) || readTrimmedString(nodeData.roleName);
  const requestedModel = readTrimmedString(nodeData.audioModel);
  const emotion = readTrimmedString(nodeData.emotion);
  const speed = readNumber(nodeData.speed);
  const mixExclude =
    nodeData.mixExclude === true || readTrimmedString(nodeData.mixExclude).toLowerCase() === "true";
  const label =
    readTrimmedString(nodeData.label) ||
    (audioType === "voice_card"
      ? `配音卡｜${voiceCharacter || "未命名"}`
      : audioType === "music"
        ? "BGM"
        : voiceCharacter
          ? `配音｜${voiceCharacter}`
          : "配音");

  if (audioType === "voice_card" && !voiceCharacter) {
    throw new AppError("voice_card 需要 voiceCharacter（角色名）", {
      status: 400,
      code: "audio_gen_voice_card_no_character",
    });
  }
  if (audioType !== "voice_card" && !text) {
    throw new AppError("text is required（speech=口播文案；music=曲风/氛围描述）", {
      status: 400,
      code: "audio_gen_no_text",
    });
  }

  const projectId = await resolveCanvasProjectId({
    row: input.row,
    flowId: input.flowId,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });

  const catalogModel = await requireSelectableAudioModel(
    input.c,
    requestedModel,
    audioType === "music" ? "music" : "speech",
  );
  if (
    audioType === "voice_card" &&
    !catalogModel.tags.some(
      (tag) => tag.trim().toLowerCase() === "tapcanvas:audio-engine=doubao",
    )
  ) {
    throw new AppError("voice_card 必须选择支持豆包音色目录的语音模型", {
      status: 400,
      code: "audio_model_engine_mismatch",
      details: { requestedModel, expectedEngine: "doubao" },
    });
  }
  const model = catalogModel.requestModelKey;

  // 【音色路由 + 有效性解析】模型来自实时目录。此前 bug：无论模型是不是豆包，
  // 都走 MiniMax 的 synthesizeSpeechToStorage —— 它在 voiceId 空时兜底成 MiniMax speaker
  // `male-qn-qingse`，打到 seed-audio relay 就报「speaker not found in speaker_map」；小T
  // 手填的豆包 speaker id 也常是猜的（不在真实目录）→ 同样报错、还触发防死循环停手。
  // 根治：豆包模型走豆包合成路径；voiceId 若空 or 不在真实豆包目录，则按「角色名+性别」
  // 确定性从 414 富音色目录挑一把有效音色（与 asset-selfheal / VOICE_CARD_AUTO_DUB 同口径：
  // 同角色跨镜跨章恒定同一把嗓），彻底消除假 speaker id 与哑卡。
  const useDoubao = isDoubaoSpeechModel(model);
  let resolvedVoiceId = voiceId;
  if (useDoubao) {
    const catalog = requireExactVoiceId
      ? await listDoubaoSeedAudioVoices(input.c)
      : await listDoubaoSeedAudioVoices(input.c).catch(() => []);
    const inCatalog = !!resolvedVoiceId && catalog.some((v) => v.id === resolvedVoiceId);
    if (requireExactVoiceId && !inCatalog) {
      throw new AppError("冻结选声计划中的 voiceId 不在实时音色目录中，未开始生成", {
        status: 409,
        code: "audio_voice_exact_id_unavailable",
        details: { voiceId: resolvedVoiceId || null, model },
      });
    }
    if (!inCatalog) {
      const seed = voiceCharacter || label || (text ? text.slice(0, 8) : "voice");
      // 排重：画布上其他角色配音卡已占用的音色不再挑（撞车实测：白大褂男/黑T恤男同嗓）。
      const usedVoiceIds = new Set<string>();
      const flowNodes = input.row ? readFlowNodes(input.row) : [];
      // 性别：角色名 + 同名角色卡文本一起判（2026-07-16「姨妈」实测：纯名判不出 → 全池撞男声）。
      const genderHint = characterGenderHintFromCards(
        flowNodes as Array<Record<string, unknown>>,
        voiceCharacter,
      );
      const profileText = `${voiceCharacter} ${genderHint || text || ""}`;
      const gender = inferCharacterGender(profileText);
      for (const n of flowNodes) {
        const d = (n?.data ?? {}) as Record<string, unknown>;
        if (
          String(d.audioType ?? "").toLowerCase() === "voice_card" &&
          String(d.voiceCharacter ?? "").trim() !== voiceCharacter &&
          typeof d.doubaoVoiceId === "string" &&
          d.doubaoVoiceId.trim()
        ) {
          usedVoiceIds.add(d.doubaoVoiceId.trim());
        }
      }
      // 撞嗓守恒跨画布+库（2026-07-17 林七夜/阿诺同嗓根治）：项目库 voice 资产占用的音色一并排除。
      try {
        const prisma = getPrismaClient();
        let projectId = "";
        if (input.chapterId) {
          const ch = await prisma.chapters.findUnique({
            where: { id: input.chapterId },
            select: { project_id: true },
          });
          projectId = ch?.project_id ?? "";
        } else if (input.flowId) {
          const fl = await prisma.flows.findUnique({
            where: { id: input.flowId },
            select: { project_id: true },
          });
          projectId = fl?.project_id ?? "";
        }
        if (projectId) {
          const libVoices = await listMaterialAssets(input.c.env.DB, {
            ownerId: input.requestUserId,
            projectId,
            kind: "voice",
          } as never);
          for (const vid of collectLibVoiceMeta(libVoices as never).voiceIds) usedVoiceIds.add(vid);
        }
      } catch {
        // best-effort：库读失败不阻断建卡
      }
      if (catalog.length) {
        resolvedVoiceId = autoPickVoiceId(catalog, {
          ...(gender ? { gender } : {}),
          seedName: seed,
          excludeIds: usedVoiceIds,
          profileText,
        });
      }
      if (!resolvedVoiceId) resolvedVoiceId = pickVoiceForRole(seed, genderHint || text).voiceId;
    }
  }

  // 合成语音：有 text 就出音频。voice_card 不带 text 时**自动配一段试听文案**——
  // 用户拍板：配音卡是一等资产，必须有真实音频文件（纯音色锚=哑卡，"没有生成资产"）。
  // 文案 ~30 字：太短会触发豆包 seed-audio 短句异常（重复/灌静音到 60s+）。
  const effectiveText =
    text ||
    (audioType === "voice_card" && voiceCharacter
      ? `大家好，我是${voiceCharacter}。这是我在本剧中的声音，用于音色试听与跨章节的声音锁定。`
      : "");
  let audioUrl = "";
  let durationSec: number | null = null;
  let usedVoiceId = resolvedVoiceId;
  if (audioType === "music") {
    // 与 /audio/music 路由同口径：只接受 new-api /api/pricing 实时按次价，缺价显式失败。
    const lyricsModeRaw = readTrimmedString(nodeData.lyricsMode).toLowerCase();
    const lyricsMode =
      lyricsModeRaw === "auto" || lyricsModeRaw === "custom" ? lyricsModeRaw : "instrumental";
    const lyrics = readTrimmedString(nodeData.lyrics);
    const required = await resolveTeamCreditsCostForTask(input.c, {
      taskKind: "text_to_audio",
      modelKey: model,
    });
    const reservation = await requireSufficientTeamCredits(input.c, input.requestUserId, {
      required,
      taskKind: "text_to_audio",
      vendor: "new_api",
      modelKey: model,
    });
    try {
      const r = await generateMusicToStorage(input.c, input.requestUserId, {
        prompt: text,
        lyrics: lyrics || null,
        lyricsMode,
        model,
      });
      audioUrl = r.url;
      durationSec = r.durationSec;
      if (reservation) {
        await settleTeamCreditsOnSuccess(input.c, input.requestUserId, {
          taskId: reservation.reservationTaskId,
          taskKind: "text_to_audio",
          amount: reservation.amount,
          vendor: "new_api",
          modelKey: model,
        });
      }
    } catch (err) {
      if (reservation) {
        await releaseTeamCreditsOnFailure(input.c, input.requestUserId, {
          taskId: reservation.reservationTaskId,
          taskKind: "text_to_audio",
          vendor: "new_api",
          modelKey: model,
        }).catch(() => {});
      }
      throw err;
    }
  } else if (effectiveText) {
    if (useDoubao) {
      // MiniMax 的 speed 是 0.5~2.0 倍率；豆包 seed-audio 的 speechRate 是 -50~100（0=常速）。
      const speechRate =
        speed !== null ? Math.max(-50, Math.min(100, Math.round((speed - 1) * 100))) : null;
      const r = await synthesizeDoubaoSpeechToStorage(input.c, input.requestUserId, {
        text: effectiveText,
        model,
        voiceId: resolvedVoiceId || null,
        ...(speechRate !== null ? { speechRate } : {}),
      });
      audioUrl = r.url;
      durationSec = r.durationSec;
      usedVoiceId = r.voiceId || resolvedVoiceId;
    } else {
      const r = await synthesizeSpeechToStorage(input.c, input.requestUserId, {
        text: effectiveText,
        model,
        voiceId: voiceId || null,
        ...(emotion ? { emotion } : {}),
        ...(speed !== null ? { speed } : {}),
      } as never);
      audioUrl = r.url;
      durationSec = r.durationSec;
      usedVoiceId = r.voiceId || voiceId;
    }
  }

  const nodeId = readTrimmedString(node.id) || crypto.randomUUID();
  let assetId = "";
  let assetRegistrationError: string | null = null;
  try {
    assetId = await registerGeneratedMediaAsset({
      c: input.c,
      userId: input.requestUserId,
      meta: {
        type: "audio",
        url: audioUrl,
        sourceUrl: audioUrl,
        vendor: useDoubao ? "doubao" : "new_api",
        taskKind: "text_to_audio",
        prompt: effectiveText || text,
        modelKey: model,
        durationSec,
        generationContext: {
          projectId,
          nodeId,
          ...(input.chapterId ? { chapterId: input.chapterId } : { flowId: input.flowId }),
        },
      },
    });
  } catch (error) {
    assetRegistrationError = error instanceof Error ? error.message : String(error);
  }
  // voiceLabel/label 单一真相源（2026-07-17 三层错乱根治）：配音卡的 voiceLabel 必须与最终
  // doubaoVoiceId 在同一目录里配对生成；label 若调用方没自定义则同源合成。
  let voiceCardLabelFields: Record<string, unknown> = {};
  if (audioType === "voice_card" && voiceCharacter && usedVoiceId) {
    const catalogForLabel = await listDoubaoSeedAudioVoices(input.c).catch(() => []);
    const display = voiceCardDisplayFields(voiceCharacter, usedVoiceId, catalogForLabel);
    voiceCardLabelFields = {
      ...(display.voiceLabel ? { voiceLabel: display.voiceLabel } : {}),
    };
  }
  const finalNodeData: Record<string, unknown> = {
    kind: "audio",
    audioType,
    ...(audioUrl ? { audioUrl } : {}),
    ...(assetId ? { assetId, serverAssetId: assetId } : {}),
    ...(audioUrl
      ? {
          audioResults: [
            {
              url: audioUrl,
              ...(assetId ? { assetId } : {}),
              ...(durationSec ? { duration: durationSec } : {}),
            },
          ],
        }
      : {}),
    assetRegistrationStatus: assetId ? "ready" : "failed",
    ...(assetRegistrationError ? { assetRegistrationError } : {}),
    ...(durationSec ? { audioDurationSec: durationSec } : {}),
    ...(usedVoiceId ? { doubaoVoiceId: usedVoiceId } : {}),
    ...(voiceCharacter ? { voiceCharacter, roleName: voiceCharacter } : {}),
    ...voiceCardLabelFields,
    ...(effectiveText ? { text: effectiveText } : {}),
    // 独立素材标记：true = 不被 collectComposeAudioNodeIds 收编进成片混音（章级 BGM 用户自行剪辑拼接）。
    ...(mixExclude ? { mixExclude: true } : {}),
    audioModel: model,
    label,
    status: "success",
  };
  const px = readNumber((node.position as Record<string, unknown>)?.x);
  const py = readNumber((node.position as Record<string, unknown>)?.y);
  const finalNode = {
    id: nodeId,
    type: "taskNode",
    position: { x: px ?? 1600, y: py ?? 320 },
    data: finalNodeData,
  };

  // 落画布：persistFlowPatch 按有无 chapterId 自动路由到章节画布 or flows 表（乐观并发重试 + SSE 广播）。
  if (input.chapterId) {
    await persistFlowPatch({
      c: input.c,
      row: input.row ?? ({} as FlowRow),
      flowId: input.flowId,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      patch: { createNodes: [finalNode] } as never,
      affectedNodeIds: [nodeId],
      chapterId: input.chapterId,
    });
  } else {
    if (!input.row) {
      throw new AppError("Flow not found", { status: 404, code: "flow_not_found" });
    }
    await persistFlowPatch({
      c: input.c,
      row: input.row,
      flowId: input.flowId,
      requestUserId: input.requestUserId,
      devBypass: input.devBypass,
      patch: { createNodes: [finalNode] } as never,
      affectedNodeIds: [nodeId],
    });
  }

  // 配音卡自动入库（kind=voice）：与角色卡对等，供跨章按名复用同一把嗓。best-effort，不阻断。
  if (audioType === "voice_card" && voiceCharacter) {
    await maybeAutoRegisterVoiceCard({
      c: input.c,
      userId: input.requestUserId,
      nodeData: finalNodeData,
      nodeId,
      ...(input.chapterId ? { chapterId: input.chapterId } : {}),
      ...(input.flowId ? { flowId: input.flowId } : {}),
    });
  }

  if (assetRegistrationError || !assetId) {
    throw new AppError("音频已生成并写入画布，但登记到 Assets 失败", {
      status: 500,
      code: "audio_asset_registration_partial_success",
      details: {
        nodeId,
        audioUrl,
        projectId,
        reason: assetRegistrationError || "asset id missing",
      },
    });
  }

  return {
    ok: true,
    flowId: input.chapterId || input.flowId,
    nodeId,
    audioUrl,
    assetId,
    durationSec,
    voiceId: usedVoiceId,
    audioType,
    voiceCharacter,
  };
}
