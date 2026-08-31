import type { AppContext } from "../../types";
import type { ParentAgentExecution } from "./agent-execution-provenance";
import {
  clipArtifactKey,
  orchestrateVideoCommitBeats,
  type ReadyClipArtifactSeed,
} from "./video-orchestrator.authoring";
import {
  advanceAuthoringState,
  listAuthoringArtifacts,
  type AuthoringArtifactRow,
} from "./video-orchestrator.authoring.repo";
import type { VideoGenerationContract } from "./video-orchestrator.generation-contract";
import {
  freshReadFlowRow,
  persistFlowPatch,
  readFlowNodes,
  type VideoFlowNode,
} from "./video-orchestrator.flow-io";
import {
  rebindReplanBeatSheetReferences,
} from "./video-orchestrator.replan-reference";
import {
  transformClonedReplanBeatSheet,
  type RequestedPreservedClipMapping,
} from "./video-orchestrator.replan-transform";
import { stampVideoReplanLineage } from "./video-orchestrator.replan-lineage";
import { getVideoRun } from "./video-run.repo";

type PreservedClipMapping = RequestedPreservedClipMapping & {
  nodeId: string;
};

type PreservedArtifactSourceRef = {
  runId: string;
  clipIndex: number;
};

type ReplanPreservationValidation =
  | { ok: true; mappings: PreservedClipMapping[] }
  | { ok: false; code: string; message: string; nodeIds?: string[]; nodeId?: string };

function readTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readIndex(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function isReplanSourceTerminalFailure(input: {
  state: string | null | undefined;
  authoringState: string | null | undefined;
  totalClips?: number;
  clipsDone?: number;
}): boolean {
  return (
    input.state === "failed" ||
    (input.state === "collecting" && input.authoringState === "authoring_failed") ||
    (input.state === "cancelled" &&
      input.authoringState === "authoring_done" &&
      input.totalClips === 0 &&
      input.clipsDone === 0)
  );
}

function parsePreservedClipMappings(value: unknown): RequestedPreservedClipMapping[] | null {
  if (!Array.isArray(value)) return null;
  const mappings: RequestedPreservedClipMapping[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    const sourceClipIndex = readIndex(record.sourceClipIndex);
    const targetClipIndex = readIndex(record.targetClipIndex);
    if (sourceClipIndex == null || targetClipIndex == null) return null;
    mappings.push({ sourceClipIndex, targetClipIndex });
  }
  return mappings;
}

export function clonePersistedBeatSheet(
  beatSheetJson: string | null | undefined,
): Record<string, unknown> | null {
  if (!beatSheetJson) return null;
  try {
    const parsed: unknown = JSON.parse(beatSheetJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function readPersistedBeatSheetVideoModel(
  beatSheetJson: string | null | undefined,
): string {
  const beatSheet = clonePersistedBeatSheet(beatSheetJson);
  if (!beatSheet) return "";
  const meta = beatSheet.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return "";
  return readTrimmed((meta as Record<string, unknown>).videoModel);
}

function nodeData(node: VideoFlowNode): Record<string, unknown> {
  return node.data && typeof node.data === "object" && !Array.isArray(node.data)
    ? (node.data as Record<string, unknown>)
    : {};
}

export function buildPreservedArtifactSourceRefs(input: {
  sourceRunId: string;
  sourceClipIndex: number;
  node: VideoFlowNode;
}): PreservedArtifactSourceRef[] {
  const reused = nodeData(input.node).reusedRenderedClip;
  if (!reused || typeof reused !== "object" || Array.isArray(reused)) {
    return [{ runId: input.sourceRunId, clipIndex: input.sourceClipIndex }];
  }
  const reusedRecord = reused as Record<string, unknown>;
  const reusedRunId = readTrimmed(reusedRecord.sourceRunId);
  const reusedClipIndex = readIndex(reusedRecord.sourceClipIndex);
  if (reusedRunId && reusedClipIndex != null) {
    // 节点里的视频由这份血缘指向的 writer 工件生产；当前 source run 后来生成的
    // 同镜号 writer 不能反向证明旧视频与新输入一致，否则会把“新提示词 + 旧视频”
    // 错绑为可复用成片。
    return [{ runId: reusedRunId, clipIndex: reusedClipIndex }];
  }
  return [];
}

export function readPreservedReadyClipIndexes(result: Record<string, unknown>): number[] {
  if (!Array.isArray(result.preservedReadyClipIndexes)) return [];
  const indexes: number[] = [];
  for (const value of result.preservedReadyClipIndexes) {
    const index = readIndex(value);
    if (index != null && !indexes.includes(index)) indexes.push(index);
  }
  return indexes;
}

export function selectAcceptedPreservedMappings<T extends { targetClipIndex: number }>(
  mappings: T[],
  preservedReadyClipIndexes: number[],
): T[] {
  const acceptedIndexes = new Set(preservedReadyClipIndexes);
  return mappings.filter((mapping) => acceptedIndexes.has(mapping.targetClipIndex));
}

export function sourceRunVideoNodes(nodes: VideoFlowNode[], sourceRunId: string): VideoFlowNode[] {
  return nodes.filter((node) => {
    const data = nodeData(node);
    const reused = data.reusedRenderedClip;
    const reusedRecord = reused && typeof reused === "object" && !Array.isArray(reused)
      ? reused as Record<string, unknown>
      : null;
    return (
      readTrimmed(data.kind).toLowerCase() === "video" &&
      (
        readTrimmed(data.clipRunId) === sourceRunId ||
        readTrimmed(reusedRecord?.sourceRunId) === sourceRunId
      )
    );
  });
}

function isRunningStatus(status: string): boolean {
  return status === "running" || status === "queued" || status === "submitted";
}

export function validateReplanPreservation(input: {
  sourceNodes: VideoFlowNode[];
  preservedClips: unknown;
  targetBeatCount: number;
}): ReplanPreservationValidation {
  const preservedClips = parsePreservedClipMappings(input.preservedClips);
  if (!preservedClips) {
    return {
      ok: false,
      code: "replan_contract_invalid",
      message: "preservedClips 必须是完整的成功片段映射数组。",
    };
  }
  const runningNodes = input.sourceNodes.filter((node) =>
    isRunningStatus(readTrimmed(nodeData(node).status).toLowerCase()),
  );
  if (runningNodes.length > 0) {
    return {
      ok: false,
      code: "replan_source_tasks_still_running",
      nodeIds: runningNodes.map((node) => node.id),
      message: "源 run 仍有在途视频任务；必须先收到真实终态，禁止猜测或重排。",
    };
  }

  const successfulNodes = input.sourceNodes.filter((node) => {
    const data = nodeData(node);
    return (
      readTrimmed(data.status).toLowerCase() === "success" &&
      /^https?:\/\//i.test(readTrimmed(data.videoUrl))
    );
  });
  const successBySourceIndex = new Map<number, VideoFlowNode>();
  for (const node of successfulNodes) {
    const sourceClipIndex = readIndex(nodeData(node).clipIndex);
    if (sourceClipIndex == null) {
      return {
        ok: false,
        code: "replan_source_success_evidence_invalid",
        nodeId: node.id,
        message: "源 run 的成功视频节点缺少合法 clipIndex；无法安全解析复用血缘。",
      };
    }
    if (successBySourceIndex.has(sourceClipIndex)) {
      return {
        ok: false,
        code: "replan_source_success_evidence_ambiguous",
        nodeId: node.id,
        message: `源 run 的 clipIndex=${sourceClipIndex} 对应多个成功视频节点；无法唯一解析复用血缘。`,
      };
    }
    successBySourceIndex.set(sourceClipIndex, node);
  }
  const mappedSourceIndexes = new Set<number>();
  const mappedTargetIndexes = new Set<number>();
  const resolvedMappings: PreservedClipMapping[] = [];
  for (const mapping of preservedClips) {
    const node = successBySourceIndex.get(mapping.sourceClipIndex);
    if (
      mappedSourceIndexes.has(mapping.sourceClipIndex) ||
      mappedTargetIndexes.has(mapping.targetClipIndex)
    ) {
      return {
        ok: false,
        code: "replan_preserved_mapping_duplicate",
        message: "preservedClips 的 sourceClipIndex、targetClipIndex 必须分别唯一。",
      };
    }
    const data = node ? nodeData(node) : null;
    if (
      !node ||
      !readTrimmed(data?.taskId) ||
      !/^https?:\/\//i.test(readTrimmed(data?.videoUrl)) ||
      mapping.targetClipIndex >= input.targetBeatCount
    ) {
      return {
        ok: false,
        code: "replan_preserved_clip_evidence_invalid",
        ...(node ? { nodeId: node.id } : {}),
        message:
          "复用片段必须命中源 run 中由 sourceClipIndex 唯一解析的 success 节点、真实 taskId/videoUrl 与新 BeatSheet 的有效目标镜号。",
      };
    }
    mappedSourceIndexes.add(mapping.sourceClipIndex);
    mappedTargetIndexes.add(mapping.targetClipIndex);
    resolvedMappings.push({ ...mapping, nodeId: node.id });
  }
  return { ok: true, mappings: resolvedMappings };
}

function readyArtifactForClip(
  artifacts: AuthoringArtifactRow[],
  clipIndex: number,
): AuthoringArtifactRow | null {
  return artifacts.find((artifact) =>
    artifact.artifact_key === clipArtifactKey(clipIndex) &&
    artifact.status === "ready" &&
    readTrimmed(artifact.content_hash) &&
    readTrimmed(artifact.payload)
  ) ?? null;
}

async function resolveReadyClipArtifactSeeds(input: {
  sourceRunId: string;
  sourceNodes: VideoFlowNode[];
  mappings: PreservedClipMapping[];
}): Promise<ReadyClipArtifactSeed[]> {
  const nodeById = new Map(input.sourceNodes.map((node) => [node.id, node] as const));
  const artifactsByRunId = new Map<string, Promise<AuthoringArtifactRow[]>>();
  const loadArtifacts = (runId: string): Promise<AuthoringArtifactRow[]> => {
    const existing = artifactsByRunId.get(runId);
    if (existing) return existing;
    const pending = listAuthoringArtifacts(runId);
    artifactsByRunId.set(runId, pending);
    return pending;
  };
  const seeds: ReadyClipArtifactSeed[] = [];
  for (const mapping of input.mappings) {
    const node = nodeById.get(mapping.nodeId);
    if (!node) continue;
    const refs = buildPreservedArtifactSourceRefs({
      sourceRunId: input.sourceRunId,
      sourceClipIndex: mapping.sourceClipIndex,
      node,
    });
    for (const ref of refs) {
      const artifact = readyArtifactForClip(await loadArtifacts(ref.runId), ref.clipIndex);
      if (!artifact?.payload) continue;
      seeds.push({
        targetClipIndex: mapping.targetClipIndex,
        sourceRunId: ref.runId,
        sourceClipIndex: ref.clipIndex,
        contentHash: artifact.content_hash,
        payload: artifact.payload,
      });
      break;
    }
  }
  return seeds;
}

export async function orchestrateVideoReplanBeats(input: {
  bodyArgs: unknown;
  parentAgentExecution?: ParentAgentExecution;
  requestUserId: string;
  flowId: string;
  chapterId?: string;
  projectId?: string | null;
  chapterText?: string;
  generationContract: VideoGenerationContract;
  c: AppContext;
  devBypass: boolean;
}): Promise<Record<string, unknown>> {
  const args =
    input.bodyArgs && typeof input.bodyArgs === "object" && !Array.isArray(input.bodyArgs)
      ? (input.bodyArgs as Record<string, unknown>)
      : {};
  const sourceRunId = readTrimmed(args.sourceRunId);
  const targetRunId = readTrimmed(args.runId);
  const cloneSourceBeatSheet = args.cloneSourceBeatSheet === true;
  const preservedClips = parsePreservedClipMappings(args.preservedClips);
  const beatReplacementsProvided = Array.isArray(args.beatReplacements);
  const parallelContractFields = [
    args.beatSheet,
    args.beatSheetRef,
    args.preflightRevision,
    args.preflightFingerprint,
  ];

  if (
    !sourceRunId ||
    !targetRunId ||
    !preservedClips ||
    !cloneSourceBeatSheet ||
    !beatReplacementsProvided ||
    parallelContractFields.some((value) => value !== undefined)
  ) {
    return {
      ok: false,
      terminal: true,
      mode: "replan_beats",
      code: "replan_contract_invalid",
      message:
        "replan_beats 只接受 sourceRunId、全新 runId、cloneSourceBeatSheet:true、显式 beatReplacements 与 preservedClips；禁止并行携带 beatSheet、beatSheetRef 或 preflight 字段。",
    };
  }
  if (sourceRunId === targetRunId) {
    return {
      ok: false,
      terminal: true,
      mode: "replan_beats",
      code: "replan_target_run_must_be_new",
      message:
        "部分生产后的重规划必须使用新的 runId；旧 run 保留真实任务、账本和失败证据，禁止覆盖复活。",
    };
  }

  const sourceRun = await getVideoRun(sourceRunId);
  if (!sourceRun || sourceRun.owner_id !== input.requestUserId) {
    return {
      ok: false,
      terminal: true,
      mode: "replan_beats",
      code: "replan_source_run_not_found",
      message: "未找到当前用户可无损重规划的源 run。",
    };
  }
  if (!isReplanSourceTerminalFailure({
    state: sourceRun.state,
    authoringState: sourceRun.authoring_state,
    totalClips: sourceRun.total_clips,
    clipsDone: sourceRun.clips_done,
  })) {
    return {
      ok: false,
      terminal: true,
      mode: "replan_beats",
      code: "replan_source_run_not_terminal_failed",
      message:
        `源 run 生产态为 ${sourceRun.state}、authoringState=${sourceRun.authoring_state ?? "null"}；` +
        "只有生产失败、尚未起跑的 collecting + authoring_failed，或已完成 authoring 但 0 段生产的 cancelled run，才允许无损重规划。",
    };
  }
  if (
    (input.chapterId && sourceRun.chapter_id !== input.chapterId) ||
    (input.projectId && sourceRun.project_id && sourceRun.project_id !== input.projectId)
  ) {
    return {
      ok: false,
      terminal: true,
      mode: "replan_beats",
      code: "replan_source_scope_mismatch",
      message: "源 run 与当前项目/章节作用域不一致。",
    };
  }

  let beatSheet = clonePersistedBeatSheet(sourceRun.beat_sheet);
  if (!beatSheet) {
    return {
      ok: false,
      terminal: true,
      mode: "replan_beats",
      code: "replan_source_beat_sheet_missing_or_invalid",
      message:
        "cloneSourceBeatSheet 已显式启用，但源 run 没有可解析的完整 BeatSheet；禁止让代理凭记忆重建。",
    };
  }
  const transformed = transformClonedReplanBeatSheet({
    sourceBeatSheet: beatSheet,
    chapterText: input.chapterText ?? "",
    preservedMappings: preservedClips,
    beatReplacements: args.beatReplacements,
  });
  if (!transformed.ok) {
    return {
      ok: false,
      terminal: false,
      mode: "replan_beats",
      code: transformed.code,
      sourceRunId,
      runId: targetRunId,
      message: transformed.message,
    };
  }
  beatSheet = stampVideoReplanLineage({
    beatSheet: transformed.beatSheet,
    sourceRunId,
  });

  const row = await freshReadFlowRow({
    c: input.c,
    flowId: input.flowId,
    requestUserId: input.requestUserId,
    devBypass: input.devBypass,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
  });
  const sourceNodes = sourceRunVideoNodes(readFlowNodes(row), sourceRunId);
  const referenceRepair = rebindReplanBeatSheetReferences({
    beatSheet,
    currentNodes: readFlowNodes(row),
  });
  if (referenceRepair.evidence.unresolved.length > 0) {
    return {
      ok: false,
      terminal: true,
      mode: "replan_beats",
      code: "replan_reference_rebinding_unresolved",
      sourceRunId,
      runId: targetRunId,
      referenceRepairEvidence: referenceRepair.evidence,
      message:
        "源 BeatSheet 的画布引用已失效，当前画布没有唯一可证明的同身份真实图片；未提交新 run，避免把资产错误拖到付费阶段。",
    };
  }
  const targetBeatCount = Array.isArray(beatSheet.beats) ? beatSheet.beats.length : 0;
  const preservation = validateReplanPreservation({
    sourceNodes,
    preservedClips,
    targetBeatCount,
  });
  if (!preservation.ok) {
    return {
      ok: false,
      terminal: true,
      mode: "replan_beats",
      code: preservation.code,
      ...(preservation.nodeIds ? { nodeIds: preservation.nodeIds } : {}),
      ...(preservation.nodeId ? { nodeId: preservation.nodeId } : {}),
      message: preservation.message,
    };
  }

  const readyClipArtifactSeeds = await resolveReadyClipArtifactSeeds({
    sourceRunId,
    sourceNodes,
    mappings: preservation.mappings,
  });

  beatSheet.runId = targetRunId;
  const committed = await orchestrateVideoCommitBeats({
    bodyArgs: { mode: "commit_beats", runId: targetRunId, beatSheet },
    generationContract: input.generationContract,
    c: input.c,
    devBypass: input.devBypass,
    parentAgentExecution: input.parentAgentExecution,
    requestUserId: input.requestUserId,
    flowId: input.flowId,
    ...(input.chapterId ? { chapterId: input.chapterId } : {}),
    projectId: input.projectId ?? null,
    readyClipArtifactSeeds,
    ...(input.chapterText ? { chapterText: input.chapterText } : {}),
  });
  if (committed.ok !== true) {
    return {
      ...committed,
      mode: "replan_beats",
      sourceRunId,
      runId: targetRunId,
      referenceRepairEvidence: referenceRepair.evidence,
    };
  }

  const preservedReadyClipIndexes = readPreservedReadyClipIndexes(committed);
  const acceptedMappings = selectAcceptedPreservedMappings(
    preservation.mappings,
    preservedReadyClipIndexes,
  );

  const replannedAt = new Date().toISOString();
  try {
    if (acceptedMappings.length > 0) {
      await persistFlowPatch({
        c: input.c,
        row,
        flowId: input.flowId,
        requestUserId: input.requestUserId,
        devBypass: input.devBypass,
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        affectedNodeIds: acceptedMappings.map((mapping) => mapping.nodeId),
        patch: {
          allowOverwrite: true,
          patchNodeData: acceptedMappings.map((mapping) => ({
            id: mapping.nodeId,
            data: {
              clipRunId: targetRunId,
              clipIndex: mapping.targetClipIndex,
              sequenceIndex: mapping.targetClipIndex,
              reusedRenderedClip: {
                sourceRunId,
                sourceClipIndex: mapping.sourceClipIndex,
                replannedAt,
              },
            },
          })),
        } as never,
      });
    }
  } catch (error) {
    await advanceAuthoringState({
      runId: targetRunId,
      from: "beats_committed",
      to: "authoring_failed",
      nowIso: new Date().toISOString(),
      errorMessage: `replan_preserved_clip_patch_failed:${String((error as Error).message || error)}`,
    });
    return {
      ok: false,
      terminal: true,
      mode: "replan_beats",
      code: "replan_preserved_clip_patch_failed",
      sourceRunId,
      runId: targetRunId,
      message:
        "新 BeatSheet 已冻结但成功片段映射写回失败；目标 run 已停在 authoring_failed，未启动任何新视频任务。",
    };
  }

  return {
    ...committed,
    mode: "replan_beats",
    sourceRunId,
    runId: targetRunId,
    referenceRepairEvidence: referenceRepair.evidence,
    requestedPreservedRenderedClips: preservation.mappings.length,
    preservedRenderedClips: acceptedMappings.length,
    preservedReadyWriterArtifacts: preservedReadyClipIndexes.length,
    regeneratedRenderedClips: targetBeatCount - acceptedMappings.length,
    message:
      `失败 run 已无损重规划为 ${targetRunId}：逐 clip 冻结输入指纹验真后复用 ${acceptedMappings.length} 个真实成功视频，` +
      "其余新拆片段继续走完整 commit_beats authoring 与异步视频状态机。",
  };
}
