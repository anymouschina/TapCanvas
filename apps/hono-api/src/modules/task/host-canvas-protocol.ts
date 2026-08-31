// apps/hono-api/src/modules/task/host-canvas-protocol.ts
// 画布宿主开放协议（v1）：三方画布平台通过 OpenAI 兼容入口接入小T时，
// 用 system 消息段声明自己的节点能力清单与画布快照。
import { z } from "zod";
// 薄执行合同（generation_contract 段）校验复用 hono 现成 Zod 镜像（权威 schema 在
// agents-cli/src/contracts/generation-contract.ts，两处经 shared-schema-loader 同源常量）。
// import 方向 task → apiKey.schemas 无循环（apiKey.schemas 只回依赖 task/task.schemas）。
import { PublicChatGenerationContractSchema } from "../apiKey/apiKey.schemas";

export type HostGenerationContract = z.infer<typeof PublicChatGenerationContractSchema>;

export const HOST_PATCH_OPS = [
	"addNode",
	"updateNodeData",
	"connectEdge",
	"focusNode",
	"placeImage",
	"runNode",
] as const;
export type HostPatchOp = (typeof HOST_PATCH_OPS)[number];

const HostNodePositionSchema = z.object({ x: z.number(), y: z.number() });
const HostPatchNodeSchema = z.object({
	id: z.string().min(1),
	type: z.string().min(1),
	data: z.record(z.unknown()).optional(),
	position: HostNodePositionSchema.optional(),
});

/** 单个宿主画布命令的确定性协议；命令通过不代表宿主已经执行。 */
export const HostFlowPatchSchema = z.discriminatedUnion("op", [
	z.object({ op: z.literal("addNode"), node: HostPatchNodeSchema }),
	z.object({ op: z.literal("updateNodeData"), id: z.string().min(1), patch: z.record(z.unknown()) }),
	z.object({
		op: z.literal("connectEdge"),
		source: z.string().min(1),
		target: z.string().min(1),
		sourceHandle: z.string().optional(),
		targetHandle: z.string().optional(),
	}),
	z.object({ op: z.literal("focusNode"), id: z.string().min(1) }),
	z.object({ op: z.literal("placeImage"), url: z.string().url(), name: z.string().optional() }),
	z.object({ op: z.literal("runNode"), id: z.string().min(1) }),
]);
export type HostFlowPatch = z.infer<typeof HostFlowPatchSchema>;

export const HostNodeSpecSchema = z.object({
	type: z.string().min(1).max(64),
	label: z.string().max(200).optional(),
	purpose: z.string().max(2000).optional(),
	// data 字段说明：JSON Schema 子集（properties 级即可，模型照此产 data）
	params: z.record(z.unknown()).optional(),
	inputs: z.array(z.object({ handle: z.string(), accepts: z.string().optional() })).optional(),
	outputs: z.array(z.object({ handle: z.string(), emits: z.string().optional() })).optional(),
	constraints: z.array(z.string().max(500)).optional(),
});
export type HostNodeSpec = z.infer<typeof HostNodeSpecSchema>;

/**
 * 宿主自己执行的高层业务能力。facade 只负责把声明过的调用可靠地交还宿主，
 * 不在 TapCanvas 内部执行，也不把“已发出命令”冒充为真实业务完成。
 */
export const HostToolSpecSchema = z.object({
	name: z.string().min(1).max(64),
	description: z.string().min(1).max(2000).optional(),
	parameters: z.record(z.unknown()).optional(),
});
export type HostToolSpec = z.infer<typeof HostToolSpecSchema>;

/** agents-cli 调用统一 host_tool 时的确定性信封。 */
export const HostToolCallSchema = z.object({
	name: z.string().min(1).max(64),
	arguments: z.record(z.unknown()).optional(),
});
export type HostToolCall = z.infer<typeof HostToolCallSchema>;

/**
 * 富格式 UI 能力：宿主声明后 facade 才经 host_ui tool_call 下发对应结构化卡。
 * 两段（同一命名空间，声明语义一致）：
 * - v1.1 协议级 kind：choices/suggestions/media/request_user_input
 * - v1.2 tc-card 富卡 name：小T 用 ```tc-card 围栏产出，kind 即卡名。
 *   **权威源 = agents-cli src/types/content-blocks.ts 的 KNOWN_DATA_BLOCK_NAMES**
 *   （那里列了全部需同步的副本）；新增卡名漏加到这里，会让声明该卡的宿主整份
 *   manifest 撞 Zod 枚举报 400。choices 两段共用（既是协议级 kind 也是已注册卡名），故不重复列。
 * 未声明的种类降级纯文本或抑制，见 public-openai-compat 的分发。
 */
export const HOST_UI_KINDS = [
	"choices",
	"suggestions",
	"media",
	"request_user_input",
	"artifact",
	"character_cards",
	"scene_list",
	"action_banner",
	"source_contract",
	"generation_task",
	"role_note",
] as const;
export type HostUiKind = (typeof HOST_UI_KINDS)[number];

/** HOST_UI_KINDS 里属于 tc-card 富卡的子集（其余是协议级 kind）。用于按宿主声明约束模型输出。 */
export const TC_CARD_UI_KINDS = [
	"artifact",
	"character_cards",
	"scene_list",
	"action_banner",
	"source_contract",
	"generation_task",
	"role_note",
] as const satisfies readonly HostUiKind[];

export const HostCapabilityManifestSchema = z.object({
	protocol_version: z.literal("1"),
	host: z.string().min(1).max(64),
	// A host may describe where its UI is running. This is a declaration only;
	// workspace authority additionally requires a server-side account allowlist.
	executionMode: z.enum(["hosted", "local_desktop"]).optional(),
	patchOps: z.array(z.enum(HOST_PATCH_OPS)).min(1),
	nodeSpecs: z.array(HostNodeSpecSchema).min(1).max(64),
	// v1.3：宿主可声明由自己执行的高层业务工具；facade 统一经 host_tool 回传。
	hostTools: z.array(HostToolSpecSchema).max(16).optional(),
	notes: z.array(z.string().max(1000)).max(32).optional(),
	// v1.1/v1.2：宿主可选声明能渲染的富 UI 种类；未声明的种类 facade 降级（转纯文本）或抑制。
	// 上限跟随 HOST_UI_KINDS 全集——宿主全声明时不能被自己的上限卡住（原写死 8，
	// v1.2 扩到 9 种后会让全声明的宿主整份 manifest 校验失败报 400）。
	ui: z.array(z.enum(HOST_UI_KINDS)).max(HOST_UI_KINDS.length).optional(),
	// 生成模式：host=宿主画布节点生成（默认）；managed=TapCanvas 全托管生成资产经 media 卡回传；both=两者可用。
	// v1.1 预留：managed/both 的生成工具放开尚未启用（见 bridge TODO）。
	generationMode: z.enum(["host", "managed", "both"]).optional(),
	// 宿主 UI 当前选择的生图倍数。语义计数禁止从自然语言重新推断。
	imageOutputCount: z.number().int().min(1).max(8).optional(),
});
export type HostCapabilityManifest = z.infer<typeof HostCapabilityManifestSchema>;

export const HostCanvasContextSchema = z.object({
	nodes: z.array(z.record(z.unknown())).max(500).default([]),
	edges: z.array(z.record(z.unknown())).max(1000).default([]),
});
export type HostCanvasContext = z.infer<typeof HostCanvasContextSchema>;

const OpenAiMessageSchema = z.object({
	// developer 为新版 OpenAI SDK 的 system 等价角色，处理时视同 system
	role: z.enum(["system", "developer", "user", "assistant", "tool"]),
	content: z.union([z.string(), z.array(z.unknown()), z.null()]).optional(),
});
export type OpenAiMessage = z.infer<typeof OpenAiMessageSchema>;

export type HostProtocolErrorCode =
	| "invalid_capability_manifest"
	| "invalid_canvas_context"
	| "invalid_generation_contract"
	| "invalid_messages";

/** 协议解析错误：facade 层用 instanceof 映射为 HTTP 400 */
export class HostProtocolError extends Error {
	readonly code: HostProtocolErrorCode;
	constructor(code: HostProtocolErrorCode, message: string) {
		super(message);
		this.name = "HostProtocolError";
		this.code = code;
	}
}

const MANIFEST_RE = /<capability_manifest>([\s\S]*?)<\/capability_manifest>/;
const CONTEXT_RE = /<canvas_context>([\s\S]*?)<\/canvas_context>/;
const CONTRACT_RE = /<generation_contract>([\s\S]*?)<\/generation_contract>/;
const MANIFEST_RE_G = /<capability_manifest>[\s\S]*?<\/capability_manifest>/g;
const CONTEXT_RE_G = /<canvas_context>[\s\S]*?<\/canvas_context>/g;
const CONTRACT_RE_G = /<generation_contract>[\s\S]*?<\/generation_contract>/g;

function messageText(content: OpenAiMessage["content"]): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (!part || typeof part !== "object" || Array.isArray(part)) return "";
				const record = part as Record<string, unknown>;
				return typeof record.text === "string" ? record.text : "";
			})
			.join("");
	}
	return "";
}

function parseTagged<T>(
	raw: string,
	schema: z.ZodType<T, z.ZodTypeDef, unknown>,
	tag: "capability_manifest" | "canvas_context" | "generation_contract",
): T {
	const code: HostProtocolErrorCode =
		tag === "capability_manifest"
			? "invalid_capability_manifest"
			: tag === "canvas_context"
				? "invalid_canvas_context"
				: "invalid_generation_contract";
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new HostProtocolError(code, `invalid ${tag}: not valid JSON`);
	}
	const result = schema.safeParse(parsed);
	if (!result.success) {
		throw new HostProtocolError(
			code,
			`invalid ${tag}: ${result.error.issues[0]?.message || "schema mismatch"}`,
		);
	}
	return result.data;
}

export interface HostSegments {
	manifest?: HostCapabilityManifest;
	canvasContext?: HostCanvasContext;
	/** 薄执行合同（风格锚定载体）：facade 放 extras.generationContract 走现成端到端通道 */
	generationContract?: HostGenerationContract;
	/** 非协议段的 system 内容（原样保留为附加指令） */
	instructions: string[];
	/** 最后一条 user 消息文本 → prompt */
	prompt: string;
	/** 历史（除末条 user 外的 user/assistant，可供后续多轮透传，v1 暂只透传 prompt） */
	history: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * 从 OpenAI 兼容 messages 中抽取宿主协议段。
 * 注意：同名标签段跨多条 system 消息时以最后一条为准；同一条消息内只识别第一个标签块。
 * 标签体 JSON 字符串值内不得出现字面 `</capability_manifest>`。
 */
export function extractHostSegments(rawMessages: unknown): HostSegments {
	const parsedMessages = z.array(OpenAiMessageSchema).safeParse(rawMessages ?? []);
	if (!parsedMessages.success) {
		throw new HostProtocolError(
			"invalid_messages",
			`invalid messages: ${parsedMessages.error.issues[0]?.message || "schema mismatch"}`,
		);
	}
	const messages = parsedMessages.data;
	let manifest: HostCapabilityManifest | undefined;
	let canvasContext: HostCanvasContext | undefined;
	let generationContract: HostGenerationContract | undefined;
	const instructions: string[] = [];
	const history: Array<{ role: "user" | "assistant"; content: string }> = [];
	let prompt = "";

	for (const msg of messages) {
		const text = messageText(msg.content).trim();
		if (msg.role === "system" || msg.role === "developer") {
			const m = text.match(MANIFEST_RE);
			if (m) {
				manifest = parseTagged(m[1], HostCapabilityManifestSchema, "capability_manifest");
			}
			const cx = text.match(CONTEXT_RE);
			if (cx) {
				canvasContext = parseTagged(cx[1], HostCanvasContextSchema, "canvas_context");
			}
			const gc = text.match(CONTRACT_RE);
			if (gc) {
				generationContract = parseTagged(
					gc[1],
					PublicChatGenerationContractSchema,
					"generation_contract",
				);
			}
			const rest = text
				.replace(MANIFEST_RE_G, "")
				.replace(CONTEXT_RE_G, "")
				.replace(CONTRACT_RE_G, "")
				.trim();
			if (rest) instructions.push(rest);
			continue;
		}
		if (msg.role === "user" || msg.role === "assistant") {
			if (text) history.push({ role: msg.role, content: text });
		}
	}
	// 注意：最后一条 user 消息若只含图片 part（无 text）会因 text 为空被跳过，
	// prompt 会回退到更早的一轮 user 消息。
	for (let i = history.length - 1; i >= 0; i -= 1) {
		if (history[i].role === "user") {
			prompt = history[i].content;
			history.splice(i, 1);
			break;
		}
	}
	return { manifest, canvasContext, generationContract, instructions, prompt, history };
}

/** 把宿主 manifest 渲染成给 agents-cli 的完整能力提示块 */
export function renderHostManifestPrompt(
	manifest: HostCapabilityManifest,
	canvasContext?: HostCanvasContext,
): string {
	const lines: string[] = [
		"## Host Canvas Capability (authoritative)",
		`host: ${manifest.host} · protocol v${manifest.protocol_version}`,
		"你正在为一个外部画布宿主工作。低层画布写入只能通过 flow_patch；宿主声明的高层业务能力必须通过 host_tool，禁止编造或改用另一条路径：",
		`允许的 op: ${manifest.patchOps.join(", ")}`,
		"节点类型清单（type / 用途 / data 字段）：",
	];
	for (const spec of manifest.nodeSpecs) {
		lines.push(
			`- ${spec.type}${spec.label ? `（${spec.label}）` : ""}: ${spec.purpose || ""}` +
				(spec.params ? ` data=${JSON.stringify(spec.params).slice(0, 2000)}` : "") +
				(spec.inputs?.length ? ` inputs=${spec.inputs.map((i) => i.handle).join("/")}` : "") +
				(spec.outputs?.length ? ` outputs=${spec.outputs.map((o) => o.handle).join("/")}` : "") +
				(spec.constraints?.length ? ` 约束: ${spec.constraints.join("；")}` : ""),
		);
	}
	if (manifest.hostTools?.length) {
		lines.push(
			"宿主高层工具（调用统一 host_tool，参数信封为 {name,arguments}）：",
			...manifest.hostTools.map((tool) =>
				`- ${tool.name}: ${tool.description || "宿主声明的业务动作"}` +
				(tool.parameters ? ` arguments=${JSON.stringify(tool.parameters).slice(0, 4000)}` : ""),
			),
			"用户请求与某个高层工具直接匹配时必须调用该工具；不得因为该能力不是 flow_patch 而声称宿主未提供，也不得用 flow_patch 手工拼装其内部产物。",
		);
	}
	if (manifest.notes?.length) lines.push(`宿主备注: ${manifest.notes.join("；")}`);
	if (manifest.imageOutputCount !== undefined) {
		lines.push(
			`图片输出数量（宿主 UI 权威值）: ${manifest.imageOutputCount}`,
			`当用户要求生成图片时，必须恰好创建 ${manifest.imageOutputCount} 个单输出图片生成节点并各运行一次；不得从用户措辞、prompt 数量或画布历史推断/覆盖这个数量。`,
			"每个图片输出最多使用一个提示词来源；不得额外创建重复 prompt 节点，不得使用 generate4 / generatePro4 等单节点多图类型。",
			"宿主画布节点是这些图片任务的唯一结果真源；不要再用 media 卡或 present_media 重复报告同一批宿主生图结果。",
			"完整的 prompt 节点、图片生成节点、连线与 runNode 操作应在同一条 assistant 响应中一次性发出全部 flow_patch tool calls；本服务只把命令交给宿主，宿主负责串行执行并验收真实资产。",
		);
	}
	lines.push(
		"flow_patch 调用约定：每次调用只含一个操作对象 {op, ...}；addNode 需给 node:{id,type,data,position?}，id 用你生成的短随机串；connectEdge 用 {source,target,sourceHandle?,targetHandle?}；updateNodeData 用 {id,patch}；runNode 用 {id}；focusNode 用 {id}；placeImage 用 {url,name?}。",
		"flow_patch 成功只表示命令已写入宿主响应，不表示节点已执行、异步任务已受理或资产已生成；引用节点时优先用 canvas_context 里的真实 id。",
	);
	// v1.1 UI 能力：按宿主声明约束模型的富格式输出，未声明的通道不要用（facade 会抑制/降级）。
	const ui = new Set(manifest.ui ?? []);
	lines.push("UI 能力（按宿主声明严格遵守）：");
	if (ui.has("choices")) {
		lines.push(
			'- 需要用户在几个选项中拍板时，用 ```choices 围栏输出 JSON 卡：{"question":"...","options":[{"label":"...","description":"..."}]}；围栏外不要重复选项内容。' +
				'顶层必须是带 question 键的**对象**，禁止写成裸数组 [{"label":...}]、禁止漏围栏。',
		);
	} else {
		lines.push(
			'- 提问选项一律用纯文本列点（1. / 2. …），禁止输出 ```choices 围栏 JSON 卡或行首 {"question"...} JSON。',
		);
	}
	if (!ui.has("request_user_input")) {
		lines.push("- 不得调用 request_user_input 工具，需要用户确认时改用文本提问。");
	}
	if (ui.has("media")) {
		lines.push("- 生成的图片/视频可用 present_media 工具展示。");
	} else {
		lines.push("- 展示生成的图片/视频时在正文直接给出 URL（宿主无媒体卡通道）。");
	}
	// v1.2 tc-card 富卡：root-persona 无条件指示模型用 ```tc-card 围栏产出富卡，
	// 这里按宿主声明收口——只放行声明过的卡名，一个都没声明就禁用围栏改说人话。
	// （facade 侧仍有剥离+降级兜底，两层防的是原始卡 JSON 泄漏进宿主气泡。）
	const declaredCards = TC_CARD_UI_KINDS.filter((name) => ui.has(name));
	if (declaredCards.length) {
		lines.push(
			`- 结构化卡片只允许这些 name：${declaredCards.join(" / ")}（用 \`\`\`tc-card 围栏，首行 \`\`\`tc-card、次行单个 {"name":"…","payload":{…}} JSON、末行 \`\`\`）；未列出的 name 一律不要产出，改写成正文人话。`,
		);
	} else {
		lines.push(
			'- 禁止输出 ```tc-card 围栏或任何裸卡 JSON（行首 {"name":...}）：本宿主不渲染富卡。结论/文档/角色/场景清单一律写成正文人话（标题+列点+表格皆可）。',
		);
	}
	if (canvasContext) {
		lines.push(
			"<canvas_context readonly>",
			JSON.stringify(canvasContext).slice(0, 20_000),
			"</canvas_context>",
		);
	}
	return lines.join("\n");
}

/** 宿主模式下给 agents-cli 的唯一画布远程工具定义 */
export function buildHostFlowPatchTool(manifest: HostCapabilityManifest) {
	return {
		name: "flow_patch",
		description:
			`向宿主(${manifest.host})画布下发一个操作。允许的 op: ${manifest.patchOps.join(", ")}。` +
			"每次调用恰好一个操作；节点类型必须来自 Host Canvas Capability 清单。",
		parameters: {
			type: "object",
			properties: {
				op: { type: "string", enum: [...manifest.patchOps] },
				node: {
					type: "object",
					description: "addNode 时必填: {id,type,data,position?{x,y}}",
				},
				id: { type: "string", description: "updateNodeData/focusNode/runNode 的目标节点 id" },
				patch: { type: "object", description: "updateNodeData 的 data 增量" },
				source: { type: "string" },
				target: { type: "string" },
				sourceHandle: { type: "string" },
				targetHandle: { type: "string" },
				url: { type: "string", description: "placeImage 的图片 URL" },
				name: { type: "string" },
			},
			required: ["op"],
		},
	};
}

/** 宿主模式下统一的高层业务工具；具体可调用名称完全由 manifest 驱动。 */
export function buildHostTool(manifest: HostCapabilityManifest) {
	const tools = manifest.hostTools ?? [];
	return {
		name: "host_tool",
		description:
			`调用宿主(${manifest.host})声明的高层业务能力。` +
			tools.map((tool) => `${tool.name}: ${tool.description || "宿主业务动作"}`).join("；"),
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					enum: tools.map((tool) => tool.name),
					description: "必须精确选择宿主声明的工具名",
				},
				arguments: {
					type: "object",
					description: "所选宿主工具的参数；严格遵守 Host Canvas Capability 中对应 parameters",
				},
			},
			required: ["name", "arguments"],
		},
	};
}
