import type {
	AgentLogicalTaskStateV1,
	AgentPhysicalRunExitV1,
} from "@tapcanvas/agent-observability";

export const LOGICAL_TASK_STATE_VERSION = 1 as const;

function validatePhysicalExitIdentity(input: Readonly<{
	exit: AgentPhysicalRunExitV1;
	expectedLogicalTaskId: string;
	ownerLabel: string;
}>): string {
	const expectedLogicalTaskId = input.expectedLogicalTaskId.trim();
	if (!expectedLogicalTaskId) {
		throw new Error(`${input.ownerLabel} logical task projection requires a logicalTaskId`);
	}
	if (input.exit.logicalTaskId !== expectedLogicalTaskId) {
		throw new Error(`${input.ownerLabel} physical exit logicalTaskId mismatch`);
	}
	return expectedLogicalTaskId;
}

function projectPhysicalRunExit(exit: AgentPhysicalRunExitV1): AgentLogicalTaskStateV1 {
	const base = {
		version: LOGICAL_TASK_STATE_VERSION,
		logicalTaskId: exit.logicalTaskId,
		reasonCode: exit.reasonCode,
		taskNodeId: exit.taskNodeId,
		taskRevision: exit.taskRevision,
		updatedAt: exit.exitedAt,
		continuationTicket: exit.continuationTicket,
	} as const;

	if (exit.kind === "logical_terminal") {
		return exit.taskStatus === "satisfied"
			? {
					...base,
					status: "succeeded",
					physicalRunStatus: "completed",
					deliveryStatus: "satisfied",
			  }
			: {
					...base,
					status: exit.taskStatus === "canceled" ? "cancelled" : "failed",
					physicalRunStatus: exit.taskStatus === "canceled" ? "interrupted" : "completed",
					deliveryStatus: "unsatisfied",
			  };
	}
	if (exit.kind === "needs_input") {
		return {
			...base,
			status: "waiting_input",
			physicalRunStatus: "completed",
			deliveryStatus: "pending",
		};
	}
	return {
		...base,
		status: exit.kind === "waiting_external" ? "waiting_external" : "active",
		physicalRunStatus: "handed_off",
		deliveryStatus: "pending",
	};
}

/**
 * Commit the TaskStore-backed physical exit into the only public logical-task
 * lifecycle projection. Delivery verification is an independent fact: a
 * satisfied logical terminal is illegal without a matching verified delivery
 * envelope, while a failed/cancelled task remains terminal even when no asset
 * or response was produced.
 */
export function projectPublicChatLogicalTaskState(input: Readonly<{
	exit: AgentPhysicalRunExitV1;
	expectedLogicalTaskId: string;
	deliveryVerified: boolean;
}>): AgentLogicalTaskStateV1 {
	validatePhysicalExitIdentity({
		exit: input.exit,
		expectedLogicalTaskId: input.expectedLogicalTaskId,
		ownerLabel: "public chat",
	});
	if (
		input.exit.kind === "logical_terminal"
		&& input.exit.taskStatus === "satisfied"
		&& !input.deliveryVerified
	) {
		throw new Error("satisfied logical task is missing verified delivery");
	}
	return projectPhysicalRunExit(input.exit);
}

/**
 * Commit an atomic Workflow Agent exit. Its satisfied terminal closes the
 * workflow action only; the durable Workflow remains the sole authority for
 * the user's eventual media delivery. No public-chat delivery envelope is
 * required or manufactured at this boundary.
 */
export function projectWorkflowActionLogicalTaskState(input: Readonly<{
	exit: AgentPhysicalRunExitV1;
	expectedLogicalTaskId: string;
}>): AgentLogicalTaskStateV1 {
	validatePhysicalExitIdentity({
		exit: input.exit,
		expectedLogicalTaskId: input.expectedLogicalTaskId,
		ownerLabel: "workflow action",
	});
	return projectPhysicalRunExit(input.exit);
}
