import { createHash } from "node:crypto";
import type { AsyncAgentContinuation } from "./async-agent-continuation";
import type { DurableTaskReferenceV1 } from "./task.agents-bridge";

type ContinuationPromptFacts = Pick<
	AsyncAgentContinuation,
	| "stage"
	| "parentContinuationId"
	| "handledArtifactIds"
	| "progressFingerprint"
	| "dependencyNodeIds"
	| "dependencyTaskIds"
	| "dependencyRunIds"
	| "durableTaskReferences"
	| "durableProgressClaims"
	| "actionRecoveryFacts"
	| "expectedDelivery"
	| "taskCapsule"
>;

function buildImmutableGoalReference(goal: string): Record<string, unknown> {
	return {
		sha256: createHash("sha256").update(goal).digest("hex"),
		chars: goal.length,
		source: "durable_agents_session",
	};
}

export type AuthoritativeProgressFrontier = DurableTaskReferenceV1 & {
	progressCursor: NonNullable<DurableTaskReferenceV1["progressCursor"]>;
};

function hasEveryCompletedUnit(
	container: AuthoritativeProgressFrontier,
	candidate: AuthoritativeProgressFrontier,
): boolean {
	const completed = new Set(container.progressCursor.completedUnitIds);
	return candidate.progressCursor.completedUnitIds.every((unitId) => completed.has(unitId));
}

function isSameDurableGraphIdentity(
	left: AuthoritativeProgressFrontier,
	right: AuthoritativeProgressFrontier,
): boolean {
	return left.toolName === right.toolName
		&& left.runId === right.runId
		&& left.taskId === right.taskId
		&& left.progressCursor.graph === right.progressCursor.graph;
}

/**
 * Compiles an ordered receipt journal into one executable frontier.
 *
 * A later observational read can carry an older cursor for the same run, so
 * array order alone is insufficient. For one durable graph identity we retain
 * the cursor with the strongest monotonic completion evidence. A genuinely
 * new run/task identity wins by journal order. This is purely structural DAG
 * projection: phase names, operation names and creative payloads are never
 * interpreted here.
 */
export function selectAuthoritativeProgressFrontier(
	references: readonly DurableTaskReferenceV1[],
): AuthoritativeProgressFrontier | null {
	let selected: AuthoritativeProgressFrontier | null = null;
	for (const reference of references) {
		if (!reference.progressCursor) continue;
		if (
			reference.progressCursor.allowedNextActions.length === 0
			&& reference.progressCursor.requiredReadActions.length === 0
		) continue;
		const candidate: AuthoritativeProgressFrontier = {
			...reference,
			progressCursor: reference.progressCursor,
		};
		if (!selected || !isSameDurableGraphIdentity(selected, candidate)) {
			selected = candidate;
			continue;
		}
		const selectedContainsCandidate = hasEveryCompletedUnit(selected, candidate);
		const candidateContainsSelected = hasEveryCompletedUnit(candidate, selected);
		if (!selectedContainsCandidate || candidateContainsSelected) selected = candidate;
	}
	return selected;
}

function compactDurableReceiptJournal(
	references: readonly DurableTaskReferenceV1[],
): Array<Omit<DurableTaskReferenceV1, "progressCursor">> {
	return references.map((reference) => {
		const {
			progressCursor: _progressCursor,
			...receipt
		} = reference;
		return receipt;
	});
}

/**
 * A continuation is an execution cursor, not a second copy of the user task.
 * The original task already lives in the durable agents session. Replaying a
 * long source document on every physical window pushes the ready graph node
 * out of the provider's attention window and needlessly grows every request.
 */
export function buildAsyncAgentContinuationPrompt(
	continuation: ContinuationPromptFacts,
	resumeTrigger: "physical_budget" | "replan" | "dependency",
): string {
	const durableTaskReferences = continuation.durableTaskReferences ?? [];
	const authoritativeProgressFrontier = selectAuthoritativeProgressFrontier(
		durableTaskReferences,
	);
	const durableReceiptJournal = compactDurableReceiptJournal(durableTaskReferences);
	const checkpoint = {
		resumeTrigger,
		stage: continuation.stage,
		parentContinuationId: continuation.parentContinuationId,
		handledArtifactIds: continuation.handledArtifactIds,
		progressFingerprint: continuation.progressFingerprint,
		dependencyNodeIds: continuation.dependencyNodeIds,
		dependencyTaskIds: continuation.dependencyTaskIds,
		dependencyRunIds: continuation.dependencyRunIds,
		durableTaskReferences: durableReceiptJournal,
		authoritativeProgressFrontier,
		durableProgressClaims: continuation.durableProgressClaims ?? [],
		actionRecoveryFacts: continuation.actionRecoveryFacts ?? [],
	};
	const goal = continuation.taskCapsule?.goal.trim() ?? "";
	const canInlineGoal = goal.length > 0 && goal.length <= 4_000;
	const directForcedAgentExecution =
		continuation.taskCapsule?.executionContract?.directForcedAgentExecution === true;
	const directTypedOutputContinuation = directForcedAgentExecution
		&& authoritativeProgressFrontier === null;
	const hasRetryableActionInput = (continuation.actionRecoveryFacts ?? []).some(
		(fact) => fact.retryInput && typeof fact.retryInput === "object" && !Array.isArray(fact.retryInput),
	);
	const preActionContinuation = !directForcedAgentExecution
		&& authoritativeProgressFrontier === null
		&& (continuation.durableProgressClaims ?? []).length === 0
		&& !hasRetryableActionInput
		&& continuation.dependencyTaskIds.length === 0
		&& continuation.dependencyRunIds.length === 0;
	const dependencySettlementContinuation = resumeTrigger === "dependency"
		&& (continuation.dependencyNodeIds.length > 0
			|| continuation.dependencyTaskIds.length > 0
			|| continuation.dependencyRunIds.length > 0);
	return [
		resumeTrigger === "physical_budget"
			? "继续同一逻辑任务。上一物理窗口仅因预算边界挂起，不代表用户任务失败。"
			: resumeTrigger === "replan"
				? "继续同一逻辑任务。上一组物理窗口在同一进展版本上已耗尽，当前窗口必须先基于失败证据完成有界重规划，再执行新的合法动作；禁止原样重放旧 Todo。"
				: "继续同一逻辑任务。持久异步依赖已经产生新的可执行证据。",
		"<continuation_checkpoint>",
		JSON.stringify(checkpoint),
		"</continuation_checkpoint>",
		...(hasRetryableActionInput
			? ["actionRecoveryFacts[].retryInput 是上一物理窗口未通过确定性合同的精确动作草稿。必须在该原稿上按对应 code/message 做最小结构修正并重提；禁止重新规划、改写已决定的时长/数量/叙事拓扑，除非错误本身明确否定这些字段。"]
			: []),
		...(dependencySettlementContinuation
			? [
				"当前物理窗口只负责结算 checkpoint 中已经被供应商受理的异步依赖。依赖的 nodeId/taskId/runId 是唯一交付所有者；只能读取、reconcile、inspect，或推进同一幂等 durable run 的已授权下一动作。禁止调用任何新生成、新 workflow begin 或其它会创建平行任务的入口。若现有依赖已产出真实资产，直接以该资产完成交付验收；不得改写提示词后再次提交。",
			  ]
			: directTypedOutputContinuation
			? [
				"当前是无独立业务副作用的 typed Workflow Agent 原子节点，且不存在待执行的 durable graph action。上一窗口已读取的 Skill、section、resource、上游端口事实与结构合同都属于同一持久会话证据；本窗口禁止再次调用 Skill、skill_search、knowledge_search、TodoWrite 或其它准备性工具。立即使用已保留事实编译，并通过当前结构化终态工具提交原始 typed output；不得返回进度说明、续跑说明、验收报告或完成声明。",
			  ]
			: preActionContinuation
			? [
				"当前 checkpoint 尚未产生任何 durable business frontier；authoritativeProgressFrontier=null 在这里表示业务执行尚未开始，不表示所有动作被禁止。直接从不可变原始目标继续，按当前授权工具完成必要的真实上下文读取、规划与第一个合法业务动作。不得假设存在未记录的副作用、不得创建与已知任务冲突的平行 run、不得重复付费或提前报告完成。",
			  ]
			: [
				"authoritativeProgressFrontier 是本窗口唯一权威执行前沿。只能执行其中 progressCursor.requiredReadActions 与 progressCursor.allowedNextActions；任何未列出的 operation 都不是当前合法动作。不得重做 completedUnitIds、重新规划已冻结事实、创建平行业务 run、重复付费或提前报告完成。",
				"工具 operation schema 若已在当前能力面预加载或已成功读取，必须直接执行当前 allowedNextAction；禁止重复读取同一 schema 消耗物理窗口。",
			  ]),
		"<expected_delivery>",
		JSON.stringify(continuation.expectedDelivery),
		"</expected_delivery>",
		...(goal && (directForcedAgentExecution || canInlineGoal)
			? [
				"<original_task_goal immutable=\"true\">",
				goal,
				"</original_task_goal>",
				directForcedAgentExecution
					? "当前续跑属于无独立业务副作用的 typed Workflow Agent 原子节点。以上原始输入与输出合同是本窗口的权威任务事实；继续同一逻辑任务，不得改写作用域或另建任务。"
					: "以上是同一逻辑任务的不可变原始目标；它只恢复任务事实，不改变当前持久执行前沿，也不得触发重复副作用。",
			  ]
			: goal
			? [
				"<original_task_goal_ref immutable=\"true\">",
				JSON.stringify(buildImmutableGoalReference(goal)),
				"</original_task_goal_ref>",
			  ]
			: []),
		directForcedAgentExecution
			? "typed Workflow Agent 的原始输入已由服务端从不可变 task capsule 重新注入；禁止声称输入缺失，也禁止使用会话里的其它任务替代。"
			: canInlineGoal
				? "短原始任务目标已从不可变 task capsule 重新注入；其它已读项目事实仍以 durable agents session 与工具证据为准。"
				: "原始任务正文已在 durable agents session 中，不在续跑消息重复注入。若持久会话事实不可用，必须显式失败，禁止猜测或使用默认任务代替。",
	].join("\n");
}
