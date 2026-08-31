/**
 * 视频成片编排 · 预建 clip 占位节点（事件驱动续跑重构 · Change A1）。
 *
 * 设计：plan 时一次性把每个 clip 的「计划」落成画布上的 video 占位节点（status=planned），
 * 让 StoryPlan 成为画布事实 —— 后续推进（reconcile→续写→concat）可纯从节点读 prompt/绑定，
 * 不再依赖 agent 每次重传 StoryPlan，也无需独立表/worker。详见
 * docs/video/orchestrator-event-driven-refactor.md。
 *
 * 本文件是**纯函数**：只产出 add_node specs，不碰画布/DB/计费。
 */

import type { StoryPlanClip } from "./video-orchestrator.orchestrate";
import { parseAssetObjectContracts } from "./video-orchestrator.asset-object-contract";
import { readClipContinuityMode } from "./video-orchestrator.continuity-contract";
import type { VideoGenerationContract } from "./video-orchestrator.generation-contract";
import { parseVideoGenerationContract } from "./video-orchestrator.generation-contract";

export type ClipPlaceholderPlanInput = {
	runId: string;
	videoModel: string;
	generationContract: VideoGenerationContract;
	aspect?: string;
	recipeId?: string;
	parentGroupId?: string;
	clips: StoryPlanClip[];
};

export type ClipPlaceholderClipPlanItem = {
	clipIndex: number;
	durationSeconds: number;
	nodeId: string;
	clipId: string;
	expectedPrevClipIndex?: number | null;
};

export type ClipPlaceholderNodeSpec = {
	id: string;
	type: "taskNode";
	position: { x: number; y: number };
	parentId?: string;
	data: Record<string, unknown>;
};

export class StoryPlanRebuildContractError extends Error {
	constructor(
		readonly code:
			| "video_run_legacy_reference_contract"
			| "video_run_reference_contract_missing"
			| "video_run_continuity_contract_missing"
			| "video_run_asset_object_contract_invalid"
			| "video_run_clip_topology_gap",
		message: string,
	) {
		super(message);
		this.name = "StoryPlanRebuildContractError";
	}
}

function trimmed(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function nonEmptyStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of value) {
		const v = trimmed(item);
		if (!v || seen.has(v)) continue;
		seen.add(v);
		out.push(v);
	}
	return out;
}

/**
 * 为 clipPlan 的每一段产出一个 video 占位节点 spec（status=planned，带 prompt/绑定/续写依赖）。
 *
 * - 节点 id 用 clipPlan 的稳定 slot id（同 runId+clipIndex 永远同 id）→ 幂等：调用方按 id
 *   去重，已存在则不重复创建。
 * - 创意 prompt/绑定从 plan.clips[clipIndex] 取（clipPlan 可能比 plan.clips 长 —— 时长拆段多于
 *   创意段时高位 clip 无对应创意，prompt 留空由调用方/后续填，绝不抛错）。
 * - 横向按 clipIndex 错位排布，避免全叠在 (0,0)。
 */
export function buildClipPlaceholderNodes(input: {
	plan: ClipPlaceholderPlanInput;
	clipPlan: ClipPlaceholderClipPlanItem[];
}): ClipPlaceholderNodeSpec[] {
	const { plan, clipPlan } = input;
	const runId = trimmed(plan.runId);
	if (!runId || !Array.isArray(clipPlan) || clipPlan.length === 0) return [];
	const parentGroupId = trimmed(plan.parentGroupId);
	const videoModel = trimmed(plan.videoModel);
	const generationContract = parseVideoGenerationContract(plan.generationContract);
	const aspect = trimmed(plan.aspect);
	const recipeId = trimmed(plan.recipeId);
	if (!generationContract) {
		throw new Error("video_placeholder_generation_contract_invalid");
	}
	if (clipPlan.length !== plan.clips.length) {
		throw new Error(
			`video_placeholder_topology_mismatch:clips=${plan.clips.length}:slots=${clipPlan.length}`,
		);
	}

	const specs: ClipPlaceholderNodeSpec[] = [];
	for (const [expectedClipIndex, item] of clipPlan.entries()) {
		if (item.clipIndex !== expectedClipIndex) {
			throw new Error(
				`video_placeholder_clip_index_invalid:position=${expectedClipIndex}:clip=${item.clipIndex}`,
			);
		}
		const nodeId = trimmed(item.nodeId);
		if (!nodeId) continue;
		const clip: StoryPlanClip | undefined = plan.clips[item.clipIndex];
		if (!clip || !Array.isArray(clip.videoReferenceNodeIds)) {
			throw new Error(`video_placeholder_reference_contract_missing:clip=${item.clipIndex}`);
		}
		if (!Array.isArray(clip.assetObjectContracts)) {
			throw new Error(`video_placeholder_asset_object_contract_missing:clip=${item.clipIndex}`);
		}
		const clipPrompt = trimmed(clip?.clipPrompt);
		const storyboardPrompt = trimmed(clip?.storyboardPrompt);
		const characterRoleNames = nonEmptyStringArray(clip?.characterRoleNames);
		const videoReferenceNodeIds = nonEmptyStringArray(clip?.videoReferenceNodeIds);
		const storyboardImageNodeId = trimmed(clip?.storyboardImageNodeId);
		const lastFrameImageNodeId = trimmed(clip?.lastFrameImageNodeId);
		const continuityMode = readClipContinuityMode(clip.continuityMode);
		if (!continuityMode) {
			throw new Error(`video_placeholder_continuity_contract_missing:clip=${item.clipIndex}`);
		}
		const propNames = nonEmptyStringArray(clip.propNames);
		const vfxNames = nonEmptyStringArray(clip.vfxNames);
		const sceneName = trimmed(clip.sceneName);
		const timeJumpNote = trimmed(clip.timeJumpNote);
		const exitState = trimmed(clip.exitState);

		specs.push({
			id: nodeId,
			type: "taskNode",
			position: { x: item.clipIndex * 360, y: 0 },
			...(parentGroupId ? { parentId: parentGroupId } : {}),
			data: {
				kind: "video",
				// planned：计划已落画布但还没提交渲染。reconcile/前端据此识别"待生成"，不判失败。
				status: "planned",
				clipRunId: runId,
				clipIndex: item.clipIndex,
				clipId: trimmed(item.clipId),
				durationSeconds: item.durationSeconds,
				...(videoModel ? { videoModel } : {}),
				generationContract,
				...(aspect ? { videoAspect: aspect, aspectRatio: aspect } : {}),
				...(recipeId ? { sourceRecipeId: recipeId } : {}),
				...(clipPrompt ? { prompt: clipPrompt } : {}),
				...(storyboardPrompt ? { storyboardPrompt } : {}),
				...(characterRoleNames.length ? { characterRoleNames } : {}),
				...(propNames.length ? { propNames } : {}),
				...(vfxNames.length ? { vfxNames } : {}),
				...(sceneName ? { sceneName } : {}),
				...(clip.characterStates ? { characterStates: { ...clip.characterStates } } : {}),
				...(timeJumpNote ? { timeJumpNote } : {}),
				...(exitState ? { exitState } : {}),
				videoReferenceNodeIds,
				assetObjectContracts: clip.assetObjectContracts.map((contract) => ({ ...contract })),
				...(storyboardImageNodeId ? { storyboardImageNodeId } : {}),
				...(lastFrameImageNodeId ? { lastFrameImageNodeId } : {}),
				...(continuityMode ? { continuityMode } : {}),
				...(typeof item.expectedPrevClipIndex === "number"
					? { expectedPrevClipIndex: item.expectedPrevClipIndex }
					: {}),
				label: `Clip ${item.clipIndex}`,
			},
		});
	}
	return specs;
}

// —— Change A4：从画布占位/视频节点反向重建 StoryPlan ——
// 让 orchestrate 在「没传 StoryPlan、只给 runId」时（finalizer 事件驱动续跑）从画布把计划读回来，
// 复用现有 drive 的 submit/续写/concat 全链，agent 传 plan 走原路不受影响。

type LooseVideoNode = {
	id?: string;
	parentId?: string;
	data?: Record<string, unknown>;
};

type RebuiltStoryPlan = {
	runId: string;
	targetDurationSeconds: number;
	videoModel: string;
	generationContract: VideoGenerationContract;
	aspect?: string;
	resolution?: string;
	recipeId?: string;
	parentGroupId?: string;
	clips: StoryPlanClip[];
};

function readInt(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * 从画布反查某 run 的全部 video clip 节点，按 clipIndex 重建 StoryPlan。
 * - 节点 data 字段来自 buildClipPlaceholderNodes / submit 回写（prompt/characterRoleNames/
 *   videoReferenceNodeIds/storyboardPrompt/durationSeconds/videoModel/videoAspect/...）。
 * - clips 数组按 clipIndex 对齐（缺口用空 clipPrompt 占位，与 orchestrate 现有 `plan.clips[i]?` 容错一致）。
 * - 缺 videoModel 或总时长<=0 → 返回 null（调用方应跳过，绝不抛错）。
 */
export function rebuildStoryPlanFromCanvasNodes(
	nodes: LooseVideoNode[],
	runId: string,
): RebuiltStoryPlan | null {
	const rid = trimmed(runId);
	if (!rid || !Array.isArray(nodes)) return null;

	const byIndex = new Map<number, LooseVideoNode>();
	for (const node of nodes) {
		const data = node?.data ?? {};
		if (trimmed(data.kind).toLowerCase() !== "video") continue;
		if (trimmed(data.clipRunId) !== rid) continue;
		const idx = readInt(data.clipIndex);
		if (idx == null || idx < 0) continue;
		// 同 index 多节点（理论不应有）取先到的稳定结果。
		if (!byIndex.has(idx)) byIndex.set(idx, node);
	}
	if (byIndex.size === 0) return null;

	const maxIndex = Math.max(...byIndex.keys());
	let videoModel = "";
	let generationContract: VideoGenerationContract | null = null;
	let aspect = "";
	let resolution = "";
	let recipeId = "";
	let parentGroupId = "";
	let targetDurationSeconds = 0;
	const clips: StoryPlanClip[] = [];

	for (let i = 0; i <= maxIndex; i += 1) {
		const node = byIndex.get(i);
		if (!node) {
			throw new StoryPlanRebuildContractError(
				"video_run_clip_topology_gap",
				`run ${rid} 的持久化 clipIndex 在 ${i} 处断裂，禁止跳号续跑`,
			);
		}
		const data = node?.data ?? {};
		// Hard cutover：旧占位节点没有可证明的唯一引用真相，禁止在 headless 续跑时把它
		// 默默重建成空引用计划并继续花钱。
		if (Object.prototype.hasOwnProperty.call(data, "referenceImageNodeIds")) {
			throw new StoryPlanRebuildContractError(
				"video_run_legacy_reference_contract",
				`run ${rid} 的 clip ${i} 仍使用已移除的 referenceImageNodeIds，禁止无证据续跑`,
			);
		}
		if (!Array.isArray(data.videoReferenceNodeIds)) {
			throw new StoryPlanRebuildContractError(
				"video_run_reference_contract_missing",
				`run ${rid} 的 clip ${i} 缺少唯一 videoReferenceNodeIds 合同，禁止续跑`,
			);
		}
		if (!videoModel) videoModel = trimmed(data.videoModel);
		if (!generationContract) generationContract = parseVideoGenerationContract(data.generationContract);
		if (!aspect) aspect = trimmed(data.videoAspect) || trimmed(data.aspectRatio);
		if (!resolution) resolution = trimmed(data.resolution);
		if (!recipeId) recipeId = trimmed(data.sourceRecipeId);
		if (!parentGroupId) parentGroupId = trimmed(node?.parentId);
		const dur = readInt(data.durationSeconds);
		if (dur && dur > 0) targetDurationSeconds += dur;

		const clipPrompt = trimmed(data.prompt) || trimmed(data.clipPrompt);
		const storyboardPrompt = trimmed(data.storyboardPrompt);
		const characterRoleNames = nonEmptyStringArray(data.characterRoleNames);
		const videoReferenceNodeIds = nonEmptyStringArray(data.videoReferenceNodeIds);
		const storyboardImageNodeId = trimmed(data.storyboardImageNodeId);
		const lastFrameImageNodeId = trimmed(data.lastFrameImageNodeId);
		const continuityMode = readClipContinuityMode(data.continuityMode);
		if (!continuityMode) {
			throw new StoryPlanRebuildContractError(
				"video_run_continuity_contract_missing",
				`run ${rid} 的 clip ${i} 缺少合法 continuityMode，禁止续跑`,
			);
		}
		if (!Array.isArray(data.assetObjectContracts)) {
			throw new StoryPlanRebuildContractError(
				"video_run_asset_object_contract_invalid",
				`run ${rid} 的 clip ${i} 缺少显式 assetObjectContracts，禁止续跑`,
			);
		}
		const parsedAssetObjectContracts = parseAssetObjectContracts(
			data.assetObjectContracts,
			`clips[${i}].assetObjectContracts`,
			{ allowEmpty: true },
		);
		if (parsedAssetObjectContracts.errors.length) {
			throw new StoryPlanRebuildContractError(
				"video_run_asset_object_contract_invalid",
				parsedAssetObjectContracts.errors.join("；"),
			);
		}
		// 动作迁移（kling-v3-omni）：显式声明 videoReferType 时透传，连同示范视频/原音轨开关。
		// 缺省不带这些键 → 续写链行为逐字不变（零回归）。
		const videoReferType = trimmed(data.videoReferType);
		const sourceVideoUrl = trimmed(data.sourceVideoUrl);
		const keepOriginalSound = trimmed(data.keepOriginalSound);
		clips.push({
			clipPrompt,
			...(storyboardPrompt ? { storyboardPrompt } : {}),
			...(characterRoleNames.length ? { characterRoleNames } : {}),
			...(nonEmptyStringArray(data.propNames).length
				? { propNames: nonEmptyStringArray(data.propNames) }
				: {}),
			...(nonEmptyStringArray(data.vfxNames).length
				? { vfxNames: nonEmptyStringArray(data.vfxNames) }
				: {}),
			...(trimmed(data.sceneName) ? { sceneName: trimmed(data.sceneName) } : {}),
			...(data.characterStates && typeof data.characterStates === "object" && !Array.isArray(data.characterStates)
				? { characterStates: data.characterStates as Record<string, string> }
				: {}),
			videoReferenceNodeIds,
			assetObjectContracts: parsedAssetObjectContracts.contracts,
			...(storyboardImageNodeId ? { storyboardImageNodeId } : {}),
			...(lastFrameImageNodeId ? { lastFrameImageNodeId } : {}),
			continuityMode,
			...(trimmed(data.timeJumpNote) ? { timeJumpNote: trimmed(data.timeJumpNote) } : {}),
			...(trimmed(data.exitState) ? { exitState: trimmed(data.exitState) } : {}),
			...(videoReferType ? { videoReferType } : {}),
			...(sourceVideoUrl ? { sourceVideoUrl } : {}),
			...(keepOriginalSound ? { keepOriginalSound } : {}),
		});
	}

	if (!videoModel || !generationContract || targetDurationSeconds <= 0) return null;
	return {
		runId: rid,
		targetDurationSeconds,
		videoModel,
		generationContract,
		...(aspect ? { aspect } : {}),
		...(resolution ? { resolution } : {}),
		...(recipeId ? { recipeId } : {}),
		...(parentGroupId ? { parentGroupId } : {}),
		clips,
	};
}
