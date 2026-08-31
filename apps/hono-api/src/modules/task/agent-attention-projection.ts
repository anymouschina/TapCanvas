import type { AgentAttentionProjectionV1 } from "@tapcanvas/agent-observability";

export function projectPublicAgentAttention(input: {
	logicalTaskId: string;
	status: AgentAttentionProjectionV1["status"];
	reasonCode?: string | null;
	obligation?: string | null;
	graphRevision?: number | null;
	evidenceRevision?: number | null;
	physicalRunId?: string | null;
}): AgentAttentionProjectionV1 {
	const logicalTaskId = input.logicalTaskId.trim();
	if (!logicalTaskId) throw new Error("attention projection requires logicalTaskId");
	return {
		version: 1,
		logicalTaskId,
		status: input.status,
		waitingOn: input.status === "wait" || input.status === "user_action_required"
			? input.reasonCode?.trim() || null
			: null,
		obligation: input.obligation?.trim() || (
			input.status === "replan"
				? "基于失败证据创建有界计划增量与新 envelope"
				: input.status === "run_now"
					? "执行当前逻辑任务的下一条合法动作"
					: "完成当前持久义务"
		),
		sourceHeads: {
			graphRevision: input.graphRevision ?? null,
			evidenceRevision: input.evidenceRevision ?? null,
			physicalRunId: input.physicalRunId?.trim() || null,
		},
	};
}
