import {
	convertToModelMessages,
	generateText,
	streamText,
	tool,
	zodSchema,
} from "ai";
import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import {
	createGoogleGenerativeAI,
	google,
} from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import {
	ChatStreamRequestSchema,
	type ChatStreamRequest,
} from "./ai.schemas";
import { SYSTEM_PROMPT, IMAGE_AGENT_PROMPT } from "./constants";
import { formatPromptSample, matchPromptSamples } from "./prompt-samples.data";
import { z } from "zod";
import { canvasToolSchemas } from "./tool-schemas";
import { publishToolEvent } from "./tool-events.bus";

type Provider = "openai" | "anthropic" | "google";
type ProviderVendor = "openai" | "anthropic" | "gemini";

type VendorContext = {
	baseUrl: string;
	apiKey: string;
};

type ProviderRow = {
	id: string;
	name: string;
	vendor: string;
	base_url: string | null;
	shared_base_url: number;
	owner_id: string;
	created_at: string;
	updated_at: string;
};

type TokenRow = {
	id: string;
	provider_id: string;
	label: string;
	secret_token: string;
	user_agent: string | null;
	user_id: string;
	enabled: number;
	shared: number;
	shared_failure_count: number;
	shared_last_failure_at: string | null;
	shared_disabled_until: string | null;
	created_at: string;
	updated_at: string;
};

type ProxyProviderRow = {
	id: string;
	owner_id: string;
	name: string;
	vendor: string;
	base_url: string | null;
	api_key: string | null;
	enabled: number;
	enabled_vendors: string | null;
	settings: string | null;
	created_at: string;
	updated_at: string;
};

type ChatProvider = "openai" | "anthropic" | "google";

type ChatRole = "system" | "user" | "assistant";

type ChatSessionRow = {
	id: string;
	user_id: string;
	session_id: string;
	title: string | null;
	model: string | null;
	provider: string | null;
	created_at: string;
	updated_at: string;
};

type ChatMessageRow = {
	id: string;
	session_id: string;
	role: string;
	content: string | null;
	raw: string | null;
	created_at: string;
};

type ChatMessageDto = {
	role: ChatRole;
	content?: string;
	parts?: Array<any>;
	metadata?: Record<string, any>;
};

// 在后端共享 SYSTEM_PROMPT 的基础上，针对 Worker 侧补充一条关键原则：
// “能通过当前工具链完成的事情，优先由 AI 自己调用工具完成，而不是让用户去点按钮或手动操作”，
// 只有在能力确实受限或需要额外授权/业务决策时才请用户出手。
const WORKER_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

【Worker 扩展规则 · 主动执行】
- 默认由你主动完成一切当前工具链可以实现的功能：优先自己创建/修改节点、连接边、运行任务和更新配置，而不是让用户去点击界面或手动调用 API；只有在明确超出现有工具能力、涉及高风险/敏感操作需要用户确认，或缺少关键业务决策输入（例如预算上限、账号绑定等）时，才请用户手动执行或补充信息。`;

const IntentSchema = z.object({
	intent: z.string().min(1),
	goals: z.array(z.string()).min(1),
	acceptance: z.array(z.string()).optional(),
	priority: z.enum(["low", "medium", "high"]).optional(),
	allowSearch: z.boolean().optional(),
	notes: z.string().optional(),
});

const PlanStepSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	description: z.string().min(1),
	expectedOutcome: z.string().optional(),
});

const PlannerOutputSchema = z.object({
	steps: z.array(PlanStepSchema).min(1),
	rationale: z.string().optional(),
});

const QaGuardrailSchema = z.object({
	acceptance: z.array(z.string()).min(1),
	checkpoints: z.array(z.string()).optional(),
	failureHandling: z.array(z.string()).optional(),
	extras: z.array(z.string()).optional(),
});

type IntentOutput = z.infer<typeof IntentSchema>;
type PlannerOutput = z.infer<typeof PlannerOutputSchema>;
type QaGuardrailOutput = z.infer<typeof QaGuardrailSchema>;

function normalizePart(part: any) {
	if (!part) return null;
	// 丢弃早期 Worker 占位工具输出，避免模型误以为无法访问画布
	try {
		const msg =
			typeof part?.message === "string"
				? part.message
				: typeof part?.output?.message === "string"
					? part.output.message
					: typeof part?.errorText === "string"
						? part.errorText
						: undefined;
		if (
			msg &&
			msg.includes(
				"Canvas 工具仅在前端执行（clientToolExecution 模式），当前 Worker 未实现该工具。",
			)
		) {
			return null;
		}
	} catch {
		// ignore
	}
	if (part.type === "item_reference") {
		return null;
	}
	if (part.type === "function_call_output") {
		const textPayload =
			typeof part.output === "string"
				? part.output
				: (() => {
						try {
							return JSON.stringify(part.output);
						} catch {
							return "";
						}
					})();
		return textPayload ? { type: "text", text: textPayload } : null;
	}
	if (part.type === "text" || part.type === "reasoning") {
		return {
			type: part.type,
			text: typeof part.text === "string" ? part.text : "",
		};
	}
	if (part.type === "step-start" || part.type === "step-end") {
		return { type: part.type };
	}
	if (part.type?.startsWith("tool-")) {
		const { providerMetadata, callProviderMetadata, ...rest } = part;
		return rest;
	}
	if (typeof part === "object") {
		const { providerMetadata, callProviderMetadata, ...rest } = part;
		return rest;
	}
	return null;
}

function mapToUiMessage(
	message: ChatMessageDto,
): { role: ChatRole; parts: any[]; metadata?: Record<string, any> } | null {
	const hasParts =
		Array.isArray((message as any)?.parts) &&
		(message as any).parts.length > 0;
	const fallbackText =
		typeof message.content === "string" ? message.content : "";
	const parts = hasParts
		? (message.parts as any[])
				.map((part) => normalizePart(part))
				.filter(Boolean)
		: [{ type: "text", text: fallbackText }];
	const metadata = (message as any)?.metadata;
	if (!parts.length) return null;
	return {
		role: (message.role || "user") as ChatRole,
		parts,
		...(metadata ? { metadata } : {}),
	};
}

function normalizeMessagesForModel(messages: any[]): any[] {
	if (!Array.isArray(messages) || !messages.length) return [];
	const filtered = (messages as ChatMessageDto[]).filter(
		(message): message is ChatMessageDto => {
			return !!message && typeof message.role === "string";
		},
	);
	if (!filtered.length) return [];
	const uiMessages = filtered
		.map((message) => mapToUiMessage(message))
		.filter(
			(msg): msg is NonNullable<ReturnType<typeof mapToUiMessage>> =>
				!!msg && msg.parts.length > 0,
		);
	return uiMessages;
}

function normalizeProvidedTools(tools: unknown): Record<string, any> | null {
	if (!tools) return null;
	if (
		typeof tools === "object" &&
		!Array.isArray(tools) &&
		Object.keys(tools as Record<string, any>).length > 0
	) {
		return tools as Record<string, any>;
	}
	return null;
}

// 将后端共享的 canvasToolSchemas（description + inputSchema:zod）转换为
// Vercel AI SDK 标准的 Tool 定义，确保发给 Codex/OpenAI 的 parameters 是合法 JSON Schema。
// 注意：这里不提供 execute，让工具在前端 clientToolExecution 模式下执行。
const canvasToolsForClient: Record<string, any> = Object.fromEntries(
	Object.entries(canvasToolSchemas as Record<string, any>).map(
		([name, def]) => [
			name,
			tool({
				description: def?.description,
				inputSchema: def?.inputSchema,
			}),
		],
	),
);

// 额外的高层画布工具（仅在前端执行），例如智能布局。
const extraCanvasClientTools: Record<string, any> = {
	canvas_smartLayout: tool({
		description:
			"智能整理当前画布布局：全选并自动布局节点，可选聚焦到指定节点。适用于“画布太乱/帮我整理一下”这类指令。",
		inputSchema: z.object({
			focusNodeId: z
				.string()
				.describe("可选：希望重点聚焦的节点 ID")
				.optional(),
		}),
	}),
};

const UpdatePlanSchema = z.object({
	planId: z.string().min(1),
	sessionId: z.string().min(1),
	explanation: z.string().optional(),
	summary: z
		.object({
			strategy: z.string().optional(),
			estimatedTime: z.number().optional(),
			estimatedCost: z.number().optional(),
		})
		.optional(),
	steps: z
		.array(
			z.object({
				id: z.string().min(1),
				name: z.string().min(1),
				description: z.string().min(1),
				status: z.enum(["pending", "in_progress", "completed", "failed"]),
				reasoning: z.string().optional(),
				acceptance: z.array(z.string()).optional(),
			}),
		)
		.min(1),
});

const EmitThinkingSchema = z.object({
	type: z.enum([
		"intent_analysis",
		"planning",
		"reasoning",
		"decision",
		"execution",
		"result",
	]),
	content: z.string().min(1),
	metadata: z.record(z.any()).optional(),
});

function resolveToolsForChat(
	input: ChatStreamRequest,
	c: AppContext,
	userId: string,
	options?: { disableWebSearch?: boolean },
): Record<string, any> | undefined {
	const provided = normalizeProvidedTools((input as any).tools);
	if (provided) return provided;

	// 基础画布工具（始终提供给模型，用于感知/操作画布）
	const baseCanvasTools = {
		...canvasToolsForClient,
		...extraCanvasClientTools,
	};

	// 根据开关决定是否启用 webSearch 工具（与 Nest 版保持一致语义）
	const shouldEnableWebSearch =
		input.enableWebSearch !== false && options?.disableWebSearch !== true;

	if (!shouldEnableWebSearch) {
		return baseCanvasTools;
	}

	// Worker 版 webSearch：使用 Env 中的 WEB_SEARCH_API_KEY / WEB_SEARCH_BASE_URL
	const webSearchTool = {
		webSearch: tool({
			description:
				"联网搜索当前问题相关的最新信息，用于新闻、技术更新、具体数据等需要实时信息的场景；不要用于纯小说创作、分镜脑补等不依赖事实的任务。",
			inputSchema: z.object({
				query: z.string().min(4, "query 太短"),
				maxResults: z.number().min(1).max(8).default(4),
				locale: z.string().default("zh-CN"),
			}),
			// 注意：这里的参数类型让 TypeScript 从 Zod schema 推断，不强行声明，避免与 ai-sdk 类型冲突。
			execute: async (args: {
				query: string;
				maxResults?: number;
				locale?: string;
			}) => {
				const { query, maxResults, locale } = args;
				const apiKey = (c.env as any).WEB_SEARCH_API_KEY as
					| string
					| undefined;
				const baseUrl = (c.env as any).WEB_SEARCH_BASE_URL as
					| string
					| undefined;

				if (!apiKey || !baseUrl) {
					throw new Error(
						"WebSearch 未配置：请在 Worker 环境中设置 WEB_SEARCH_API_KEY 与 WEB_SEARCH_BASE_URL",
					);
				}

				const trimmedQuery = (query || "").trim();
				if (!trimmedQuery) {
					throw new Error("搜索 query 不能为空");
				}

				const url = baseUrl.replace(/\/+$/, "");
				const payload = {
					query: trimmedQuery,
					max_results: Math.min(Math.max(maxResults ?? 4, 1), 8),
					search_lang: locale || "zh-CN",
				};

				const resp = await fetchWithHttpDebugLog(
					c,
					url,
					{
						method: "POST",
						headers: {
							Authorization: `Bearer ${apiKey}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify(payload),
					},
					{ tag: "websearch" },
				);

				if (!resp.ok) {
					let details = "";
					try {
						details = await resp.text();
					} catch {
						// ignore
					}
					throw new Error(
						`WebSearch 请求失败：${resp.status} ${resp.statusText}${
							details ? ` - ${details.slice(0, 200)}` : ""
						}`,
					);
				}

				let data: any = null;
				try {
					data = await resp.json();
				} catch {
					data = null;
				}

				const items = Array.isArray(data?.results) ? data.results : [];
				return items.map((item: any) => ({
					title: String(item?.title || "").slice(0, 200),
					url: String(item?.url || item?.link || ""),
					snippet: String(item?.content || item?.snippet || "").slice(
						0,
						600,
					),
				}));
			},
		}),
	};

	const bananaSearchTool = {
		banana_ai_search: tool({
			description:
				"使用 Cloudflare AI Search 检索 Nano Banana 提示词案例，返回最相关片段，用于写图像/编辑提示词。",
			inputSchema: z.object({
				query: z.string().min(2, "query 过短"),
				topK: z.number().int().min(1).max(8).default(4).optional(),
			}),
			execute: async (args: { query: string; topK?: number }) => {
				const binding = (c.env as any)?.AI;
				if (!binding || typeof binding.autorag !== "function") {
					throw new Error("AI Search 未配置：缺少 AI binding");
				}
				const rag = binding.autorag("square-glade-783b");
				const res = await rag.aiSearch({
					query: args.query,
					topK: args.topK ?? 4,
				});
				return res;
			},
		}),
	};

	// 智能助手相关工具：由模型主动维护计划与思考过程
	const enableThinking = input.enableThinking !== false;
	const intelligent = input.intelligentMode === true;

	const intelligentTools: Record<string, any> = {};

	if (enableThinking) {
		intelligentTools.ai_emit_thinking = tool({
			description:
				"输出一条结构化的思考事件，用于在侧边栏展示你的推理过程，例如意图分析、规划、决策或执行结果。",
			inputSchema: EmitThinkingSchema,
			execute: async (args: {
				type: string;
				content: string;
				metadata?: Record<string, any>;
			}) => {
				const now = new Date();
				const event = {
					id: args.metadata?.id || `thinking_${now.getTime()}`,
					sessionId:
						typeof args.metadata?.sessionId === "string"
							? args.metadata.sessionId
							: (typeof input.sessionId === "string" &&
									input.sessionId.trim()) ||
								"default",
					type: args.type as any,
					timestamp: now,
					content: args.content,
					metadata: args.metadata,
				};

				publishToolEvent(userId, {
					type: "tool-result",
					toolCallId: event.id,
					toolName: "ai.thinking.process",
					output: event,
				});

				return { ok: true };
			},
		});
	}

	if (intelligent) {
		intelligentTools.ai_update_plan = tool({
			description:
				"更新当前会话的执行计划。steps 中应列出清晰的多步骤行动及其状态，用于在侧边栏展示可执行计划。",
			inputSchema: UpdatePlanSchema,
			execute: async (args: any) => {
				const nowIso = new Date().toISOString();
				const planId =
					typeof args.planId === "string" && args.planId.trim()
						? args.planId.trim()
						: `plan_${Date.now()}`;
				const sessionId =
					typeof args.sessionId === "string" && args.sessionId.trim()
						? args.sessionId.trim()
						: (typeof input.sessionId === "string" &&
								input.sessionId.trim()) ||
							"default";

				const payload = {
					planId,
					sessionId,
					explanation:
						typeof args.explanation === "string"
							? args.explanation
							: undefined,
					summary:
						args.summary && typeof args.summary === "object"
							? {
									strategy: args.summary.strategy,
									estimatedTime: args.summary.estimatedTime,
									estimatedCost: args.summary.estimatedCost,
								}
							: undefined,
					steps: Array.isArray(args.steps)
						? args.steps.map((step: any) => ({
								id: String(step.id || ""),
								name: String(step.name || ""),
								description: String(step.description || ""),
								status:
									step.status === "completed" ||
									step.status === "in_progress" ||
									step.status === "failed"
										? step.status
										: "pending",
								reasoning:
									typeof step.reasoning === "string"
										? step.reasoning
										: undefined,
								acceptance: Array.isArray(step.acceptance)
									? step.acceptance.map((v: any) => String(v))
									: undefined,
							}))
						: [],
					updatedAt: nowIso,
				};

				publishToolEvent(userId, {
					type: "tool-result",
					toolCallId: planId,
					toolName: "ai.plan.update",
					output: payload,
				});

				return { ok: true };
			},
		});
	}

	// 仅暴露 image / composeVideo 相关操作；其他工具保持可见但模型需遵守约束
	return {
		...baseCanvasTools,
		...webSearchTool,
		...bananaSearchTool,
		...intelligentTools,
	};
}

function emitSimpleIntelligentEvents(
	c: AppContext,
	userId: string,
	input: ChatStreamRequest,
	lastUserText?: string,
) {
	const intelligent = input.intelligentMode === true;
	const enableThinking = input.enableThinking !== false;
	if (!intelligent && !enableThinking) return;

	const sessionId =
		(typeof input.sessionId === "string" && input.sessionId.trim()) ||
		"default";

	const now = new Date();
	const nowIso = now.toISOString();
	const baseId = `${sessionId}_${now.getTime()}`;

	if (enableThinking) {
		const thinkingEvent = {
			id: `thinking_${baseId}`,
			sessionId,
			type: "intent_analysis" as const,
			timestamp: now,
			content:
				lastUserText && lastUserText.trim().length
					? `正在分析你的意图：「${lastUserText.trim()}」`
					: "正在分析你的意图与当前画布状态。",
			metadata: {
				confidence: 0.6,
				context: {
					hasCanvasContext: !!input.context,
					model: input.model,
				},
			},
		};

		publishToolEvent(userId, {
			type: "tool-result",
			toolCallId: `thinking_${baseId}`,
			toolName: "ai.thinking.process",
			output: thinkingEvent,
		});
	}

	if (!intelligent) return;

	const summary =
		input.context && typeof input.context === "object"
			? (input.context as any).summary || null
			: null;
	const nodeCount =
		typeof summary?.nodeCount === "number"
			? summary.nodeCount
			: Array.isArray((input.context as any)?.nodes)
				? ((input.context as any).nodes as any[]).length
				: undefined;

	const planId = `plan_${baseId}`;

	const steps = [
		{
			id: `${planId}_1`,
			name: "理解意图与当前画布",
			description: "阅读本轮指令并结合当前画布节点/连接情况，确认目标。",
			status: "in_progress" as const,
			reasoning:
				"优先搞清楚你想做什么，以及画布上已经有哪些节点和素材。",
			acceptance: [
				"能用一句话复述你的需求",
				"知道画布上至少有哪些关键节点",
			],
		},
		{
			id: `${planId}_2`,
			name: "规划需要的画布操作",
			description:
				"决定是创建新节点、修改现有节点，还是整理布局/执行工作流。",
			status: "pending" as const,
			reasoning:
				"根据需求选择最少但最有价值的画布操作，避免无谓改动。",
			acceptance: [
				"列出 2–4 个具体操作",
				"每个操作都能说明价值",
			],
		},
		{
			id: `${planId}_3`,
			name: "执行并回显结果",
			description:
				"逐步执行选定的画布操作，并在对话中解释做了什么以及如何继续。",
			status: "pending" as const,
			reasoning:
				"让每一步操作都有反馈，确保你始终知道画布发生了什么变化。",
			acceptance: [
				"画布状态与计划一致",
				"你知道接下来还能让助手做什么",
			],
		},
	];

	const explanationParts: string[] = [];
	if (lastUserText && lastUserText.trim().length) {
		explanationParts.push(`用户意图：${lastUserText.trim()}`);
	}
	if (typeof nodeCount === "number") {
		explanationParts.push(`当前画布节点数：${nodeCount}`);
	}
	explanationParts.push(
		"将按照「理解 → 规划 → 执行」三步节奏协助你操作画布。",
	);

	const planPayload = {
		planId,
		sessionId,
		explanation: explanationParts.join("；"),
		summary: {
			strategy: "轻量智能助手：先读懂你的意图，再建议或执行少量高价值操作。",
			estimatedTime: 1,
			estimatedCost: 0,
		},
		steps: steps.map((step) => ({
			id: step.id,
			name: step.name,
			description: step.description,
			status: step.status,
			reasoning: step.reasoning,
			acceptance: step.acceptance,
		})),
		updatedAt: nowIso,
	};

	publishToolEvent(userId, {
		type: "tool-result",
		toolCallId: planId,
		toolName: "ai.plan.update",
		output: planPayload,
	});
}

function composeSystemPromptFromContext(
	context?: any,
	latestUserText?: string,
): string {
	const pieces: string[] = [WORKER_SYSTEM_PROMPT];

	if (context) {
		const summary = context.summary ? JSON.stringify(context.summary) : "";

		if (summary) {
			pieces.push(`当前画布概要：${summary}`);
		}
		pieces.push(
			"⚠️你已经获得上面的画布概要/节点列表，它们视为真实可见的画布状态；不要再声称自己无法看到画布或无法访问屏幕。",
		);

		if (Array.isArray(context.nodes) && context.nodes.length) {
			const preview = context.nodes.slice(0, 8).map((node: any, index: number) => {
				const label = node.label || node.data?.label || node.id;
				const kind = node.kind || node.data?.kind;
				return `${index + 1}. ${label} (${kind || node.type || "unknown"})`;
			});
			pieces.push(`节点示例：\n${preview.join("\n")}`);
		}

		if (Array.isArray(context.edges) && context.edges.length) {
			const preview = context.edges
				.slice(0, 6)
				.map((edge: any) => `${edge.source} -> ${edge.target}`);
			pieces.push(`连接示例：${preview.join(", ")}`);
		}

		if (Array.isArray(context.characters) && context.characters.length) {
			const preview = context.characters
				.slice(0, 6)
				.map((character: any, index: number) => {
					const name =
						character.label || character.username || character.nodeId;
					const username = character.username ? ` (@${character.username})` : "";
					const desc = character.description ? ` - ${character.description}` : "";
					return `${index + 1}. ${name}${username}${desc}`;
				});
			pieces.push(`角色资料：\n${preview.join("\n")}`);
		}

		if (Array.isArray(context.videoBindings) && context.videoBindings.length) {
			const preview = context.videoBindings
				.slice(0, 4)
				.map((binding: any, index: number) => {
					const chars =
						binding.characters
							?.map(
								(char: any) =>
									char.label || char.username || char.nodeId,
							)
							.join(", ") || "无角色引用";
					const promptSnippet = binding.promptPreview
						? ` | prompt: ${binding.promptPreview}`
						: "";
					const remix = binding.remixSourceLabel
						? ` | remix自: ${binding.remixSourceLabel}`
						: "";
					return `${index + 1}. ${
						binding.label || binding.nodeId
					} -> 角色: ${chars}${remix}${promptSnippet}`;
				});
			pieces.push(`镜头延续上下文：\n${preview.join("\n")}`);
		}

		if (
			(!context.videoBindings ||
				!Array.isArray(context.videoBindings) ||
				!context.videoBindings.length) &&
			Array.isArray(context.nodes) &&
			context.nodes.some((node: any) => node.kind === "image")
		) {
			pieces.push(
				"提示：当前仅存在图像节点供画风参考，除非用户要求剧情延续，否则不要强行复用图像中的人物或故事。",
			);
		}

		if (Array.isArray(context.timeline) && context.timeline.length) {
			const summaryTimeline = context.timeline
				.slice(0, 5)
				.map((entry: any, index: number) => {
					const chars = entry.characters
						?.map(
							(c: any) =>
								c.label || c.username,
						)
						?.join(", ");
					const charText = chars ? ` | 角色: ${chars}` : "";
					return `${index + 1}. ${
						entry.label || entry.nodeId
					} (${entry.kind || "node"} - ${
						entry.status || "unknown"
					})${charText}`;
				});
			if (summaryTimeline.length) {
				pieces.push(`镜头时间线：\n${summaryTimeline.join("\n")}`);
			}
		}

		if (Array.isArray(context.pendingNodes) && context.pendingNodes.length) {
			const pendings = context.pendingNodes
				.map(
					(node: any) =>
						`${node.label || node.nodeId}(${node.kind || "node"}) -> ${
							node.status
						}`,
				)
				.join("；");
			pieces.push(`待处理节点：${pendings}`);
		}

		if (context.currentRun) {
			pieces.push(
				`当前有节点正在运行：${
					context.currentRun.label || context.currentRun.nodeId
				}（状态 ${context.currentRun.status}，进度 ${
					context.currentRun.progress ?? 0
				}%）。请优先关注其结果或异常，再决定是否继续新的生成。`,
			);
		}

		const existingVideos = context.nodes
			?.filter(
				(node: any) =>
					node.kind === "composeVideo" || node.kind === "video",
			)
			?.slice(0, 3)
			?.map(
				(node: any) =>
					`${node.label || node.id} (${node.status || "unknown"})`,
			);
		if (existingVideos && existingVideos.length) {
			pieces.push(
				`已有视频节点：${existingVideos.join(
					"、",
				)}。若用户要求续写，请读取这些节点的 prompt 与角色后再创作下一镜。`,
			);
		}

		const existingImages = context.nodes
			?.filter(
				(node: any) =>
					node.kind === "image" || node.kind === "textToImage",
			)
			?.slice(0, 3)
			?.map((node: any) => node.label || node.id);
		if (existingImages && existingImages.length) {
			pieces.push(
				`参考图像：${existingImages.join(
					"、",
				)}。若无特别说明，请沿用这些节点的画风/色彩。`,
			);
		}
	}

	if (latestUserText && typeof latestUserText === "string" && latestUserText.trim()) {
		const samples = matchPromptSamples(latestUserText, 3);
		if (samples.length) {
			const formatted = samples.map(formatPromptSample).join("\n\n");
			pieces.push(
				`提示词案例匹配（根据用户意图自动挑选）：\n${formatted}`,
			);
		}
	}

	return pieces.join("\n\n");
}

function inferProvider(input: ChatStreamRequest): ChatProvider {
	const raw = (input.provider || "").toLowerCase();
	if (raw === "openai" || raw === "anthropic" || raw === "google") {
		return raw as ChatProvider;
	}
	const model = (input.model || "").toLowerCase();
	if (model.includes("claude") || model.includes("glm")) return "anthropic";
	if (
		model.includes("gemini") ||
		model.includes("google") ||
		model.includes("nano-banana")
	) {
		return "google";
	}
	return "openai";
}

function normalizeOpenAIBaseUrl(
	input?: string | null,
): string | undefined {
	const envBase = input?.trim();
	if (!envBase) return undefined;
	let normalized = envBase.replace(/\/+$/, "");
	if (!/\/v\d+(?:\/|$)/i.test(normalized)) {
		normalized = `${normalized}/v1`;
	}
	return normalized;
}

function normalizeBaseUrl(raw: string | null | undefined): string {
	const val = (raw || "").trim();
	if (!val) return "";
	return val.replace(/\/+$/, "");
}

function expandProxyVendorKeys(vendor: string): string[] {
	const v = vendor.toLowerCase();
	const keys = [v];
	// 兼容历史配置：面板里使用 "sora" 作为代理目标，但任务里使用 "sora2api"
	if (v === "sora2api") {
		keys.push("sora");
	}
	return Array.from(new Set(keys));
}

function normalizeChatBaseUrl(
	provider: ChatProvider,
	baseUrl?: string | null,
): string | undefined {
	const trimmed = baseUrl?.trim();
	if (!trimmed || trimmed.length === 0) {
		if (provider === "google") {
			return "https://generativelanguage.googleapis.com/v1beta";
		}
		return undefined;
	}

	let normalized = trimmed.replace(/\/+$/, "");

	if (provider === "anthropic" || provider === "openai") {
		const hasVersion = /\/v\d+($|\/)/i.test(normalized);
		if (!hasVersion) normalized = `${normalized}/v1`;
	}

	return normalized;
}

export function buildChatModel(
	provider: ChatProvider,
	model: string,
	apiKey: string,
	baseUrl?: string | null,
) {
	const normalizedModel = model;
	const normalizedBaseUrl = normalizeChatBaseUrl(provider, baseUrl);

	const extraHeaders =
		provider === "anthropic"
			? {
					Authorization: `Bearer ${apiKey}`,
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
				}
			: undefined;

	const options = normalizedBaseUrl
		? ({
				apiKey,
				baseURL: normalizedBaseUrl,
				...(extraHeaders ? { headers: extraHeaders } : {}),
			} satisfies Parameters<typeof createOpenAI>[0])
		: ({
				apiKey,
				...(extraHeaders ? { headers: extraHeaders } : {}),
			} satisfies Parameters<typeof createOpenAI>[0]);

	switch (provider) {
		case "openai": {
			const client = createOpenAI(options);
			return client(normalizedModel);
		}
		case "anthropic": {
			const client = createAnthropic(options);
			return client(normalizedModel);
		}
		case "google":
		default: {
			const client = createGoogleGenerativeAI(options);
			return client(normalizedModel);
		}
	}
}

async function resolveProxyForVendor(
	c: AppContext,
	userId: string,
	vendor: string,
): Promise<ProxyProviderRow | null> {
	const keys = expandProxyVendorKeys(vendor);

	// 1) Direct match on vendor (legacy)
	const direct: ProxyProviderRow[] = [];
	for (const key of keys) {
		const res = await c.env.DB.prepare(
			`SELECT * FROM proxy_providers
     WHERE owner_id = ? AND vendor = ? AND enabled = 1`,
		)
			.bind(userId, key)
			.all<ProxyProviderRow>();
		if (res.results?.length) {
			direct.push(...res.results);
		}
	}

	// 2) Match via enabled_vendors JSON (recommended)
	const viaEnabled: ProxyProviderRow[] = [];
	for (const key of keys) {
		const res = await c.env.DB.prepare(
			`SELECT * FROM proxy_providers
     WHERE owner_id = ? AND enabled = 1
       AND enabled_vendors IS NOT NULL
       AND enabled_vendors LIKE ?`,
		)
			.bind(userId, `%"${key}"%`)
			.all<ProxyProviderRow>();
		if (res.results?.length) {
			viaEnabled.push(...res.results);
		}
	}

	const all: ProxyProviderRow[] = [];
	for (const row of direct) {
		all.push(row);
	}
	for (const row of viaEnabled) {
		if (!all.find((r) => r.id === row.id)) {
			all.push(row);
		}
	}
	if (!all.length) return null;

	// Prefer GRSAI proxy when available
	const preferred =
		all.find((row) => row.vendor === "grsai") ||
		all[0];
	return preferred;
}

async function resolveVendorContextForChat(
	c: AppContext,
	userId: string,
	vendor: ProviderVendor,
): Promise<VendorContext> {
	const v = vendor.toLowerCase();

	// 1) User-level proxy config (proxy_providers + enabled_vendors)
	const proxy = await resolveProxyForVendor(c, userId, v);
	if (proxy && proxy.enabled === 1) {
		const baseUrl = normalizeBaseUrl(proxy.base_url);
		const apiKey = (proxy.api_key || "").trim();
		if (!baseUrl || !apiKey) {
			throw new AppError("Proxy for vendor is misconfigured", {
				status: 400,
				code: "proxy_misconfigured",
			});
		}
		return { baseUrl, apiKey };
	}

	// 2) model_providers + model_tokens（含跨用户共享 Token）
	const providersRes = await c.env.DB.prepare(
		`SELECT * FROM model_providers WHERE owner_id = ? AND vendor = ? ORDER BY created_at ASC`,
	)
		.bind(userId, v)
		.all<ProviderRow>();
	const providers = providersRes.results || [];

	let provider: ProviderRow | null = providers[0] ?? null;
	let sharedTokenProvider: ProviderRow | null = null;
	let apiKey = "";

	if (requiresApiKeyForVendorChat(v)) {
		let token: TokenRow | null = null;

		// 2.1 当前用户自己的 Token 优先
		if (provider) {
			const ownedRows = await c.env.DB.prepare(
				`SELECT * FROM model_tokens
         WHERE provider_id = ? AND user_id = ? AND enabled = 1
         ORDER BY created_at ASC LIMIT 1`,
			)
				.bind(provider.id, userId)
				.all<TokenRow>();
			token = (ownedRows.results || [])[0] ?? null;

			// 2.2 该 Provider 下的共享 Token（任意用户）
			if (!token) {
				const nowIso = new Date().toISOString();
				const sharedRows = await c.env.DB.prepare(
					`SELECT * FROM model_tokens
           WHERE provider_id = ? AND shared = 1 AND enabled = 1
             AND (shared_disabled_until IS NULL OR shared_disabled_until < ?)
           ORDER BY updated_at ASC LIMIT 1`,
				)
					.bind(provider.id, nowIso)
					.all<TokenRow>();
				token = (sharedRows.results || [])[0] ?? null;
			}

			if (token && typeof token.secret_token === "string") {
				apiKey = token.secret_token.trim();
			}
		}

		// 2.3 仍未拿到，则从任意用户的共享 Token 中为该 vendor 选择一个（全局共享池）
		if (!apiKey) {
			const shared = await findSharedTokenForVendorChat(c, v);
			if (shared && typeof shared.token.secret_token === "string") {
				apiKey = shared.token.secret_token.trim();
				sharedTokenProvider = shared.provider;
			}
		}

		if (!apiKey) {
			throw new AppError(`No API key configured for vendor ${v}`, {
				status: 400,
				code: "api_key_missing",
			});
		}
	}

	// 2.4 若用户自己没有 Provider，但通过共享 Token 找到了 Provider，则使用该 Provider
	if (!provider && sharedTokenProvider) {
		provider = sharedTokenProvider;
	}

	if (!provider) {
		throw new AppError(`No provider configured for vendor ${v}`, {
			status: 400,
			code: "provider_not_configured",
		});
	}

	// 2.5 解析 baseUrl：优先 Provider.base_url，其次 shared_base_url
	const baseUrl = normalizeBaseUrl(
		provider.base_url ||
			(await resolveSharedBaseUrlForChat(c, v)) ||
			"",
	);

	if (!baseUrl) {
		throw new AppError(`No base URL configured for vendor ${v}`, {
			status: 400,
			code: "base_url_missing",
		});
	}

	return { baseUrl, apiKey };
}

type SharedTokenWithProviderChat = {
	token: TokenRow;
	provider: ProviderRow;
};

async function resolveSharedBaseUrlForChat(
	c: AppContext,
	vendor: string,
): Promise<string | null> {
	const row = await c.env.DB.prepare(
		`SELECT base_url FROM model_providers
     WHERE vendor = ? AND shared_base_url = 1 AND base_url IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
	)
		.bind(vendor)
		.first<{ base_url: string | null }>();
	return row?.base_url ?? null;
}

async function findSharedTokenForVendorChat(
	c: AppContext,
	vendor: string,
): Promise<SharedTokenWithProviderChat | null> {
	const nowIso = new Date().toISOString();
	const row = await c.env.DB.prepare(
		`SELECT
       t.id,
       t.provider_id,
       t.label,
       t.secret_token,
       t.user_agent,
       t.user_id,
       t.enabled,
       t.shared,
       t.shared_failure_count,
       t.shared_last_failure_at,
       t.shared_disabled_until,
       t.created_at,
       t.updated_at,
       p.id   AS p_id,
       p.name AS p_name,
       p.vendor AS p_vendor,
       p.base_url AS p_base_url,
       p.shared_base_url AS p_shared_base_url,
       p.owner_id AS p_owner_id,
       p.created_at AS p_created_at,
       p.updated_at AS p_updated_at
     FROM model_tokens t
     JOIN model_providers p ON p.id = t.provider_id
     WHERE t.shared = 1
       AND t.enabled = 1
       AND p.vendor = ?
       AND (t.shared_disabled_until IS NULL OR t.shared_disabled_until < ?)
     ORDER BY t.updated_at ASC
     LIMIT 1`,
	)
		.bind(vendor, nowIso)
		.first<any>();

	if (!row) return null;

	const token: TokenRow = {
		id: row.id,
		provider_id: row.provider_id,
		label: row.label,
		secret_token: row.secret_token,
		user_agent: row.user_agent,
		user_id: row.user_id,
		enabled: row.enabled,
		shared: row.shared,
		shared_failure_count: row.shared_failure_count,
		shared_last_failure_at: row.shared_last_failure_at,
		shared_disabled_until: row.shared_disabled_until,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};

	const provider: ProviderRow = {
		id: row.p_id,
		name: row.p_name,
		vendor: row.p_vendor,
		base_url: row.p_base_url,
		shared_base_url: row.p_shared_base_url,
		owner_id: row.p_owner_id,
		created_at: row.p_created_at,
		updated_at: row.p_updated_at,
	};

	return { token, provider };
}

function requiresApiKeyForVendorChat(vendor: string): boolean {
	const v = vendor.toLowerCase();
	return v === "openai" || v === "anthropic" || v === "gemini";
}

function summarizeContextForIntent(context?: any): string {
	if (!context || typeof context !== "object") return "";
	const parts: string[] = [];
	if (Array.isArray(context.nodes)) {
		parts.push(`nodes=${context.nodes.length}`);
	}
	if (Array.isArray(context.edges)) {
		parts.push(`edges=${context.edges.length}`);
	}
	if (Array.isArray(context.characters) && context.characters.length) {
		parts.push(`characters=${context.characters.length}`);
	}
	if (Array.isArray(context.videoBindings) && context.videoBindings.length) {
		parts.push(`videoBindings=${context.videoBindings.length}`);
	}
	if (context.currentRun?.label) {
		parts.push(`running=${context.currentRun.label}`);
	}
	return parts.join(" | ");
}

function isImageIntent(intent: IntentOutput | null, userText?: string): boolean {
	if (intent?.intent) {
		const lower = intent.intent.toLowerCase();
		if (lower.includes("image") || lower.includes("图") || lower.includes("画")) {
			return true;
		}
	}
	if (Array.isArray(intent?.goals)) {
		const joined = intent.goals.join(" ").toLowerCase();
		if (joined.includes("image") || joined.includes("图") || joined.includes("画")) {
			return true;
		}
	}
	if (userText) {
		const lower = userText.toLowerCase();
		if (
			lower.includes("image") ||
			lower.includes("picture") ||
			lower.includes("photo") ||
			lower.includes("图")
		) {
			return true;
		}
	}
	return false;
}

function pickRouterModelName(
	provider: ChatProvider,
	requestedModel: string,
): string {
	// 优先用更强的 gpt-5.2，当 provider 为 openai 时可直接覆盖。
	if (provider === "openai") return "gpt-5.2";
	return requestedModel;
}

export function pickPlannerModelName(
	provider: ChatProvider,
	requestedModel: string,
): string {
	// 规划也偏好 gpt-5.2（开放场景），否则沿用用户指定模型。
	if (provider === "openai") return "gpt-5.2";
	return requestedModel;
}

function chooseTemperature(intent?: IntentOutput | null): number | undefined {
	if (!intent?.priority) return undefined;
	switch (intent.priority) {
		case "high":
			return 0.85;
		case "medium":
			return 0.7;
		case "low":
		default:
			return 0.5;
	}
}

async function inferIntentAndPlan(
	provider: ChatProvider,
	modelName: string,
	apiKey: string,
	baseUrl: string | null | undefined,
	lastUserText: string | undefined,
	context: any,
) {
	const userText = lastUserText?.trim() || "（无用户输入）";
	const ctxSummary = summarizeContextForIntent(context);

	let intent: IntentOutput | null = null;
	let plan: PlannerOutput | null = null;

	try {
		const intentModel = buildChatModel(
			provider,
			pickRouterModelName(provider, modelName),
			apiKey,
			baseUrl || undefined,
		);
		const intentPrompt = `你是 TapCanvas 的意图路由器，负责读懂用户要做的事、关键目标和验收条件，并判断是否允许联网搜索。仅输出 JSON，遵循给定 schema，不要多余文本。
上下文：${ctxSummary || "无"}。`;
		const intentRes = await generateText({
			model: intentModel,
			system: intentPrompt,
			messages: [
				{ role: "user", content: userText },
			],
			output: zodSchema(IntentSchema),
		});
		intent = intentRes.object as IntentOutput;
	} catch (error) {
		console.warn("[ai/chat] intent routing failed", {
			error:
				error && typeof error === "object" && "message" in error
					? (error as any).message
					: String(error),
		});
	}

	try {
		const plannerModel = buildChatModel(
			provider,
			pickPlannerModelName(provider, modelName),
			apiKey,
			baseUrl || undefined,
		);
		const plannerPrompt = `你是 TapCanvas 的 Planner，基于意图输出可执行计划（3-6 步），每步可映射到画布工具调用或思考动作。
只输出 JSON，遵循 schema。保持动作最小化但能达成目标。`;
		const plannerMessages = [
			{
				role: "system" as const,
				content: plannerPrompt,
			},
			{
				role: "user" as const,
				content: `用户意图：${intent ? JSON.stringify(intent) : userText}
画布摘要：${ctxSummary || "无"}`,
			},
		];
		const planRes = await generateText({
			model: plannerModel,
			messages: plannerMessages,
			output: zodSchema(PlannerOutputSchema),
		});
		plan = planRes.object as PlannerOutput;
	} catch (error) {
		console.warn("[ai/chat] planner generation failed", {
			error:
				error && typeof error === "object" && "message" in error
					? (error as any).message
					: String(error),
		});
	}

	return { intent, plan };
}

async function buildQaGuardrails(
	provider: ChatProvider,
	modelName: string,
	apiKey: string,
	baseUrl: string | null | undefined,
	intent: IntentOutput | null,
	plan: PlannerOutput | null,
) {
	if (!intent && !plan) return null;
	try {
		const qaModel = buildChatModel(
			provider,
			pickPlannerModelName(provider, modelName),
			apiKey,
			baseUrl || undefined,
		);
		const prompt = `你是 TapCanvas 的 QA/验收 Agent，基于意图与计划生成验收要点、检查点和失败处理建议。
仅输出 JSON，遵循 schema。确保验收与用户目标对齐，可适当提出超额完成建议。`;
		const messages = [
			{
				role: "system" as const,
				content: prompt,
			},
			{
				role: "user" as const,
				content: `意图：${intent ? JSON.stringify(intent) : "未知"}
计划：${plan ? JSON.stringify(plan) : "暂无计划"}`,
			},
		];
		const res = await generateText({
			model: qaModel,
			messages,
			output: zodSchema(QaGuardrailSchema),
		});
		return res.object as QaGuardrailOutput;
	} catch (error) {
		console.warn("[ai/chat] QA guardrails failed", {
			error:
				error && typeof error === "object" && "message" in error
					? (error as any).message
					: String(error),
		});
		return null;
	}
}

async function persistChatHistoryFromClientMessages(
	c: AppContext,
	sessionId: string,
	messages: any[],
) {
	const nowIso = new Date().toISOString();
	try {
		const items = Array.isArray(messages)
			? (messages as ChatMessageDto[])
			: [];

		// 先清空该会话已有记录，再用当前快照重建，保证顺序与内容一致。
		await c.env.DB.prepare(
			`DELETE FROM chat_messages WHERE session_id = ?`,
		)
			.bind(sessionId)
			.run();

		for (const msg of items) {
			if (!msg || typeof msg.role !== "string") continue;
			const role = (msg.role || "user") as ChatRole;
			let content = "";
			if (typeof (msg as any).content === "string") {
				content = (msg as any).content;
			} else if (Array.isArray((msg as any).parts)) {
				const parts = (msg as any).parts as any[];
				const texts: string[] = [];
				for (const part of parts) {
					if (part && typeof part.text === "string") {
						texts.push(part.text);
					}
				}
				content = texts.join("");
			}
			const raw = JSON.stringify(msg);
			const id = crypto.randomUUID();

			await c.env.DB.prepare(
				`INSERT INTO chat_messages
       (id, session_id, role, content, raw, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
			)
				.bind(
					id,
					sessionId,
					role,
					content.trim() || null,
					raw,
					nowIso,
				)
				.run();
		}
	} catch (err) {
		console.warn("[ai/chat] persist chat history failed", {
			sessionId,
			error:
				err && typeof err === "object" && "message" in err
					? (err as any).message
					: String(err),
		});
	}
}

export async function listChatSessions(
	c: AppContext,
	userId: string,
) {
	const rows = await c.env.DB.prepare(
		`SELECT
       s.id,
       s.session_id,
       s.title,
       s.model,
       s.provider,
       s.created_at,
       s.updated_at,
       (
         SELECT m.content
         FROM chat_messages m
         WHERE m.session_id = s.id
         ORDER BY m.created_at DESC
         LIMIT 1
       ) AS last_content
     FROM chat_sessions s
     WHERE s.user_id = ?
     ORDER BY s.updated_at DESC
     LIMIT 50`,
	)
		.bind(userId)
		.all<ChatSessionRow & { last_content: string | null }>();

	const sessions = (rows.results || []).map((row, index) => ({
		id: row.session_id,
		title: row.title || `会话 ${index + 1}`,
		model: row.model || null,
		provider: row.provider || null,
		lastMessage: row.last_content || null,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	}));

	return { sessions };
}

export async function getChatHistory(
	c: AppContext,
	userId: string,
	sessionKey: string,
) {
	const trimmed = (sessionKey || "").trim();
	if (!trimmed) {
		throw new AppError("sessionId is required", {
			status: 400,
			code: "session_id_required",
		});
	}

	const session = await c.env.DB.prepare(
		`SELECT * FROM chat_sessions
     WHERE user_id = ? AND session_id = ?
     LIMIT 1`,
	)
		.bind(userId, trimmed)
		.first<ChatSessionRow>();

	if (!session) {
		return {
			session: null,
			messages: [],
		};
	}

	const rows = await c.env.DB.prepare(
		`SELECT * FROM chat_messages
     WHERE session_id = ?
     ORDER BY created_at ASC`,
	)
		.bind(session.id)
		.all<ChatMessageRow>();

	const messages = (rows.results || []).map((row) => {
		let payload: any = null;
		if (row.raw) {
			try {
				payload = JSON.parse(row.raw);
			} catch {
				payload = null;
			}
		}

		const role =
			(typeof payload?.role === "string"
				? payload.role
				: row.role || "user") as ChatRole;
		const content =
			typeof payload?.content === "string"
				? payload.content
				: row.content || null;
		const parts = Array.isArray(payload?.parts)
			? (payload.parts as any[])
			: undefined;
		const metadata =
			payload && typeof payload.metadata === "object"
				? (payload.metadata as Record<string, any>)
				: undefined;

		return {
			id: row.id,
			role,
			content,
			parts,
			metadata,
			createdAt: row.created_at,
		};
	});

	return {
		session: {
			id: session.session_id,
			title: session.title || null,
			model: session.model || null,
			provider: session.provider || null,
			createdAt: session.created_at,
			updatedAt: session.updated_at,
		},
		messages,
	};
}

export async function updateChatSessionTitle(
	c: AppContext,
	userId: string,
	sessionKey: string,
	titleRaw: string,
) {
	const key = (sessionKey || "").trim();
	if (!key) {
		throw new AppError("sessionId is required", {
			status: 400,
			code: "session_id_required",
		});
	}
	const title = (titleRaw || "").trim();
	if (!title) {
		throw new AppError("title is required", {
			status: 400,
			code: "title_required",
		});
	}

	const session = await c.env.DB.prepare(
		`SELECT * FROM chat_sessions
     WHERE user_id = ? AND session_id = ?
     LIMIT 1`,
	)
		.bind(userId, key)
		.first<ChatSessionRow>();

	if (!session) {
		throw new AppError("Chat session not found", {
			status: 404,
			code: "session_not_found",
		});
	}

	const nowIso = new Date().toISOString();
	await c.env.DB.prepare(
		`UPDATE chat_sessions
     SET title = ?, updated_at = ?
     WHERE id = ?`,
	)
		.bind(title, nowIso, session.id)
		.run();

	return {
		id: session.session_id,
		title,
		model: session.model || null,
		provider: session.provider || null,
		lastMessage: null as string | null,
		createdAt: session.created_at,
		updatedAt: nowIso,
	};
}

export async function deleteChatSession(
	c: AppContext,
	userId: string,
	sessionKey: string,
) {
	const key = (sessionKey || "").trim();
	if (!key) {
		throw new AppError("sessionId is required", {
			status: 400,
			code: "session_id_required",
		});
	}

	const session = await c.env.DB.prepare(
		`SELECT * FROM chat_sessions
     WHERE user_id = ? AND session_id = ?
     LIMIT 1`,
	)
		.bind(userId, key)
		.first<ChatSessionRow>();

	if (!session) {
		// 幂等删除：会话不存在时直接返回成功
		return { success: true };
	}

	await c.env.DB.prepare(
		`DELETE FROM chat_messages WHERE session_id = ?`,
	)
		.bind(session.id)
		.run();
	await c.env.DB.prepare(
		`DELETE FROM chat_sessions WHERE id = ?`,
	)
		.bind(session.id)
		.run();

	return { success: true };
}

export async function handleChatStream(
	c: AppContext,
	userId: string,
): Promise<Response> {
	const raw = (await c.req.json().catch(() => null)) as unknown;
	if (!raw || typeof raw !== "object") {
		throw new AppError("Invalid chat request body", {
			status: 400,
			code: "invalid_chat_request",
		});
	}

	const parsed = ChatStreamRequestSchema.safeParse(raw);
	if (!parsed.success) {
		throw new AppError("Invalid chat request body", {
			status: 400,
			code: "invalid_chat_request",
			details: parsed.error.issues,
		});
	}

	const input = parsed.data;

	const provider = inferProvider(input);
	const vendorForDb: ProviderVendor =
		provider === "google" ? "gemini" : provider;

	const explicitApiKey = (input.apiKey || "").trim();
	const explicitBaseUrl = (input.baseUrl || "").trim();

	let baseUrl = explicitBaseUrl;
	let apiKey = explicitApiKey;

	if (!apiKey) {
		const ctx = await resolveVendorContextForChat(
			c,
			userId,
			vendorForDb,
		);
		baseUrl = baseUrl || ctx.baseUrl;
		apiKey = ctx.apiKey.trim();
	}

	if (!apiKey) {
		throw new AppError("API key missing for provider", {
			status: 400,
			code: "api_key_missing",
		});
	}

	const modelName = input.model;

	// --- Minimal chat session persistence: chat_sessions (no messages yet) ---
	const nowIso = new Date().toISOString();
	let sessionDbId: string | null = null;
	const sessionIdRaw =
		(typeof input.sessionId === "string" && input.sessionId.trim()) ||
		null;
	const sessionKey = sessionIdRaw || "default";

	try {
		const existing = await c.env.DB.prepare(
			`SELECT id FROM chat_sessions WHERE user_id = ? AND session_id = ? LIMIT 1`,
		)
			.bind(userId, sessionKey)
			.first<{ id: string }>();

		if (existing?.id) {
			sessionDbId = existing.id;
			await c.env.DB.prepare(
				`UPDATE chat_sessions
         SET model = ?, provider = ?, updated_at = ?
         WHERE id = ?`,
			)
				.bind(modelName, vendorForDb, nowIso, existing.id)
				.run();
		} else {
			const id = crypto.randomUUID();
			sessionDbId = id;
			await c.env.DB.prepare(
				`INSERT INTO chat_sessions
         (id, user_id, session_id, title, model, provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
				.bind(
					id,
					userId,
					sessionKey,
					null,
					modelName,
					vendorForDb,
					nowIso,
					nowIso,
				)
				.run();
		}
	} catch (err) {
		console.warn("[ai/chat] persist session failed", {
			userId,
			sessionKey,
			error:
				err && typeof err === "object" && "message" in err
					? (err as any).message
					: String(err),
		});
	}

	const lastUserText =
		(Array.isArray(input.messages) && input.messages.length
			? (() => {
					const reversed = [...input.messages].reverse();
					const lastUser = reversed.find(
						(msg: any) => msg && msg.role === "user",
					);
					const target = (lastUser || input.messages[input.messages.length - 1]) as any;
					if (typeof target?.content === "string" && target.content.trim()) {
						return target.content.trim();
					}
					if (Array.isArray(target?.parts)) {
						const texts = (target.parts as any[])
							.map((part) =>
								typeof part?.text === "string" ? part.text : "",
							)
							.filter(Boolean);
						if (texts.length) return texts.join("\n");
					}
					return undefined;
				})()
			: undefined);

	if (!Array.isArray(input.messages) || input.messages.length === 0) {
		throw new AppError("Invalid chat request body: messages is empty", {
			status: 400,
			code: "invalid_chat_request",
		});
	}

	// 在主对话流开始前触发一次轻量级智能事件，用于驱动前端的思考过程与计划面板。
	emitSimpleIntelligentEvents(c, userId, input, lastUserText);

	// 异步将当前会话的完整消息快照写入 chat_messages，
	// 供后续「重新打开会话」时从后端恢复上下文。
	if (sessionDbId && Array.isArray(input.messages) && input.messages.length) {
		const sessionIdForLog = sessionDbId;
		const snapshot = input.messages as any[];
		// 不阻塞主请求，使用 Workers 的后台任务能力
		// eslint-disable-next-line @typescript-eslint/no-floating-promises
		(c.executionCtx as any)?.waitUntil?.(
			persistChatHistoryFromClientMessages(
				c,
				sessionIdForLog,
				snapshot,
			),
		);
	}

	const { intent, plan } = await inferIntentAndPlan(
		provider,
		modelName,
		apiKey,
		baseUrl,
		lastUserText,
		input.context,
	);

	const planId = `auto_plan_${sessionKey}_${Date.now()}`;
	const sessionIdForPlan =
		(typeof input.sessionId === "string" && input.sessionId.trim()) ||
		sessionKey;

	if (plan?.steps?.length) {
		const nowIso = new Date().toISOString();
		publishToolEvent(userId, {
			type: "tool-result",
			toolCallId: planId,
			toolName: "ai.plan.update",
			output: {
				planId,
				sessionId: sessionIdForPlan,
				explanation:
					intent?.goals?.join("；") ||
					intent?.notes ||
					"自动规划：依据用户输入生成的执行计划。",
				summary: {
					strategy: "Planner 自动生成，遇到失败可返工。",
					estimatedTime: plan.steps.length,
					estimatedCost: 0,
				},
				steps: plan.steps.map((step) => ({
					id: step.id,
					name: step.name,
					description: step.description,
					status: "pending" as const,
					reasoning: plan.rationale,
					acceptance: intent?.acceptance,
				})),
				updatedAt: nowIso,
			},
		});
	}

	const intentSummaryParts: string[] = [];
	if (intent?.intent) intentSummaryParts.push(`意图：${intent.intent}`);
	if (intent?.goals?.length) {
		intentSummaryParts.push(`目标：${intent.goals.join("；")}`);
	}
	if (intent?.acceptance?.length) {
		intentSummaryParts.push(`验收：${intent.acceptance.join("；")}`);
	}
	if (intent?.priority) {
		intentSummaryParts.push(`优先级：${intent.priority}`);
	}
	if (plan?.steps?.length) {
		const preview = plan.steps
			.slice(0, 4)
			.map((s, i) => `${i + 1}. ${s.name}`)
			.join("；");
		intentSummaryParts.push(`规划：${preview}`);
	}

	const systemPromptBase = composeSystemPromptFromContext(
		input.context,
		lastUserText,
	);

	// 基于意图/计划/验收生成 guardrails（验收/返工提示）
	const guardrails = await buildQaGuardrails(
		provider,
		modelName,
		apiKey,
		baseUrl,
		intent,
		plan,
	);

	if (guardrails) {
		publishToolEvent(userId, {
			type: "tool-result",
			toolCallId: `${planId}_qa`,
			toolName: "ai.qa.guardrails",
			output: {
				sessionId: sessionIdForPlan,
				planId,
				...guardrails,
			},
		});
	}

	const toolsValue = resolveToolsForChat(input, c, userId, {
		disableWebSearch: intent?.allowSearch === false,
	}) || undefined;

	const uiMessages = normalizeMessagesForModel(input.messages);
	// Convert cleaned UIMessage[] → ModelMessage[] as required by streamText
	const modelMessages = convertToModelMessages(uiMessages as any, {
		tools: toolsValue,
	});

	const providerOptions =
		provider === "openai"
			? {
					openai: {
						store: true,
					},
				}
			: undefined;

	const guardrailParts: string[] = [];
	if (guardrails?.acceptance?.length) {
		guardrailParts.push(`验收：${guardrails.acceptance.join("；")}`);
	}
	if (guardrails?.checkpoints?.length) {
		guardrailParts.push(`检查点：${guardrails.checkpoints.join("；")}`);
	}
	if (guardrails?.failureHandling?.length) {
		guardrailParts.push(`失败处理：${guardrails.failureHandling.join("；")}`);
	}
	if (guardrails?.extras?.length) {
		guardrailParts.push(`超额完成建议：${guardrails.extras.join("；")}`);
	}

	const systemPromptBlocks = [systemPromptBase];
	if (intentSummaryParts.length > 0) {
		systemPromptBlocks.push(`【意图/规划快照】${intentSummaryParts.join(" ｜ ")}`);
	}
	if (guardrailParts.length > 0) {
		systemPromptBlocks.push(`【QA 验收】${guardrailParts.join(" ｜ ")}`);
	}
	if (isImageIntent(intent, lastUserText)) {
		systemPromptBlocks.push(`【Image Agent 提示】${IMAGE_AGENT_PROMPT}`);
	}
	systemPromptBlocks.push(
		`【执行/QA 工作流指令】
- 角色：Planner→Executor→QA→Finalizer，单体扮演多角色。
- 执行：逐步调用工具完成计划；遇到失败先尝试修复/返工，再继续。
- QA：对照验收/检查点自检，不满足则继续执行补救，不要提前收尾。
- Finalize：满足验收后，总结完成度并指出下一步可选动作（若有超额建议且可执行，则执行或说明原因）。`,
	);
	const systemPrompt = systemPromptBlocks.join("\n\n");

	const result = await streamText({
		model: buildChatModel(provider, modelName, apiKey, baseUrl || undefined),
		system: systemPrompt,
		messages: modelMessages,
		tools: toolsValue,
		providerOptions,
		maxToolRoundtrips:
			typeof input.maxToolRoundtrips === "number"
				? input.maxToolRoundtrips
				: 6,
		temperature:
			typeof input.temperature === "number"
				? input.temperature
				: chooseTemperature(intent) ?? 0.7,
	});

	// Vercel AI SDK v5: emit UI message SSE stream compatible with DefaultChatTransport
	return result.toUIMessageStreamResponse();
}
