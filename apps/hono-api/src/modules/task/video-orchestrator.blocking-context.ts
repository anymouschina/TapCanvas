import type {
  Beat,
  BeatBlockingContext,
  BeatBlockingLockedAnchors,
} from "./video-orchestrator.beat-sheet";
import type { VideoFlowNode } from "./video-orchestrator.flow-io";
import {
  doesCompositionImageUrlCarryHash,
  parseKeyframeCompositionContract,
} from "./keyframe-composition-contract";
import { isStoryPreviewAssetData } from "./story-preview-asset";

const MAX_BLOCKING_SCENE_NAME_CHARS = 200;
const MAX_BLOCKING_ANCHOR_ITEMS = 24;
const MAX_BLOCKING_ANCHOR_ITEM_CHARS = 300;

export type BeatBlockingContextIssue = {
  clipIndex: number;
  nodeId: string;
  code:
    | "blocking_node_missing"
    | "blocking_node_required"
    | "blocking_node_type_invalid"
    | "blocking_image_url_missing"
    | "blocking_context_invalid"
    | "blocking_context_empty"
    | "blocking_composition_contract_invalid"
    | "blocking_composition_hash_mismatch"
    | "blocking_composition_provenance_missing";
  message: string;
};

export type BeatBlockingContextMaterialization =
  | { ok: true; beats: Beat[] }
  | { ok: false; issues: BeatBlockingContextIssue[] };

export type BeatKeyframeReferenceIssue = {
  clipIndex: number;
  nodeId: string;
  field:
    | "storyboardImageNodeId"
    | "lastFrameImageNodeId"
    | "assetObjectContracts.referenceImageNodeIds";
  code:
    | "keyframe_node_missing"
    | "keyframe_node_type_invalid"
    | "keyframe_image_url_missing"
    | "keyframe_blocking_binding_missing"
    | "keyframe_blocking_binding_mismatch"
    | "keyframe_blocking_reference_missing"
    | "keyframe_composition_contract_invalid"
    | "keyframe_composition_contract_mismatch";
  message: string;
  diagnostics?: {
    nodeKind: string;
    productionLayer: string;
    declaredFrameCount: number;
  };
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function readUniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => readTrimmedString(item)).filter(Boolean))];
}

function beatRequiresBlocking(beat: Beat): boolean {
  return beat.spatialBlocking === true;
}

function readBoundedStringArray(input: {
  value: unknown;
  path: string;
  issues: string[];
}): string[] {
  if (input.value === undefined) return [];
  if (!Array.isArray(input.value)) {
    input.issues.push(`${input.path} 必须是字符串数组`);
    return [];
  }
  if (input.value.length > MAX_BLOCKING_ANCHOR_ITEMS) {
    input.issues.push(`${input.path} 最多 ${MAX_BLOCKING_ANCHOR_ITEMS} 项（收到 ${input.value.length}）`);
  }
  const values: string[] = [];
  input.value.forEach((value, index) => {
    const text = readTrimmedString(value);
    if (!text) {
      input.issues.push(`${input.path}[${index}] 必须是非空字符串`);
      return;
    }
    if (text.length > MAX_BLOCKING_ANCHOR_ITEM_CHARS) {
      input.issues.push(
        `${input.path}[${index}] 最多 ${MAX_BLOCKING_ANCHOR_ITEM_CHARS} 字（收到 ${text.length}）`,
      );
      return;
    }
    values.push(text);
  });
  return values;
}

function readLockedAnchors(
  data: Record<string, unknown>,
  issues: string[],
): BeatBlockingLockedAnchors {
  const productionMetadata = readRecord(data.productionMetadata);
  const lockedAnchors = readRecord(productionMetadata?.lockedAnchors);
  if (productionMetadata?.lockedAnchors !== undefined && !lockedAnchors) {
    issues.push("productionMetadata.lockedAnchors 必须是对象");
  }
  return {
    character: readBoundedStringArray({
      value: lockedAnchors?.character,
      path: "productionMetadata.lockedAnchors.character",
      issues,
    }),
    scene: readBoundedStringArray({
      value: lockedAnchors?.scene,
      path: "productionMetadata.lockedAnchors.scene",
      issues,
    }),
    shot: readBoundedStringArray({
      value: lockedAnchors?.shot,
      path: "productionMetadata.lockedAnchors.shot",
      issues,
    }),
    continuity: readBoundedStringArray({
      value: lockedAnchors?.continuity,
      path: "productionMetadata.lockedAnchors.continuity",
      issues,
    }),
  };
}

function hasBlockingFacts(context: BeatBlockingContext): boolean {
  return Boolean(
    context.prompt ||
      context.sceneName ||
      context.lockedAnchors.character.length ||
      context.lockedAnchors.scene.length ||
      context.lockedAnchors.shot.length ||
      context.lockedAnchors.continuity.length,
  );
}

function materializeNodeContext(input: {
  beat: Beat;
  node: VideoFlowNode;
}): { context?: BeatBlockingContext; issues: BeatBlockingContextIssue[] } {
  const { beat, node } = input;
  const nodeId = beat.blockingFrameNodeId ?? "";
  const data = readRecord(node.data) ?? {};
  const issue = (
    code: BeatBlockingContextIssue["code"],
    message: string,
  ): BeatBlockingContextIssue => ({ clipIndex: beat.clipIndex, nodeId, code, message });
  const referenceType = readTrimmedString(data.referenceType).toLowerCase();
  const productionLayer = readTrimmedString(data.productionLayer).toLowerCase();
  if (referenceType !== "blocking" && productionLayer !== "blocking_diagram") {
    return {
      issues: [
        issue(
          "blocking_node_type_invalid",
          `beats[${beat.clipIndex}].blockingFrameNodeId=${nodeId} 必须指向 referenceType=blocking 或 productionLayer=blocking_diagram 的节点`,
        ),
      ],
    };
  }
  const sourceImageUrl = readTrimmedString(data.imageUrl);
  if (!isHttpUrl(sourceImageUrl)) {
    return {
      issues: [
        issue(
          "blocking_image_url_missing",
          `beats[${beat.clipIndex}].blockingFrameNodeId=${nodeId} 没有真实 http(s) imageUrl`,
        ),
      ],
    };
  }

  const productionMetadata = readRecord(data.productionMetadata);
  const parsedComposition = parseKeyframeCompositionContract(
    productionMetadata?.compositionContract,
  );
  if (!parsedComposition.ok) {
    return {
      issues: [
        issue(
          "blocking_composition_contract_invalid",
          `beats[${beat.clipIndex}] 站位节点 ${nodeId} 缺少有效 compositionContract：${parsedComposition.issues.join("；")}`,
        ),
      ],
    };
  }
  const compositionContractHash = readTrimmedString(
    productionMetadata?.compositionContractHash,
  );
  if (compositionContractHash !== parsedComposition.hash) {
    return {
      issues: [
        issue(
          "blocking_composition_hash_mismatch",
          `beats[${beat.clipIndex}] 站位节点 ${nodeId} 的 compositionContractHash 与合同正文不一致`,
        ),
      ],
    };
  }
  if (!doesCompositionImageUrlCarryHash(sourceImageUrl, compositionContractHash)) {
    return {
      issues: [
        issue(
          "blocking_composition_provenance_missing",
          `beats[${beat.clipIndex}] 站位节点 ${nodeId} 的真实 imageUrl 未携带 compositionContractHash，无法证明图片由该合同渲染`,
        ),
      ],
    };
  }

  const contextIssues: string[] = [];
  const prompt = readTrimmedString(data.prompt);
  const sceneName = readTrimmedString(data.sceneName);
  if (sceneName.length > MAX_BLOCKING_SCENE_NAME_CHARS) {
    contextIssues.push(
      `sceneName 最多 ${MAX_BLOCKING_SCENE_NAME_CHARS} 字（收到 ${sceneName.length}）`,
    );
  }
  const lockedAnchors = readLockedAnchors(data, contextIssues);
  if (contextIssues.length) {
    return {
      issues: [
        issue(
          "blocking_context_invalid",
          `beats[${beat.clipIndex}] 站位上下文结构无效：${contextIssues.join("；")}`,
        ),
      ],
    };
  }
  const context: BeatBlockingContext = {
    sourceNodeId: nodeId,
    sourceImageUrl,
    lockedAnchors,
    compositionContract: parsedComposition.contract,
    compositionContractHash,
    ...(prompt ? { prompt } : {}),
    ...(sceneName ? { sceneName } : {}),
  };
  if (!hasBlockingFacts(context)) {
    return {
      issues: [
        issue(
          "blocking_context_empty",
          `beats[${beat.clipIndex}] 站位节点 ${nodeId} 没有 prompt、sceneName 或 lockedAnchors，无法影响单 clip writer`,
        ),
      ],
    };
  }
  return { context, issues: [] };
}

/**
 * 把主代理显式选择的站位节点物化为单 beat 的结构化上下文。
 * 只按 node id 与声明字段做结构校验，不在后端猜测哪个站位图属于哪个剧情。
 */
export function materializeBeatBlockingContexts(input: {
  beats: Beat[];
  nodes: VideoFlowNode[];
}): BeatBlockingContextMaterialization {
  const nodesById = new Map(input.nodes.map((node) => [readTrimmedString(node.id), node]));
  const issues: BeatBlockingContextIssue[] = [];
  const beats = input.beats.map((beat) => {
    const nodeId = readTrimmedString(beat.blockingFrameNodeId);
    if (!nodeId) {
      if (beatRequiresBlocking(beat)) {
        issues.push({
          clipIndex: beat.clipIndex,
          nodeId: "",
          code: "blocking_node_required",
          message: `beats[${beat.clipIndex}].blockingFrameNodeId 必填；spatialBlocking=true 的镜头必须绑定真实站位图`,
        });
      }
      const { blockingContext: _ignored, ...rest } = beat;
      return rest;
    }
    const node = nodesById.get(nodeId);
    if (!node) {
      issues.push({
        clipIndex: beat.clipIndex,
        nodeId,
        code: "blocking_node_missing",
        message: `beats[${beat.clipIndex}].blockingFrameNodeId=${nodeId} 不存在于当前授权画布`,
      });
      return beat;
    }
    const materialized = materializeNodeContext({ beat, node });
    issues.push(...materialized.issues);
    return materialized.context
      ? { ...beat, blockingFrameNodeId: nodeId, blockingContext: materialized.context }
      : beat;
  });
  return issues.length ? { ok: false, issues } : { ok: true, beats };
}

/** 验真 Beat 显式选择的可选关键帧图片及其他图片资产。 */
export function validateBeatKeyframeReferences(input: {
  beats: Beat[];
  nodes: VideoFlowNode[];
  generationReferenceUrlsByTaskId?: ReadonlyMap<string, readonly string[]>;
}): BeatKeyframeReferenceIssue[] {
  const nodesById = new Map(input.nodes.map((node) => [readTrimmedString(node.id), node]));
  const issues: BeatKeyframeReferenceIssue[] = [];
  input.beats.forEach((beat) => {
    const references: Array<{
      field: BeatKeyframeReferenceIssue["field"];
      nodeId: string;
      requiresBlockingEvidence: boolean;
    }> = [
      {
        field: "storyboardImageNodeId",
        nodeId: readTrimmedString(beat.storyboardImageNodeId),
        requiresBlockingEvidence: true,
      },
      {
        field: "lastFrameImageNodeId",
        nodeId: readTrimmedString(beat.lastFrameImageNodeId),
        requiresBlockingEvidence: false,
      },
      ...beat.assetObjectContracts.flatMap((contract) =>
        contract.referenceImageNodeIds.map((nodeId) => ({
          field: "assetObjectContracts.referenceImageNodeIds" as const,
          nodeId: readTrimmedString(nodeId),
          requiresBlockingEvidence: false,
        })),
      ),
    ];
    references.forEach(({ field, nodeId, requiresBlockingEvidence }) => {
      if (!nodeId) return;
      const node = nodesById.get(nodeId);
      if (!node) {
        issues.push({
          clipIndex: beat.clipIndex,
          nodeId,
          field,
          code: "keyframe_node_missing",
          message: `beats[${beat.clipIndex}].${field}=${nodeId} 不存在于当前授权画布`,
        });
        return;
      }
      const data = readRecord(node.data) ?? {};
      const kind = readTrimmedString(data.kind).toLowerCase();
      const productionLayer = readTrimmedString(data.productionLayer).toLowerCase();
      const isClipStoryboard = field === "storyboardImageNodeId";
      const declaredFrameCount = isClipStoryboard ? (beat.storyboardFrameCount ?? 1) : 1;
      const diagnostics = {
        nodeKind: kind,
        declaredFrameCount,
        productionLayer,
      };
      const isImageKind =
        kind === "image" || kind === "imageedit" || kind === "storyboardimage";
      if (isStoryPreviewAssetData(data)) {
        issues.push({
          clipIndex: beat.clipIndex,
          nodeId,
          field,
          code: "keyframe_node_type_invalid",
          message: `beats[${beat.clipIndex}].${field}=${nodeId} 是 story_preview，仅供剧情预览，禁止进入视频生产`,
          diagnostics,
        });
        return;
      }
      if (
        !isImageKind ||
        (isClipStoryboard &&
          (!Number.isInteger(declaredFrameCount) ||
            declaredFrameCount < 1 ||
            declaredFrameCount > 3))
      ) {
        issues.push({
          clipIndex: beat.clipIndex,
          nodeId,
          field,
          code: "keyframe_node_type_invalid",
          message:
            `beats[${beat.clipIndex}].${field}=${nodeId} 必须指向真实图片；` +
            `故事板声明格数必须位于供应商允许的 1~3。结构事实=${JSON.stringify(diagnostics)}`,
          diagnostics,
        });
        return;
      }
      if (!isHttpUrl(readTrimmedString(data.imageUrl))) {
        issues.push({
          clipIndex: beat.clipIndex,
          nodeId,
          field,
          code: "keyframe_image_url_missing",
          message: `beats[${beat.clipIndex}].${field}=${nodeId} 没有真实 http(s) imageUrl`,
        });
        return;
      }

      if (!requiresBlockingEvidence) return;

      const declaredBlockingNodeId = readTrimmedString(beat.blockingFrameNodeId);
      if (!declaredBlockingNodeId) return;
      const productionMetadata = readRecord(data.productionMetadata);
      const keyframeBlockingNodeId = readTrimmedString(
        productionMetadata?.blockingFrameNodeId,
      );
      if (!keyframeBlockingNodeId) {
        issues.push({
          clipIndex: beat.clipIndex,
          nodeId,
          field,
          code: "keyframe_blocking_binding_missing",
          message: `beats[${beat.clipIndex}].${field}=${nodeId} 未记录 productionMetadata.blockingFrameNodeId，无法证明关键帧使用了站位图`,
        });
        return;
      }
      if (keyframeBlockingNodeId !== declaredBlockingNodeId) {
        issues.push({
          clipIndex: beat.clipIndex,
          nodeId,
          field,
          code: "keyframe_blocking_binding_mismatch",
          message: `beats[${beat.clipIndex}] 的站位图 ${declaredBlockingNodeId} 与关键帧实际绑定 ${keyframeBlockingNodeId} 不一致`,
        });
        return;
      }
      const blockingNode = nodesById.get(declaredBlockingNodeId);
      const blockingData = readRecord(blockingNode?.data) ?? {};
      const blockingImageUrl = readTrimmedString(blockingData.imageUrl);
      const referenceImages = readUniqueStrings(data.referenceImages);
      const assetInputUrls = Array.isArray(data.assetInputs)
        ? data.assetInputs
            .map((item) => readTrimmedString(readRecord(item)?.url))
            .filter(Boolean)
        : [];
      const taskId = readTrimmedString(data.taskId) || readTrimmedString(data.imageTaskId);
      const submittedReferenceUrls = taskId
        ? input.generationReferenceUrlsByTaskId?.get(taskId) ?? []
        : [];
      if (
        !blockingImageUrl ||
        (!referenceImages.includes(blockingImageUrl) &&
          !assetInputUrls.includes(blockingImageUrl) &&
          !submittedReferenceUrls.includes(blockingImageUrl))
      ) {
        issues.push({
          clipIndex: beat.clipIndex,
          nodeId,
          field,
          code: "keyframe_blocking_reference_missing",
          message: `beats[${beat.clipIndex}].${field}=${nodeId} 未把站位图 ${declaredBlockingNodeId} 的真实 imageUrl 作为生成参考，禁止进入视频生产`,
        });
        return;
      }

      const parsedBlockingContract = parseKeyframeCompositionContract(
        readRecord(blockingData.productionMetadata)?.compositionContract,
      );
      const blockingContractHash = readTrimmedString(
        readRecord(blockingData.productionMetadata)?.compositionContractHash,
      );
      if (
        !parsedBlockingContract.ok ||
        parsedBlockingContract.hash !== blockingContractHash ||
        !doesCompositionImageUrlCarryHash(blockingImageUrl, blockingContractHash)
      ) {
        issues.push({
          clipIndex: beat.clipIndex,
          nodeId,
          field,
          code: "keyframe_composition_contract_invalid",
          message: `beats[${beat.clipIndex}] 的站位图 ${declaredBlockingNodeId} 缺少可追溯的有效构图合同`,
        });
        return;
      }
      const parsedKeyframeContract = parseKeyframeCompositionContract(
        productionMetadata?.compositionContract,
      );
      const keyframeContractHash = readTrimmedString(
        productionMetadata?.compositionContractHash,
      );
      if (
        !parsedKeyframeContract.ok ||
        parsedKeyframeContract.hash !== keyframeContractHash ||
        keyframeContractHash !== blockingContractHash
      ) {
        issues.push({
          clipIndex: beat.clipIndex,
          nodeId,
          field,
          code: "keyframe_composition_contract_mismatch",
          message: `beats[${beat.clipIndex}] 的关键帧 ${nodeId} 与站位图 ${declaredBlockingNodeId} 没有消费同一构图合同`,
        });
      }
    });
  });
  return issues;
}
