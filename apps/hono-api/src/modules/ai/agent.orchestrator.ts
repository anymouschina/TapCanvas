import { z } from "zod";
import { generateText } from "ai";
import type { AppContext } from "../types";
import { buildChatModel, pickPlannerModelName } from "./ai.chat";

const ToolResultSchema = z.object({
	sessionId: z.string().min(1),
	nodeId: z.string().optional(),
	nodeKind: z.string().optional(),
	toolName: z.string().optional(),
	toolCallId: z.string().optional(),
	output: z.any().optional(),
	errorText: z.string().optional(),
});

const GuardrailSchema = z.object({
	acceptance: z.array(z.string()).optional(),
	checkpoints: z.array(z.string()).optional(),
	extras: z.array(z.string()).optional(),
	failureHandling: z.array(z.string()).optional(),
});

const OrchestratorRequestSchema = z.object({
	sessionId: z.string().min(1),
	planId: z.string().optional(),
	intent: z.string().optional(),
	goals: z.array(z.string()).optional(),
	guardrails: GuardrailSchema.optional(),
	toolResult: ToolResultSchema,
});

const OrchestratorResponseSchema = z.object({
	reply: z.string().optional(),
	followUp: z.string().optional(),
	shouldContinue: z.boolean().default(true),
});

export type OrchestratorRequest = z.infer<typeof OrchestratorRequestSchema>;
export type OrchestratorResponse = z.infer<typeof OrchestratorResponseSchema>;

const SYSTEM = `你是 TapCanvas 的 QA+返工 orchestrator，职责：
- 根据最新工具结果，判定是否满足验收；不满足时给出补救行动（可以包含新的工具调用建议）。
- 只返回简短的中文说明；不要重复长篇上下文；避免额外寒暄。
- 若已满足验收，明确说明完成并给出简短下一步建议（可选）。`;

export async function runOrchestrator(
	c: AppContext,
	modelName: string,
	provider: "openai" | "anthropic" | "google",
	apiKey: string,
	baseUrl: string | null | undefined,
	input: OrchestratorRequest,
) {
	const parsed = OrchestratorRequestSchema.parse(input);
	const model = buildChatModel(
		provider,
		pickPlannerModelName(provider, modelName),
		apiKey,
		baseUrl || undefined,
	);

	const guardrailsText = (() => {
		const parts: string[] = [];
		if (parsed.guardrails?.acceptance?.length)
			parts.push(`验收：${parsed.guardrails.acceptance.join("；")}`);
		if (parsed.guardrails?.checkpoints?.length)
			parts.push(`检查点：${parsed.guardrails.checkpoints.join("；")}`);
		if (parsed.guardrails?.failureHandling?.length)
			parts.push(`失败处理：${parsed.guardrails.failureHandling.join("；")}`);
		if (parsed.guardrails?.extras?.length)
			parts.push(`超额建议：${parsed.guardrails.extras.join("；")}`);
		return parts.join(" ｜ ");
	})();

	const toolSummary = (() => {
		const parts: string[] = [];
		const t = parsed.toolResult;
		if (t.toolName) parts.push(`工具：${t.toolName}`);
		if (t.nodeKind || t.nodeId) parts.push(`节点：${t.nodeKind || ""} ${t.nodeId || ""}`.trim());
		if (t.errorText) parts.push(`错误：${t.errorText}`);
		if (!t.errorText && t.output) parts.push(`输出：${safeStringify(t.output)}`);
		return parts.join(" ｜ ");
	})();

	const userPrompt = `意图：${parsed.intent || "未知"}
目标：${parsed.goals?.join("；") || "未知"}
守则：${guardrailsText || "无"}
最新工具结果：${toolSummary || "无"}
请判定是否达标；如未达标，给出下一步补救行动（可包含工具调用建议）；最多 120 字。`;

	const res = await generateText({
		model,
		system: SYSTEM,
		messages: [{ role: "user", content: userPrompt }],
		output: OrchestratorResponseSchema,
	});

	return res.object as OrchestratorResponse;
}

function safeStringify(value: any): string {
	try {
		const str = JSON.stringify(value);
		if (!str) return "";
		return str.slice(0, 400);
	} catch {
		return String(value || "").slice(0, 200);
	}
}
