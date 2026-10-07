import type { WorkflowAgentReasoningEffort } from "./execution.node-executors";

/**
 * 工作流 Agent 的推理档位：用户选择优先，没人选择时默认 low。
 *
 * 优先级：发起本次运行的 AI 对话所选档位 → 直接启动一键成片时在模型旁选的档位 → 节点配置
 * （见 resolveWorkflowAgentReasoningEffort）→ 本模块的默认值。节点数据
 * workflowAgentReasoningEffortCeiling 是管理员显式配置的上限，仍对上述结果封顶。
 *
 * 默认 low 的依据（2026-10-03，b.ai deepseek-v4.1-flash）：时间轴跨窗修正题 none 两次都答错，
 * low 两次都对且推理量约为 medium 的一半；medium 常把输出预算全耗在推理上（序列作者单轮
 * 7~10 万推理 token）。序列作者从 12~27 分钟降到约 8.5 分钟。none 会卡死在时间轴约束上，不能作默认。
 * 环境变量 WORKFLOW_AGENT_REASONING_DEFAULT 可改默认档位，off 表示不设默认（交给模型侧默认）。
 */
const ORDER: readonly WorkflowAgentReasoningEffort[] = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

export const WORKFLOW_AGENT_DEFAULT_REASONING_EFFORT: WorkflowAgentReasoningEffort = "low";

function parseEffort(value: unknown): WorkflowAgentReasoningEffort | undefined {
	return typeof value === "string" && (ORDER as readonly string[]).includes(value)
		? value as WorkflowAgentReasoningEffort : undefined;
}

/** 没有任何用户或节点选择时使用的档位。 */
export function resolveWorkflowAgentDefaultReasoningEffort(
	env: Readonly<Record<string, string | undefined>> = process.env,
): WorkflowAgentReasoningEffort | undefined {
	const raw = env.WORKFLOW_AGENT_REASONING_DEFAULT?.trim().toLowerCase();
	if (raw === "off") return undefined;
	return parseEffort(raw) ?? WORKFLOW_AGENT_DEFAULT_REASONING_EFFORT;
}

/** 节点数据显式配置的推理上限；未配置则不封顶。 */
export function resolveAuthorReasoningCeiling(input: Readonly<{
	nodeCeiling?: unknown;
}>): WorkflowAgentReasoningEffort | undefined {
	return parseEffort(input.nodeCeiling);
}

export function applyReasoningCeiling(
	inherited: WorkflowAgentReasoningEffort | undefined,
	ceiling: WorkflowAgentReasoningEffort | undefined,
): WorkflowAgentReasoningEffort | undefined {
	if (!ceiling) return inherited;
	if (!inherited) return ceiling;
	return ORDER.indexOf(inherited) <= ORDER.indexOf(ceiling) ? inherited : ceiling;
}
