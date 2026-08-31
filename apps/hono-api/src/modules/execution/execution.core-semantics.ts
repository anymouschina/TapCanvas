import {
	WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
	parseWorkflowExecutionSemanticsV2,
	type WorkflowExecutionSemanticsV2,
	type WorkflowFailureStage,
} from "@tapcanvas/workflow-kernel-protocol";

type CoreSemanticsInput = Omit<WorkflowExecutionSemanticsV2, "protocolVersion">;

function semantics(input: CoreSemanticsInput): WorkflowExecutionSemanticsV2 {
	return parseWorkflowExecutionSemanticsV2({
		protocolVersion: WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
		...input,
	});
}

function replay(failureStage: WorkflowFailureStage): WorkflowExecutionSemanticsV2 {
	return semantics({
		sideEffect: "none",
		retrySafety: "safe",
		executionMode: "parallel_safe",
		idempotency: null,
		resultLookup: { mode: "none", outputField: null },
		recoveryMode: "replay",
		// Replaying an unchanged deterministic input cannot repair a schema or
		// contract failure. Keep replay as the restart policy, but close the
		// current execution after its first failed attempt instead of consuming
		// time on identical automatic reruns.
		maxAutomaticAttempts: 1,
		backoffClass: "none",
		failureStage,
	});
}

function manual(
	failureStage: WorkflowFailureStage,
	sideEffect: "none" | "external_mutation" = "external_mutation",
): WorkflowExecutionSemanticsV2 {
	return semantics({
		sideEffect,
		retrySafety: "unsafe",
		executionMode: "sequential",
		idempotency: null,
		resultLookup: { mode: "none", outputField: null },
		recoveryMode: "manual",
		maxAutomaticAttempts: 1,
		backoffClass: "none",
		failureStage,
	});
}

function reconcile(input: Readonly<{
	failureStage: WorkflowFailureStage;
	sideEffect: "external_mutation" | "paid_generation";
	resultField: string;
}>): WorkflowExecutionSemanticsV2 {
	return semantics({
		sideEffect: input.sideEffect,
		retrySafety: "idempotency_key_required",
		executionMode: "exclusive",
		idempotency: { source: "runtime_node", inputField: null },
		resultLookup: { mode: "provider_receipt", outputField: input.resultField },
		recoveryMode: "reconcile",
		maxAutomaticAttempts: 1,
		backoffClass: "none",
		failureStage: input.failureStage,
	});
}

/** The single runtime registry for every built-in executor. */
export const CORE_WORKFLOW_EXECUTOR_SEMANTICS = Object.freeze({
	"workflow.trigger/v1": replay("trigger"),
	"workflow.input/v1": replay("input"),
	"workflow.input.text/v1": replay("input"),
	"workflow.script.javascript/v1": manual("script_execution", "none"),
	"workflow.collection.split/v1": replay("control"),
	"workflow.collection.take/v1": replay("control"),
	"workflow.collection.drop/v1": replay("control"),
	"workflow.collection.concat/v1": replay("control"),
	"workflow.collection.empty/v1": replay("control"),
	"video.beat-sheet.take/v1": replay("control"),
	"tapcanvas.canvas.group.read/v1": replay("asset_access"),
	"agents.delivery.contract/v2": replay("delivery_verification"),
	"video.asset-plans.project/v1": replay("control"),
	"video.asset-plans.split/v1": replay("control"),
	"video.clip-contexts/v1": replay("control"),
	"video.prompt-package.persist/v1": replay("artifact_persistence"),
	"video.voice-catalog/v1": replay("asset_access"),
	"video.voice-manifest.empty/v1": replay("control"),
	"video.voice-manifest.materialize/v1": reconcile({ failureStage: "media_generation", sideEffect: "paid_generation", resultField: "audioUrl" }),
	"video.estimate/v1": replay("media_generation"),
	"video.production.handoff/v1": replay("assembly"),
	"video.concat/v1": reconcile({ failureStage: "assembly", sideEffect: "external_mutation", resultField: "videoUrl" }),
	"tapcanvas.image.generate/v1": reconcile({ failureStage: "media_generation", sideEffect: "paid_generation", resultField: "taskId" }),
	"tapcanvas.video.generate/v1": reconcile({ failureStage: "media_generation", sideEffect: "paid_generation", resultField: "taskId" }),
	"agents.skill.require/v1": replay("agent_authoring"),
	"agents.tool.allow/v1": replay("tool_execution"),
	"agents.tool.invoke/v1": manual("tool_execution"),
	"workflow.human.approval/v1": manual("human_interaction"),
	"workflow.control.condition/v1": replay("control"),
	"workflow.control.terminal/v1": replay("control"),
	"workflow.subworkflow.run/v1": reconcile({ failureStage: "subworkflow", sideEffect: "external_mutation", resultField: "childExecutionId" }),
	"agents.knowledge.search/v1": replay("asset_access"),
	"agents.knowledge.read/v1": replay("asset_access"),
	"workflow.control.join/v1": replay("control"),
	"workflow.artifact.contract/v1": replay("artifact_persistence"),
	"agents.logical-task/v2": reconcile({ failureStage: "agent_authoring", sideEffect: "external_mutation", resultField: "taskId" }),
	"agents.delivery.verify/v2": replay("delivery_verification"),
	"workflow.output/v1": replay("export"),
} satisfies Readonly<Record<string, WorkflowExecutionSemanticsV2>>);

export type CoreWorkflowExecutorRef = keyof typeof CORE_WORKFLOW_EXECUTOR_SEMANTICS;
export const CORE_WORKFLOW_EXECUTOR_REFS = Object.freeze(
	Object.keys(CORE_WORKFLOW_EXECUTOR_SEMANTICS) as CoreWorkflowExecutorRef[],
);

export type CoreWorkflowExecutorPortContract = Readonly<{
	requiredInputPorts: readonly string[];
}>;

/**
 * Executor-owned minimum input contracts. Authored canvas ports may add optional
 * inputs, but they cannot remove inputs that the server executor unconditionally
 * consumes. Keeping this beside the executor registry prevents an outdated flow
 * definition from being admitted and failing only after paid upstream work.
 */
export const CORE_WORKFLOW_EXECUTOR_PORT_CONTRACTS = Object.freeze({
	"workflow.collection.take/v1": { requiredInputPorts: ["items"] },
	"video.beat-sheet.take/v1": { requiredInputPorts: ["beat-sheet"] },
	"video.voice-manifest.materialize/v1": { requiredInputPorts: ["voice-catalog", "voice-plan", "estimate"] },
	"video.production.handoff/v1": { requiredInputPorts: ["prompt-package", "estimate", "asset-bindings", "voice-manifest"] },
} satisfies Partial<Record<CoreWorkflowExecutorRef, CoreWorkflowExecutorPortContract>>);

export function resolveCoreWorkflowExecutorPortContract(
	executorRef: string,
): CoreWorkflowExecutorPortContract | null {
	return Object.prototype.hasOwnProperty.call(CORE_WORKFLOW_EXECUTOR_PORT_CONTRACTS, executorRef)
		? CORE_WORKFLOW_EXECUTOR_PORT_CONTRACTS[executorRef as keyof typeof CORE_WORKFLOW_EXECUTOR_PORT_CONTRACTS]
		: null;
}

export function resolveCoreWorkflowExecutorSemantics(
	executorRef: string,
): WorkflowExecutionSemanticsV2 | null {
	return Object.prototype.hasOwnProperty.call(CORE_WORKFLOW_EXECUTOR_SEMANTICS, executorRef)
		? CORE_WORKFLOW_EXECUTOR_SEMANTICS[executorRef as CoreWorkflowExecutorRef]
		: null;
}
