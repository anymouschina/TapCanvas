"use strict";
/**
 * 章节画布 intent 枚举 + 请求/响应共享类型。
 * 规则：intent 可增不可改（一旦发布，含义永久冻结）；
 *       本 Phase 1 不接入任何 intent，仅定义枚举供后续 Phase 消费。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAgentNodeId = exports.buildAgentNodeId = exports.generateBatchUlid = exports.ExtractRolesIntentRequestSchema = exports.FlowPatchToolCallSchema = exports.FlowPatchFinalizeCallSchema = exports.FlowPatchLinkExistingAssetCallSchema = exports.FlowPatchSetParamCallSchema = exports.FlowPatchConnectEdgeCallSchema = exports.FlowPatchAddNodeCallSchema = exports.CHAPTER_CANVAS_INTENTS = void 0;
exports.isChapterCanvasIntent = isChapterCanvasIntent;
const zod_1 = require("zod");
exports.CHAPTER_CANVAS_INTENTS = [
    "extract_roles",
    "expand_video_script",
    "generate_shot_placeholders",
    "generate_scene_references",
    "generate_video_nodes",
    "generate_group_storyboard",
];
function isChapterCanvasIntent(value) {
    return (typeof value === "string" &&
        exports.CHAPTER_CANVAS_INTENTS.includes(value));
}
/** flowPatch tool call 严格 schema（前后端共用；必须与 canvasToolSchemas 保持一一对应） */
const FlowPatchAddNodeArgsSharedFields = {
    id: zod_1.z.string().min(1),
    kind: zod_1.z.string().min(1),
    preset: zod_1.z.string().min(1).optional(),
    content: zod_1.z.record(zod_1.z.unknown()).optional(),
    data: zod_1.z.record(zod_1.z.unknown()).optional(),
};
const FlowPatchAddNodeArgsWithOptionalPositionSchema = zod_1.z
    .object({
    ...FlowPatchAddNodeArgsSharedFields,
    position: zod_1.z.object({ x: zod_1.z.number(), y: zod_1.z.number() }).strict().optional(),
})
    .strict();
const FlowPatchAddNodeArgsWithLegacyCoordinatesSchema = zod_1.z
    .object({
    ...FlowPatchAddNodeArgsSharedFields,
    x: zod_1.z.number(),
    y: zod_1.z.number(),
})
    .strict()
    .transform(({ x, y, ...rest }) => ({
    ...rest,
    position: { x, y },
}));
exports.FlowPatchAddNodeCallSchema = zod_1.z.object({
    name: zod_1.z.literal("add_node"),
    args: zod_1.z.union([
        FlowPatchAddNodeArgsWithOptionalPositionSchema,
        FlowPatchAddNodeArgsWithLegacyCoordinatesSchema,
    ]),
});
exports.FlowPatchConnectEdgeCallSchema = zod_1.z.object({
    name: zod_1.z.literal("connect_edge"),
    args: zod_1.z.object({
        source: zod_1.z.string().min(1),
        target: zod_1.z.string().min(1),
        sourceHandle: zod_1.z.string().min(1).optional(),
        targetHandle: zod_1.z.string().min(1).optional(),
    }),
});
exports.FlowPatchSetParamCallSchema = zod_1.z.object({
    name: zod_1.z.literal("set_param"),
    args: zod_1.z.object({
        nodeId: zod_1.z.string().min(1),
        patch: zod_1.z.record(zod_1.z.unknown()),
    }),
});
exports.FlowPatchLinkExistingAssetCallSchema = zod_1.z.object({
    name: zod_1.z.literal("link_existing_asset"),
    args: zod_1.z.object({
        targetNodeId: zod_1.z.string().min(1),
        existingNodeId: zod_1.z.string().min(1),
        role: zod_1.z.string().min(1),
    }),
});
exports.FlowPatchFinalizeCallSchema = zod_1.z.object({
    name: zod_1.z.literal("finalize"),
    args: zod_1.z
        .object({
        focusNodeId: zod_1.z.string().min(1).optional(),
        summary: zod_1.z.string().optional(),
        // 由 bridge 在上游过载等可挽回错误下注入：表示这次 finalize 是 bridge 合成的"半成品交付"，
        // 不是 AI 主动 finalize。web 端可以据此区分提示文案与重试按钮。
        partialReason: zod_1.z.string().optional(),
    })
        .strict(),
});
exports.FlowPatchToolCallSchema = zod_1.z.discriminatedUnion("name", [
    exports.FlowPatchAddNodeCallSchema,
    exports.FlowPatchConnectEdgeCallSchema,
    exports.FlowPatchSetParamCallSchema,
    exports.FlowPatchLinkExistingAssetCallSchema,
]);
/** Phase 2 canary intent: extract_roles */
exports.ExtractRolesIntentRequestSchema = zod_1.z.object({
    intent: zod_1.z.literal("extract_roles"),
    sourceNodeId: zod_1.z.string().min(1),
    chapterContext: zod_1.z.object({
        projectId: zod_1.z.string().min(1),
        bookId: zod_1.z.string().min(1).nullable(),
        chapterId: zod_1.z.string().min(1),
        flowSnapshot: zod_1.z.object({
            nodes: zod_1.z.array(zod_1.z.object({
                id: zod_1.z.string().min(1),
                kind: zod_1.z.string().min(1),
                preset: zod_1.z.string().optional(),
                data: zod_1.z.record(zod_1.z.unknown()),
            })),
            edges: zod_1.z.array(zod_1.z.object({
                id: zod_1.z.string().min(1),
                source: zod_1.z.string().min(1),
                target: zod_1.z.string().min(1),
                sourceHandle: zod_1.z.string().optional(),
                targetHandle: zod_1.z.string().optional(),
            })),
        }),
    }),
    userHints: zod_1.z.string().max(2000).optional(),
});
var batchUlid_1 = require("./batchUlid");
Object.defineProperty(exports, "generateBatchUlid", { enumerable: true, get: function () { return batchUlid_1.generateBatchUlid; } });
Object.defineProperty(exports, "buildAgentNodeId", { enumerable: true, get: function () { return batchUlid_1.buildAgentNodeId; } });
Object.defineProperty(exports, "parseAgentNodeId", { enumerable: true, get: function () { return batchUlid_1.parseAgentNodeId; } });
