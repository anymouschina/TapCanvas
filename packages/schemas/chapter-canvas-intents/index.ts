/**
 * 章节画布 intent 枚举 + 请求/响应共享类型。
 * 规则：intent 可增不可改（一旦发布，含义永久冻结）；
 *       本 Phase 1 不接入任何 intent，仅定义枚举供后续 Phase 消费。
 */

import { z } from "zod";

export const CHAPTER_CANVAS_INTENTS = [
	"extract_roles",
	"expand_video_script",
	"generate_shot_placeholders",
	"generate_scene_references",
	"generate_video_nodes",
	"generate_group_storyboard",
] as const;

export type ChapterCanvasIntent = (typeof CHAPTER_CANVAS_INTENTS)[number];

export function isChapterCanvasIntent(
	value: unknown,
): value is ChapterCanvasIntent {
	return (
		typeof value === "string" &&
		(CHAPTER_CANVAS_INTENTS as readonly string[]).includes(value)
	);
}

/**
 * 统一 TS 类型（所有 intent 共用的请求形状）。
 * 注意：每个 intent 的 Zod schema（如 `ExtractRolesIntentRequestSchema`）可能只覆盖该 intent
 * 当前阶段实际消费的字段子集 —— 例如 Phase 2 的 `extract_roles` 不消费 `continueFromNodeId` /
 * `onlyMissing` / 无上限的 `userHints`。当后续 Phase 的 intent 用到这些字段时，再在该 intent 的
 * Zod schema 里显式加上并做校验；TS 类型保留全集作为前向兼容声明。
 */
export type ChapterCanvasIntentRequest = {
	intent: ChapterCanvasIntent;
	sourceNodeId: string;
	chapterContext: {
		projectId: string;
		bookId: string | null;
		chapterId: string;
		flowSnapshot: {
			nodes: Array<{
				id: string;
				kind: string;
				preset?: string;
				data: Record<string, unknown>;
			}>;
			edges: Array<{
				id: string;
				source: string;
				target: string;
				sourceHandle?: string;
				targetHandle?: string;
			}>;
		};
	};
	/** 可选自由文本 hint；单 intent schema 可按需加上 `.max(N)` 做上限校验 */
	userHints?: string;
	/** 可选生成配置；由具体 intent 决定是否消费，必须作为结构化事实传递 */
	generationConfig?: {
		imageModel?: string;
		imageSize?: string;
	};
	/** 续写：下一阶段 intent 扩展时使用（Phase 2 的 extract_roles 暂不消费） */
	continueFromNodeId?: string;
	/** 续写：只补缺失项，不重算（Phase 2 的 extract_roles 暂不消费） */
	onlyMissing?: boolean;
};

/** flowPatch tool call 严格 schema（前后端共用；必须与 canvasToolSchemas 保持一一对应） */
const FlowPatchAddNodeArgsSharedFields = {
	id: z.string().min(1),
	kind: z.string().min(1),
	preset: z.string().min(1).optional(),
	content: z.record(z.unknown()).optional(),
	data: z.record(z.unknown()).optional(),
} as const;

const FlowPatchAddNodeArgsWithOptionalPositionSchema = z
	.object({
		...FlowPatchAddNodeArgsSharedFields,
		position: z.object({ x: z.number(), y: z.number() }).strict().optional(),
	})
	.strict();

const FlowPatchAddNodeArgsWithLegacyCoordinatesSchema = z
	.object({
		...FlowPatchAddNodeArgsSharedFields,
		x: z.number(),
		y: z.number(),
	})
	.strict()
	.transform(({ x, y, ...rest }) => ({
		...rest,
		position: { x, y },
	}));

export const FlowPatchAddNodeCallSchema = z.object({
	name: z.literal("add_node"),
	args: z.union([
		FlowPatchAddNodeArgsWithOptionalPositionSchema,
		FlowPatchAddNodeArgsWithLegacyCoordinatesSchema,
	]),
});

export const FlowPatchConnectEdgeCallSchema = z.object({
	name: z.literal("connect_edge"),
	args: z.object({
		source: z.string().min(1),
		target: z.string().min(1),
		sourceHandle: z.string().min(1).optional(),
		targetHandle: z.string().min(1).optional(),
	}),
});

export const FlowPatchSetParamCallSchema = z.object({
	name: z.literal("set_param"),
	args: z.object({
		nodeId: z.string().min(1),
		patch: z.record(z.unknown()),
	}),
});

export const FlowPatchLinkExistingAssetCallSchema = z.object({
	name: z.literal("link_existing_asset"),
	args: z.object({
		targetNodeId: z.string().min(1),
		existingNodeId: z.string().min(1),
		role: z.string().min(1),
	}),
});

export const FlowPatchFinalizeCallSchema = z.object({
	name: z.literal("finalize"),
	args: z
		.object({
			focusNodeId: z.string().min(1).optional(),
			summary: z.string().optional(),
			// 由 bridge 在上游过载等可挽回错误下注入：表示这次 finalize 是 bridge 合成的"半成品交付"，
			// 不是 AI 主动 finalize。web 端可以据此区分提示文案与重试按钮。
			partialReason: z.string().optional(),
		})
		.strict(),
});

export const FlowPatchToolCallSchema = z.discriminatedUnion("name", [
	FlowPatchAddNodeCallSchema,
	FlowPatchConnectEdgeCallSchema,
	FlowPatchSetParamCallSchema,
	FlowPatchLinkExistingAssetCallSchema,
]);

export type FlowPatchToolCall = z.infer<typeof FlowPatchToolCallSchema>;
export type FlowPatchFinalizeCall = z.infer<typeof FlowPatchFinalizeCallSchema>;

/** SSE 流事件（前端在 streamChapterIntent 内解析） */
export type IntentStreamEvent =
	| { event: "flow_patch"; data: FlowPatchToolCall }
	| { event: "finalize"; data: z.infer<typeof FlowPatchFinalizeCallSchema>["args"] }
	| { event: "progress"; data: { toolCallsSoFar: number } }
	| { event: "error"; data: { message: string; code?: string } }
	| { event: "done"; data: { reason: string } };

/** Phase 2 canary intent: extract_roles */
export const ExtractRolesIntentRequestSchema = z.object({
	intent: z.literal("extract_roles"),
	sourceNodeId: z.string().min(1),
	chapterContext: z.object({
		projectId: z.string().min(1),
		bookId: z.string().min(1).nullable(),
		chapterId: z.string().min(1),
		flowSnapshot: z.object({
			nodes: z.array(
				z.object({
					id: z.string().min(1),
					kind: z.string().min(1),
					preset: z.string().optional(),
					data: z.record(z.unknown()),
				}),
			),
			edges: z.array(
				z.object({
					id: z.string().min(1),
					source: z.string().min(1),
					target: z.string().min(1),
					sourceHandle: z.string().optional(),
					targetHandle: z.string().optional(),
				}),
			),
		}),
	}),
	userHints: z.string().max(2000).optional(),
});

export type ExtractRolesIntentRequest = z.infer<
	typeof ExtractRolesIntentRequestSchema
>;

export type ExtractRolesIntentResponseSummary = {
	roleCount: number;
	batchUlid: string;
	focusNodeId?: string;
};

export {
	generateBatchUlid,
	buildAgentNodeId,
	parseAgentNodeId,
	type AgentNodeIdParts,
} from "./batchUlid";
