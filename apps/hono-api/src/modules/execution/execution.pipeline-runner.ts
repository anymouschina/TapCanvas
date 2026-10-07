import {
	createWorkflowCollection,
	isWorkflowCollection,
	assertPipelineExecutorRef,
	hasWorkflowPluginExecutorRefPrefix,
	parseWorkflowExecutionSemanticsV2,
	parseWorkflowPipelineRunSpec,
	WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
	type WorkflowExecutionSemanticsV2,
	type WorkflowPipelineRunSpecV1,
	type WorkflowPipelineStepV1,
	type WorkflowPipelineValueModeV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type {
	WorkflowNodeExecutionContext,
	WorkflowNodeExecutorDependencies,
} from "./execution.node-executors";
import {
	parseWorkflowNodeOutputV1,
	resolveWorkflowNodeExecutionMode,
	resolveWorkflowNodeExecutorRef,
	workflowNodeExecutionFailure,
	workflowNodeWaiting,
	type WorkflowNodeExecutionResult,
	type WorkflowNodeOutputV1,
	type WorkflowNodeSnapshot,
} from "./execution.node-runtime";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";
import { workflowExternalPollAfter } from "./execution.external-check";
import { workflowAuthorRepairRouteAt, projectWorkflowAuthorRepairOutput, workflowConsumerReplayStepsAt, workflowConsumerReplayStepPorts, workflowConsumerReplayInputValue } from "./execution.author-repair-target";
import type { WorkflowExternalCheckScheduleV1 } from "./execution.external-check";
import { collectPipelineDependencyFailures, describePipelineDependencyFailure, type PipelineDependencyFailure } from "./execution.pipeline-failures";
import { WorkflowPersistenceError } from "./execution.persistence-error";
import { readDatabaseErrorCodes } from "../../platform/node/database-read-retry";

const WORKFLOW_PIPELINE_CHECKPOINT_POLL_MS = 1_000;
const WORKFLOW_PIPELINE_RECEIPT_FIELD = "providerReceiptRefs";

type PipelineStepStatus = "success" | "waiting_external" | "failed" | "not_selected";

type PipelineStepReceipt = Readonly<{
	status: PipelineStepStatus;
	outputRefs?: WorkflowNodeOutputV1;
	errorCode?: string;
	errorMessage?: string;
	selectedOutputPorts?: readonly string[];
}>;

type WorkflowPipelineState = Readonly<{
	protocolVersion: "workflow.pipeline.state/v1";
	cursorStepId: string | null;
	steps: Readonly<Record<string, PipelineStepReceipt>>;
	updatedAt: string;
}>;

// Only the database checkpoint boundary creates this wrapper. A provider or
// stage failure with a similar error code must retain its original meaning.
class PipelineCheckpointFailure extends Error {
	readonly persistence: WorkflowPersistenceError;
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : String(cause), { cause });
		this.persistence = cause instanceof WorkflowPersistenceError ? cause : new WorkflowPersistenceError(cause);
	}
}

type ExecutePipelineStep = (
	context: WorkflowNodeExecutionContext,
	dependencies: WorkflowNodeExecutorDependencies,
) => Promise<WorkflowNodeExecutionResult>;

type PipelineBindingInput = Readonly<{
	active: boolean;
	values: readonly unknown[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRequiredInputPorts(node: WorkflowNodeSnapshot): ReadonlySet<string> {
	const spec = isRecord(node.data.workflowAtomicSpec) ? node.data.workflowAtomicSpec : null;
	const inputPorts = spec && Array.isArray(spec.inputPorts)
		? spec.inputPorts.flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : [])
		: [];
	const optionalInputPorts = spec && Array.isArray(spec.optionalInputPorts)
		? new Set(spec.optionalInputPorts.flatMap((value) => typeof value === "string" && value.trim() ? [value.trim()] : []))
		: new Set<string>();
	return new Set(inputPorts.filter((portId) => !optionalInputPorts.has(portId)));
}

function topologicalSteps(spec: WorkflowPipelineRunSpecV1): readonly WorkflowPipelineStepV1[] {
	const byId = new Map(spec.steps.map((step) => [step.stepId, step] as const));
	const outgoing = new Map(spec.steps.map((step) => [step.stepId, new Set<string>()] as const));
	const indegree = new Map<string, number>(spec.steps.map((step) => [step.stepId, 0] as const));
	for (const binding of spec.bindings) {
		if (binding.from.kind !== "step") continue;
		const targets = outgoing.get(binding.from.stepId);
		if (!targets) throw new Error(`Workflow pipeline binding source ${binding.from.stepId} is missing`);
		if (targets.has(binding.to.stepId)) continue;
		targets.add(binding.to.stepId);
		indegree.set(binding.to.stepId, (indegree.get(binding.to.stepId) ?? 0) + 1);
	}
	const stepOrder = new Map(spec.steps.map((step, index) => [step.stepId, index] as const));
	const ready = spec.steps
		.filter((step) => (indegree.get(step.stepId) ?? 0) === 0)
		.map((step) => step.stepId);
	const ordered: WorkflowPipelineStepV1[] = [];
	while (ready.length > 0) {
		ready.sort((left, right) => (stepOrder.get(left) ?? 0) - (stepOrder.get(right) ?? 0));
		const stepId = ready.shift();
		if (!stepId) break;
		const step = byId.get(stepId);
		if (!step) throw new Error(`Workflow pipeline step ${stepId} is missing`);
		ordered.push(step);
		for (const targetStepId of outgoing.get(stepId) ?? []) {
			const nextDegree = (indegree.get(targetStepId) ?? 0) - 1;
			indegree.set(targetStepId, nextDegree);
			if (nextDegree === 0) ready.push(targetStepId);
		}
	}
	if (ordered.length !== spec.steps.length) throw new Error("Workflow pipeline bindings must form an acyclic graph");
	return ordered;
}

function itemIdentity(context: WorkflowNodeExecutionContext): string {
	const lineage = context.runtimeItemLineage ?? [];
	const lastLineage = lineage[lineage.length - 1];
	return lastLineage?.itemId ?? context.node.id;
}

function collectionForValues(input: Readonly<{
	context: WorkflowNodeExecutionContext;
	producerPortId: string;
	values: readonly unknown[];
}>): unknown {
	if (input.values.length === 1 && isWorkflowCollection(input.values[0])) return input.values[0];
	const itemId = itemIdentity(input.context);
	const itemIds = input.values.map((_, index) => input.values.length === 1
		? itemId
		: `${itemId}::${input.producerPortId}::${index}`);
	return createWorkflowCollection({
		collectionId: `${input.context.executionFamilyId}:${input.context.node.id}:${input.producerPortId}`,
		producerNodeId: input.context.node.id,
		producerPortId: input.producerPortId,
		values: input.values,
		itemIds,
		parentLineage: input.values.map(() => [...(input.context.runtimeItemLineage ?? [])]),
	});
}

function bindPipelineValues(input: Readonly<{
	mode: WorkflowPipelineValueModeV1;
	values: readonly unknown[];
	context: WorkflowNodeExecutionContext;
	producerPortId: string;
}>): PipelineBindingInput {
	if (input.values.length === 0) return { active: false, values: [] };
	if (input.mode === "collection") {
		return {
			active: true,
			values: [collectionForValues({
				context: input.context,
				producerPortId: input.producerPortId,
				values: input.values,
			})],
		};
	}
	return { active: true, values: input.values };
}

function readPipelineState(value: unknown): WorkflowPipelineState | null {
	if (!isRecord(value) || value.protocolVersion !== "workflow.pipeline.state/v1" || !isRecord(value.steps)) return null;
	const steps: Record<string, PipelineStepReceipt> = {};
	for (const [stepId, raw] of Object.entries(value.steps)) {
		if (!isRecord(raw) || !["success", "waiting_external", "failed", "not_selected"].includes(String(raw.status))) {
			throw new Error(`Workflow pipeline persisted step receipt ${stepId} is invalid`);
		}
		const status = raw.status as PipelineStepStatus;
		const outputRefs = raw.outputRefs === undefined ? undefined : parseWorkflowNodeOutputV1(raw.outputRefs) ?? undefined;
		if ((status === "success" || status === "waiting_external") && !outputRefs) {
			throw new Error(`Workflow pipeline persisted step ${stepId} is missing outputRefs`);
		}
		steps[stepId] = {
			status,
			...(outputRefs ? { outputRefs } : {}),
			...(typeof raw.errorCode === "string" ? { errorCode: raw.errorCode } : {}),
			...(typeof raw.errorMessage === "string" ? { errorMessage: raw.errorMessage } : {}),
			...(Array.isArray(raw.selectedOutputPorts)
				? { selectedOutputPorts: raw.selectedOutputPorts.filter((port): port is string => typeof port === "string") }
				: {}),
		};
	}
	return {
		protocolVersion: "workflow.pipeline.state/v1",
		cursorStepId: typeof value.cursorStepId === "string" ? value.cursorStepId : null,
		steps,
		updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "",
	};
}

function resolveFrozenStepSemantics(
	context: WorkflowNodeExecutionContext,
	node: WorkflowNodeSnapshot,
): WorkflowExecutionSemanticsV2 | null {
	const executorRef = resolveWorkflowNodeExecutorRef(node);
	if (!executorRef) return null;
	const flowData = isRecord(context.flowVersionData) ? context.flowVersionData : null;
	const snapshot = flowData && isRecord(flowData.workflowExecutionSemantics)
		? flowData.workflowExecutionSemantics
		: null;
	const snapshotNodes = snapshot && isRecord(snapshot.nodes) ? snapshot.nodes : null;
	const frozen: Record<string, unknown> | null = snapshotNodes && isRecord(snapshotNodes[node.id])
		? snapshotNodes[node.id] as Record<string, unknown>
		: null;
	if (frozen) {
		if (frozen.executorRef !== executorRef) {
			throw new Error(`Workflow pipeline step ${node.id} execution semantics do not match its executorRef`);
		}
		return parseWorkflowExecutionSemanticsV2(frozen.semantics);
	}
	return resolveCoreWorkflowExecutorSemantics(executorRef);
}

function priorPipelineState(context: WorkflowNodeExecutionContext): WorkflowPipelineState | null {
	const itemRun = context.resumeOutputRefs?.itemRuns.find((run) => run.runtimeNodeId === context.node.id);
	const raw = itemRun?.evidence.pipelineState ?? context.resumeOutputRefs?.evidence.pipelineState;
	return readPipelineState(raw);
}

function nestedEvidence(outputRefs: WorkflowNodeOutputV1): readonly Record<string, unknown>[] {
	return [
		outputRefs.evidence,
		...outputRefs.itemRuns.map((run) => run.evidence),
	];
}

function nonEmptyReceipt(value: unknown): boolean {
	if (typeof value === "string") return value.trim().length > 0;
	if (Array.isArray(value)) return value.some(nonEmptyReceipt);
	return isRecord(value) && Object.keys(value).length > 0;
}

function providerReceiptRefs(input: Readonly<{
	steps: readonly WorkflowPipelineStepV1[];
	stepReceipts: Readonly<Record<string, PipelineStepReceipt>>;
	resolveStepSemantics: (node: WorkflowNodeSnapshot) => WorkflowExecutionSemanticsV2 | null;
}>): readonly Readonly<Record<string, unknown>>[] {
	const results: Array<Readonly<Record<string, unknown>>> = [];
	for (const step of input.steps) {
		const stepReceipt = input.stepReceipts[step.stepId];
		const outputRefs = stepReceipt?.outputRefs;
		if (!outputRefs) continue;
		const executorRef = resolveWorkflowNodeExecutorRef(step.node);
		if (!executorRef) continue;
		const semantics = input.resolveStepSemantics(step.node);
		if (semantics?.retrySafety !== "idempotency_key_required" || semantics.resultLookup.mode === "none") continue;
		for (const evidence of nestedEvidence(outputRefs)) {
			const resultField = semantics.resultLookup.outputField;
			const receiptValue = resultField ? evidence[resultField] : undefined;
			const canvasNodeId = typeof evidence.canvasNodeId === "string" && evidence.canvasNodeId.trim()
				? evidence.canvasNodeId.trim()
				: null;
			if (!nonEmptyReceipt(receiptValue) && !canvasNodeId) continue;
			results.push({
				stepId: step.stepId,
				executorRef,
				...(canvasNodeId ? { canvasNodeId } : {}),
				...(nonEmptyReceipt(receiptValue) ? { resultField, receipt: receiptValue } : {}),
				...(typeof evidence.taskId === "string" && evidence.taskId.trim() ? { taskId: evidence.taskId.trim() } : {}),
			});
		}
	}
	return results;
}

function pipelineOutputRefs(input: Readonly<{
	context: WorkflowNodeExecutionContext;
	steps: readonly WorkflowPipelineStepV1[];
	outputs: WorkflowPipelineRunSpecV1["outputs"];
	stepReceipts: Readonly<Record<string, PipelineStepReceipt>>;
	resolveStepSemantics?: (node: WorkflowNodeSnapshot) => WorkflowExecutionSemanticsV2 | null;
	cursorStepId: string | null;
	complete: boolean;
	externalCheck?: WorkflowExternalCheckScheduleV1;
	error?: Readonly<{ code: string; message: string; dependencyFailures?: readonly PipelineDependencyFailure[] }>;
}>): WorkflowNodeOutputV1 {
	const artifacts = input.steps.flatMap((step) => input.stepReceipts[step.stepId]?.outputRefs?.artifacts ?? []);
	const ports: Record<string, unknown> = {};
	for (const output of input.outputs) {
		const outputRefs = input.stepReceipts[output.from.stepId]?.outputRefs;
		if (!outputRefs || !Object.prototype.hasOwnProperty.call(outputRefs.ports, output.from.portId)) continue;
		const rawValue = outputRefs.ports[output.from.portId];
		if (output.mode === "collection") {
			ports[output.portId] = isWorkflowCollection(rawValue)
				? rawValue
				: collectionForValues({ context: input.context, producerPortId: output.portId, values: [rawValue] });
			continue;
		}
		ports[output.portId] = rawValue;
	}
	const receipts = providerReceiptRefs({
		steps: input.steps,
		stepReceipts: input.stepReceipts,
		resolveStepSemantics: input.resolveStepSemantics ?? ((node) => resolveFrozenStepSemantics(input.context, node)),
	});
	const representativeReceipt = receipts.find((receipt) => typeof receipt.canvasNodeId === "string");
	const stepStatusFacts = Object.fromEntries(input.steps.map((step) => [
		step.stepId,
		{
			status: input.stepReceipts[step.stepId]?.status ?? "not_started",
			...(input.stepReceipts[step.stepId]?.selectedOutputPorts
				? { selectedOutputPorts: input.stepReceipts[step.stepId]?.selectedOutputPorts }
				: {}),
			...(input.stepReceipts[step.stepId]?.errorCode ? { errorCode: input.stepReceipts[step.stepId]?.errorCode } : {}),
		},
	]));
	return projectWorkflowAuthorRepairOutput(input.context.flowVersionData, {
		protocolVersion: "1",
		executorRef: "workflow.pipeline.run/v1",
		nodeId: input.context.node.id,
		executionMode: resolveWorkflowNodeExecutionMode(input.context.node) ?? "once",
		ports,
		artifacts,
		evidence: {
			executorCompleted: input.complete,
			pipelineState: {
				protocolVersion: "workflow.pipeline.state/v1",
				cursorStepId: input.cursorStepId,
				steps: input.stepReceipts,
				updatedAt: new Date().toISOString(),
			} satisfies WorkflowPipelineState,
			pipelineStepFacts: stepStatusFacts,
			providerReceiptRefs: receipts,
			...(representativeReceipt && typeof representativeReceipt.canvasNodeId === "string"
				? { canvasNodeId: representativeReceipt.canvasNodeId }
				: {}),
			...(input.error ? { pipelineFailure: input.error } : {}),
		},
		itemRuns: [],
		...(input.externalCheck ? { externalCheck: input.externalCheck } : {}),
	});
}

function stableStepRuntimeNodeId(context: WorkflowNodeExecutionContext, step: WorkflowPipelineStepV1): string {
	return `${context.node.id}::step::${encodeURIComponent(step.stepId)}`;
}

function bindStepInputs(input: Readonly<{
	context: WorkflowNodeExecutionContext;
	spec: WorkflowPipelineRunSpecV1;
	step: WorkflowPipelineStepV1;
	stepReceipts: Readonly<Record<string, PipelineStepReceipt>>;
}>): Readonly<{ inputs: WorkflowNodeExecutionContext["inputs"]; active: boolean; inactiveStepSource: boolean }> {
	const boundInputs: Record<string, unknown[]> = {};
	let hasBinding = false;
	let inactiveStepSource = false;
	for (const binding of input.spec.bindings.filter((candidate) => candidate.to.stepId === input.step.stepId)) {
		let values: readonly unknown[] = [];
		if (binding.from.kind === "input") {
			if (!input.spec.inputs.some((candidate) => candidate.portId === binding.from.portId)) {
				throw new Error(`Workflow pipeline input ${binding.from.portId} is missing`);
			}
			const sourceValues = (input.context.inputs[binding.from.portId] ?? []).map(value => workflowConsumerReplayInputValue(input.context.flowVersionData, input.context.node.id, value));
			const rebound = bindPipelineValues({
				context: input.context,
				mode: binding.mode,
				values: sourceValues,
				producerPortId: binding.from.portId,
			});
			if (rebound.active) values = rebound.values;
		} else {
			const sourceReceipt = input.stepReceipts[binding.from.stepId];
			const sourceOutput = sourceReceipt?.outputRefs;
			const sourcePorts = sourceOutput ? workflowConsumerReplayStepPorts(input.context.flowVersionData, input.context.node.id, binding.from.stepId, sourceOutput) : {};
			const selectedConsumerInput = workflowConsumerReplayStepsAt(input.context.flowVersionData, input.context.node.id) !== null
				&& sourceOutput && sourcePorts !== sourceOutput.ports;
			if ((sourceReceipt?.status !== "success" && !selectedConsumerInput)
				|| !sourceOutput
				|| !Object.prototype.hasOwnProperty.call(sourcePorts, binding.from.portId)) {
				inactiveStepSource = true;
				continue;
			}
			const adapted = bindPipelineValues({
				context: input.context,
				mode: binding.mode,
				values: [sourcePorts[binding.from.portId]],
				producerPortId: `${binding.from.stepId}:${binding.from.portId}`,
			});
			if (adapted.active) values = adapted.values;
		}
		if (values.length === 0) continue;
		hasBinding = true;
		const portValues = boundInputs[binding.to.portId] ?? [];
		portValues.push(...values);
		boundInputs[binding.to.portId] = portValues;
	}
	const requiredInputPorts = readRequiredInputPorts(input.step.node);
	const hasMissingRequired = [...requiredInputPorts].some((portId) => !Object.prototype.hasOwnProperty.call(boundInputs, portId));
	if (hasMissingRequired) {
		return { inputs: boundInputs, active: false, inactiveStepSource: inactiveStepSource || hasBinding };
	}
	const hasIncomingBindings = input.spec.bindings.some((binding) => binding.to.stepId === input.step.stepId);
	return {
		inputs: boundInputs,
		active: !hasIncomingBindings || hasBinding,
		inactiveStepSource,
	};
}

function pipelineStepDependenciesSettled(
	step: WorkflowPipelineStepV1,
	spec: WorkflowPipelineRunSpecV1,
	stepReceipts: Readonly<Record<string, PipelineStepReceipt>>,
	context: WorkflowNodeExecutionContext,
): boolean {
	return spec.bindings
		.filter((binding) => binding.to.stepId === step.stepId && binding.from.kind === "step")
		.every((binding) => {
			if (binding.from.kind !== "step") return true;
			const status = stepReceipts[binding.from.stepId]?.status;
			const source = stepReceipts[binding.from.stepId]?.outputRefs;
			return status === "success" || status === "not_selected" || Boolean(source
				&& workflowConsumerReplayStepPorts(context.flowVersionData, context.node.id, binding.from.stepId, source) !== source.ports);
		});
}

function pipelineCursorStepId(
	steps: readonly WorkflowPipelineStepV1[],
	stepReceipts: Readonly<Record<string, PipelineStepReceipt>>,
): string | null {
	return steps.find((step) => {
		const status = stepReceipts[step.stepId]?.status;
		return status !== "success" && status !== "not_selected";
	})?.stepId ?? null;
}

function pipelineWaitingExternalCheck(
	steps: readonly WorkflowPipelineStepV1[],
	stepReceipts: Readonly<Record<string, PipelineStepReceipt>>,
): WorkflowExternalCheckScheduleV1 | null {
	const schedules = steps.flatMap((step) => {
		const receipt = stepReceipts[step.stepId];
		const schedule = receipt?.status === "waiting_external" ? receipt.outputRefs?.externalCheck : undefined;
		return schedule ? [schedule] : [];
	});
	const polls = schedules.filter((schedule) => schedule.mode === "poll");
	if (polls.length > 0) {
		return polls.reduce((earliest, schedule) => (
			Date.parse(schedule.notBeforeAt) < Date.parse(earliest.notBeforeAt) ? schedule : earliest
		));
	}
	return schedules[0] ?? null;
}

/**
 * Compose the outer item executor semantics from the frozen inner atomic nodes.
 * The outer receipt field is populated only when nested executor receipts exist.
 */
export function composeWorkflowPipelineRunSemantics(
	specValue: WorkflowPipelineRunSpecV1,
	resolveStepSemantics: (node: WorkflowNodeSnapshot) => WorkflowExecutionSemanticsV2 | null,
): WorkflowExecutionSemanticsV2 {
	const spec = parseWorkflowPipelineRunSpec(specValue);
	const declared = spec.steps.map((step) => {
		const semantics = resolveStepSemantics(step.node);
		if (!semantics) {
			const executorRef = resolveWorkflowNodeExecutorRef(step.node) ?? "unknown";
			throw new Error(`Workflow pipeline step ${step.stepId} executor ${executorRef} has no frozen execution semantics`);
		}
		return semantics;
	});
	const effectOrder = ["none", "local_mutation", "external_mutation", "paid_generation"] as const;
	const sideEffect = effectOrder.reduce((strongest, current) => (
		declared.some((item) => item.sideEffect === current) ? current : strongest
	), "none" as typeof effectOrder[number]);
	const executionMode = declared.some((item) => item.executionMode === "exclusive")
		? "exclusive"
		: declared.some((item) => item.executionMode === "sequential")
			? "sequential"
			: "parallel_safe";
	const effectSemantics = declared.filter((item) => item.sideEffect !== "none");
	const replayable = effectSemantics.every((item) => (
		item.retrySafety === "safe"
		|| (item.retrySafety === "idempotency_key_required" && item.idempotency !== null)
	));
	const hasIdempotentEffect = effectSemantics.some((item) => item.retrySafety === "idempotency_key_required");
	const retrySafety = !replayable
		? "unsafe"
		: hasIdempotentEffect
			? "idempotency_key_required"
			: "safe";
	const providerReceiptLookup = declared.some((item) => item.resultLookup.mode === "provider_receipt");
	const resultLookup: WorkflowExecutionSemanticsV2["resultLookup"] = retrySafety !== "idempotency_key_required"
		? { mode: "none", outputField: null }
		: providerReceiptLookup
			? { mode: "provider_receipt", outputField: WORKFLOW_PIPELINE_RECEIPT_FIELD }
			: { mode: "idempotency_key", outputField: null };
	const recoveryMode = sideEffect === "none"
		? "replay"
		: retrySafety === "idempotency_key_required" && resultLookup.mode !== "none"
			? "reconcile"
			: "manual";
	const idempotency = retrySafety === "idempotency_key_required"
		? { source: "runtime_node", inputField: null } as const
		: null;
	const failureStage = declared.find((item) => item.sideEffect === sideEffect)?.failureStage
		?? declared[0]?.failureStage
		?? "control";
	return parseWorkflowExecutionSemanticsV2({
		protocolVersion: "workflow.execution-semantics/v2",
		sideEffect,
		retrySafety,
		executionMode,
		idempotency,
		resultLookup,
		recoveryMode,
		maxAutomaticAttempts: 1,
		backoffClass: "none",
		failureStage,
	});
}

function runtimeNode(context: WorkflowNodeExecutionContext, step: WorkflowPipelineStepV1): WorkflowNodeSnapshot {
	return { ...step.node, id: stableStepRuntimeNodeId(context, step) };
}

function stageOutputForCheckpoint(input: Readonly<{
	context: WorkflowNodeExecutionContext;
	steps: readonly WorkflowPipelineStepV1[];
	outputs: WorkflowPipelineRunSpecV1["outputs"];
	stepReceipts: Readonly<Record<string, PipelineStepReceipt>>;
	cursorStepId: string;
	stageOutput: WorkflowNodeOutputV1;
}>): WorkflowNodeOutputV1 {
	const currentStep = input.steps.find((step) => stableStepRuntimeNodeId(input.context, step) === input.stageOutput.nodeId);
	const stepId = currentStep?.stepId;
	if (!stepId) throw new Error(`Workflow pipeline checkpoint refers to unknown stage ${input.stageOutput.nodeId}`);
	const stepReceipts = {
		...input.stepReceipts,
		[stepId]: stageOutputReceipt("waiting_external", input.stageOutput),
	};
	return pipelineOutputRefs({
		context: input.context,
		steps: input.steps,
		outputs: input.outputs,
		stepReceipts,
		cursorStepId: input.cursorStepId,
		complete: false,
		externalCheck: input.stageOutput.externalCheck ?? workflowExternalPollAfter(WORKFLOW_PIPELINE_CHECKPOINT_POLL_MS),
	});
}

function stageResultState(input: Readonly<{
	result: WorkflowNodeExecutionResult;
	stepId: string;
}>): PipelineStepReceipt {
	if (input.result.ok) return stageOutputReceipt("success", input.result.outputRefs);
	if (input.result.waitingExternal === true) return stageOutputReceipt("waiting_external", {
		...input.result.outputRefs, externalCheck: input.result.externalCheck,
	});
	return {
		...(input.result.outputRefs ? stageOutputReceipt("failed", input.result.outputRefs) : { status: "failed" as const }),
		errorCode: input.result.errorCode,
		errorMessage: input.result.errorMessage,
	};
}

function stageReceiptOutputRefs(receipt: PipelineStepReceipt | undefined): WorkflowNodeOutputV1 | null {
	if (!receipt?.outputRefs) return null;
	return parseWorkflowNodeOutputV1(receipt.outputRefs);
}

function omitUndefinedInputs(value: Readonly<Record<string, readonly unknown[]>>): WorkflowNodeExecutionContext["inputs"] {
	return Object.fromEntries(Object.entries(value).filter(([, values]) => values.length > 0));
}

function stageStartInput(input: Readonly<{
	context: WorkflowNodeExecutionContext;
	step: WorkflowPipelineStepV1;
	stepReceipts: Readonly<Record<string, PipelineStepReceipt>>;
	pipelineSpec: WorkflowPipelineRunSpecV1;
}>): ReturnType<typeof bindStepInputs> {
	return bindStepInputs({
		context: input.context,
		spec: input.pipelineSpec,
		step: input.step,
		stepReceipts: input.stepReceipts,
	});
}

function shouldResumeStage(
	context: WorkflowNodeExecutionContext,
	step: WorkflowPipelineStepV1,
): boolean {
	const saved = priorPipelineState(context)?.steps[step.stepId];
	return saved?.status === "waiting_external"
		|| (context.resumeOnly === true && saved?.status === "failed")
		|| (context.recoveryOfExecutionId != null && saved?.status === "failed"
			&& isWorkflowMediaAdoptionCheckpoint(saved.outputRefs))
		|| hasAcceptedFailedStageReceipt(context, step, saved)
		|| shouldRevisitPartialStage(context, saved);
}

function isWorkflowMediaAdoptionCheckpoint(output: WorkflowNodeOutputV1 | undefined): boolean {
	const checkpoint = output?.evidence.mediaAdoptionCheckpoint;
	return isRecord(checkpoint) && checkpoint.protocolVersion === "workflow.media-adoption-checkpoint/v1"
		&& Array.isArray(checkpoint.adoptedItemIds)
		&& checkpoint.adoptedItemIds.length > 0
		&& checkpoint.adoptedItemIds.every((itemId) => typeof itemId === "string" && itemId.length > 0);
}

function hasAcceptedFailedStageReceipt(
	context: WorkflowNodeExecutionContext,
	step: WorkflowPipelineStepV1,
	receipt: PipelineStepReceipt | undefined,
): boolean {
	if (!context.recoveryOfExecutionId || receipt?.status !== "failed" || !receipt.outputRefs) return false;
	const field = resolveFrozenStepSemantics(context, step.node)?.resultLookup.outputField;
	if (!field) return false;
	return nestedEvidence(receipt.outputRefs).some((evidence) => nonEmptyReceipt(evidence[field]));
}

function hasStageReconciliationReceipt(
	context: WorkflowNodeExecutionContext,
	step: WorkflowPipelineStepV1,
	outputRefs: WorkflowNodeOutputV1,
): boolean {
	if (outputRefs.nodeId !== stableStepRuntimeNodeId(context, step)
		|| outputRefs.executorRef !== resolveWorkflowNodeExecutorRef(step.node)) return false;
	const semantics = resolveFrozenStepSemantics(context, step.node);
	if (semantics?.recoveryMode !== "reconcile" || semantics.resultLookup.mode !== "provider_receipt") return false;
	const field = semantics.resultLookup.outputField;
	return field !== null && nestedEvidence(outputRefs).some((evidence) => nonEmptyReceipt(evidence[field]));
}

function shouldRevisitPartialStage(
	context: WorkflowNodeExecutionContext,
	receipt: PipelineStepReceipt | undefined,
): boolean {
	const revisit = context.recoveryOfExecutionId != null
		&& receipt?.status === "success"
		&& receipt.outputRefs?.evidence.partial === true
		&& receipt.outputRefs.itemRuns.some((run) => run.status === "failed");
	if (receipt?.outputRefs?.evidence.partial === true && context.runtimeItemIndex === 0) {
		console.info(JSON.stringify({ message: "workflow_pipeline_partial_stage_recovery_decision",
			executionId: context.executionId, runtimeNodeId: context.node.id,
			priorStatus: receipt.status, recoveryOfExecutionId: context.recoveryOfExecutionId ?? null,
			resumeOnly: context.resumeOnly === true, failedItemCount: receipt.outputRefs.itemRuns.filter((run) => run.status === "failed").length,
			revisit }));
	}
	return revisit;
}

function validateDeclaredPipelineInputs(
	context: WorkflowNodeExecutionContext,
	spec: WorkflowPipelineRunSpecV1,
): void {
	for (const pipelineInput of spec.inputs) {
		if ((context.inputs[pipelineInput.portId]?.length ?? 0) === 0) {
			throw new Error(`Workflow pipeline required input ${pipelineInput.portId} is missing`);
		}
	}
}

function markNotSelected(
	stepReceipts: Readonly<Record<string, PipelineStepReceipt>>,
	stepId: string,
): Readonly<Record<string, PipelineStepReceipt>> {
	return { ...stepReceipts, [stepId]: { status: "not_selected", selectedOutputPorts: [] } };
}

function collectSelectedOutputPorts(outputRefs: WorkflowNodeOutputV1): readonly string[] {
	return Object.keys(outputRefs.ports).sort();
}

function stageOutputReceipt(status: PipelineStepStatus, outputRefs: WorkflowNodeOutputV1): PipelineStepReceipt {
	return { status, outputRefs, selectedOutputPorts: collectSelectedOutputPorts(outputRefs) };
}

function wrappedStageCheckpoint(
	context: WorkflowNodeExecutionContext,
	steps: readonly WorkflowPipelineStepV1[],
	outputs: WorkflowPipelineRunSpecV1["outputs"],
	stepReceipts: Readonly<Record<string, PipelineStepReceipt>>,
	cursorStepId: string,
	retainStageOutput: (output: WorkflowNodeOutputV1) => void,
): NonNullable<WorkflowNodeExecutionContext["checkpointOutputRefs"]> | undefined {
	if (!context.checkpointOutputRefs) return undefined;
	return async (stageOutputRefs) => {
		// Keep accepted receipts even when the following durable write fails.
		retainStageOutput(stageOutputRefs);
		const outputRefs = stageOutputForCheckpoint({
			context,
			steps,
			outputs,
			stepReceipts,
			cursorStepId,
			stageOutput: stageOutputRefs,
		});
		await context.checkpointOutputRefs?.(outputRefs);
	};
}

function pipelineErrorResult(
	context: WorkflowNodeExecutionContext,
	steps: readonly WorkflowPipelineStepV1[],
	outputs: WorkflowPipelineRunSpecV1["outputs"],
	stepReceipts: Readonly<Record<string, PipelineStepReceipt>>,
	cursorStepId: string | null,
	error: unknown,
	dependencyFailures: readonly PipelineDependencyFailure[] = [],
): WorkflowNodeExecutionResult {
	const message = describePipelineDependencyFailure(error instanceof Error ? error.message : String(error), dependencyFailures);
	const outputRefs = pipelineOutputRefs({
		context,
		steps,
		outputs,
		stepReceipts,
		cursorStepId,
		complete: false,
		error: { code: "workflow_pipeline_run_failed", message, dependencyFailures },
	});
	return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: message,
		outputRefs: projectWorkflowAuthorRepairOutput(context.flowVersionData, outputRefs) };
}

function preservedPipelineErrorResult(
	context: WorkflowNodeExecutionContext,
	error: unknown,
): WorkflowNodeExecutionResult {
	const message = error instanceof Error ? error.message : String(error);
	const savedItem = context.resumeOutputRefs?.itemRuns.find((run) => run.runtimeNodeId === context.node.id);
	const saved = savedItem ?? context.resumeOutputRefs;
	const outputRefs: WorkflowNodeOutputV1 = {
		protocolVersion: "1",
		executorRef: WORKFLOW_PIPELINE_RUN_EXECUTOR_REF,
		nodeId: context.node.id,
		executionMode: resolveWorkflowNodeExecutionMode(context.node) ?? "each",
		ports: saved?.ports ?? {},
		artifacts: saved?.artifacts ?? [],
		evidence: {
			...saved?.evidence,
			executorCompleted: false,
			pipelineFailure: { code: "workflow_pipeline_run_failed", message },
		},
		itemRuns: [],
	};
	return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: message,
		outputRefs: projectWorkflowAuthorRepairOutput(context.flowVersionData, outputRefs) };
}

function assertPipelineStepAdmission(
	context: WorkflowNodeExecutionContext,
	dependencies: WorkflowNodeExecutorDependencies,
	spec: WorkflowPipelineRunSpecV1,
): void {
	for (const step of spec.steps) {
		const executorRef = resolveWorkflowNodeExecutorRef(step.node);
		if (!executorRef) throw new Error(`Workflow pipeline step ${step.stepId} has no executorRef`);
		const unsupported = workflowNodeExecutionFailure(step.node);
		if (unsupported) {
			throw new Error("errorMessage" in unsupported
				? unsupported.errorMessage
				: `Workflow pipeline step ${step.stepId} is not executable`);
		}
		if (hasWorkflowPluginExecutorRefPrefix(executorRef) && !dependencies.pluginRuntimeRegistry) {
			throw new Error(`Workflow pipeline step ${step.stepId} has no admitted plugin runtime registry`);
		}
		if (!resolveFrozenStepSemantics(context, step.node)) {
			throw new Error(`Workflow pipeline step ${step.stepId} executor ${executorRef} has no registered execution semantics`);
		}
	}
}

export async function runWorkflowPipelineNode(
	context: WorkflowNodeExecutionContext,
	dependencies: WorkflowNodeExecutorDependencies,
	executeStep: ExecutePipelineStep,
): Promise<WorkflowNodeExecutionResult> {
	let spec: WorkflowPipelineRunSpecV1;
	try {
		assertPipelineExecutorRef(resolveWorkflowNodeExecutorRef(context.node));
		if (!Object.prototype.hasOwnProperty.call(context.node.data, "workflowPipeline")) {
			throw new Error(`Workflow pipeline node ${context.node.id} is missing workflowPipeline`);
		}
		spec = parseWorkflowPipelineRunSpec(context.node.data.workflowPipeline);
		validateDeclaredPipelineInputs(context, spec);
		assertPipelineStepAdmission(context, dependencies, spec);
	} catch (error: unknown) {
		return preservedPipelineErrorResult(context, error);
	}
	const restriction = workflowAuthorRepairRouteAt(context.flowVersionData, context.node.id);
	if (restriction && restriction.kind !== "step") throw new Error("workflow_author_repair_pipeline_route_invalid");
	const consumerSteps = workflowConsumerReplayStepsAt(context.flowVersionData, context.node.id);
	const steps = topologicalSteps(spec).filter(step => consumerSteps ? consumerSteps.includes(step.stepId) : !restriction || step.stepId === restriction.stepId);
	if (restriction && steps.length !== (consumerSteps?.length ?? 1)) throw new Error("workflow_author_repair_pipeline_step_missing");
	let stepReceipts: Readonly<Record<string, PipelineStepReceipt>> = priorPipelineState(context)?.steps ?? {};
	const persistCheckpoint = context.checkpointOutputRefs;
	context = {
		...context,
		checkpointOutputRefs: persistCheckpoint ? async (outputRefs) => {
			try {
				await persistCheckpoint(outputRefs);
			} catch (error: unknown) {
				throw new PipelineCheckpointFailure(error);
			}
		} : undefined,
	};
	try {
		for (const step of steps) {
			const existingReceipt = stepReceipts[step.stepId];
			if (existingReceipt?.status === "not_selected"
				|| (existingReceipt?.status === "success" && !shouldRevisitPartialStage(context, existingReceipt))) continue;
			if (!pipelineStepDependenciesSettled(step, spec, stepReceipts, context)) continue;
			const binding = stageStartInput({ context, step, stepReceipts, pipelineSpec: spec });
			if (!binding.active) {
				const required = readRequiredInputPorts(step.node);
				if (binding.inactiveStepSource || required.size > 0) {
					stepReceipts = markNotSelected(stepReceipts, step.stepId);
					const checkpoint = pipelineOutputRefs({
						context,
						steps,
						outputs: spec.outputs,
						stepReceipts,
						cursorStepId: pipelineCursorStepId(steps, stepReceipts),
						complete: false,
						externalCheck: workflowExternalPollAfter(WORKFLOW_PIPELINE_CHECKPOINT_POLL_MS),
					});
					await context.checkpointOutputRefs?.(checkpoint);
					continue;
				}
			}
			const stepNode = runtimeNode(context, step);
			const priorOutputRefs = stageReceiptOutputRefs(existingReceipt);
			const stageContext: WorkflowNodeExecutionContext = {
				...context,
				node: stepNode,
				inputs: omitUndefinedInputs(binding.inputs),
				// Inline stages have no workflow_node_runs input row. Retain the nearest
				// actual persisted parent's identity from context; only exact subtrees
				// found there can become read handles. Newly derived facts stay inline.
				runtimeParentNodeIds: [...(context.runtimeParentNodeIds ?? []), context.node.id],
				...(priorOutputRefs ? { resumeOutputRefs: priorOutputRefs } : { resumeOutputRefs: undefined }),
				resumeOnly: shouldResumeStage(context, step),
				checkpointOutputRefs: wrappedStageCheckpoint(context, steps, spec.outputs, stepReceipts, step.stepId,
					(outputRefs) => {
						stepReceipts = { ...stepReceipts, [step.stepId]: stageOutputReceipt("waiting_external", outputRefs) };
					}),
			};
			try {
				const result = await executeStep(stageContext, dependencies);
				const state = stageResultState({ result, stepId: step.stepId });
				stepReceipts = {
					...stepReceipts,
					[step.stepId]: state,
				};
				if (result.ok) {
					const checkpoint = pipelineOutputRefs({
						context,
						steps,
						outputs: spec.outputs,
						stepReceipts,
						cursorStepId: pipelineCursorStepId(steps, stepReceipts),
						complete: false,
						externalCheck: pipelineWaitingExternalCheck(steps, stepReceipts)
							?? workflowExternalPollAfter(WORKFLOW_PIPELINE_CHECKPOINT_POLL_MS),
					});
					await context.checkpointOutputRefs?.(checkpoint);
					continue;
				}
				if (result.waitingExternal === true) {
					const outputRefs = pipelineOutputRefs({
						context,
						steps,
						outputs: spec.outputs,
						stepReceipts,
						cursorStepId: step.stepId,
						complete: false,
						externalCheck: result.externalCheck,
					});
					await context.checkpointOutputRefs?.(outputRefs);
					continue;
				}
				const dependencyFailures = collectPipelineDependencyFailures({ stepId: step.stepId, bindings: spec.bindings, receipts: stepReceipts });
				const errorMessage = describePipelineDependencyFailure(result.errorMessage, dependencyFailures);
				const outputRefs = pipelineOutputRefs({
					context,
					steps,
					outputs: spec.outputs,
					stepReceipts,
					cursorStepId: step.stepId,
					complete: false,
					error: { code: result.errorCode, message: errorMessage, dependencyFailures },
				});
				return { ok: false, errorCode: result.errorCode, errorMessage, outputRefs };
			} catch (error: unknown) {
				if (error instanceof Error && error.name === "AbortError") throw error;
				if (error instanceof PipelineCheckpointFailure) throw error;
				const message = error instanceof Error ? error.message : String(error);
				const retainedOutputRefs = stepReceipts[step.stepId]?.outputRefs ?? priorOutputRefs;
				if (retainedOutputRefs && hasStageReconciliationReceipt(context, step, retainedOutputRefs)) {
					const scheduleMissing = retainedOutputRefs.externalCheck === undefined;
					const observation = {
						observedAt: new Date().toISOString(),
						name: error instanceof Error ? error.name : "UnknownError",
						message,
						...(isRecord(error) && typeof error.code === "string" ? { code: error.code } : {}),
						...(scheduleMissing ? { scheduleDiagnostic: "workflow_pipeline_accepted_receipt_schedule_missing" } : {}),
					};
					const previousObservations = retainedOutputRefs.evidence.pipelineStageObservationFailures;
					const outputRefs: WorkflowNodeOutputV1 = {
						...retainedOutputRefs,
						externalCheck: retainedOutputRefs.externalCheck ?? workflowExternalPollAfter(WORKFLOW_PIPELINE_CHECKPOINT_POLL_MS),
						evidence: {
							...retainedOutputRefs.evidence,
							pipelineStageObservationFailures: [
								...(Array.isArray(previousObservations) ? previousObservations : previousObservations === undefined ? [] : [previousObservations]),
								observation,
							],
						},
					};
					stepReceipts = { ...stepReceipts, [step.stepId]: stageOutputReceipt("waiting_external", outputRefs) };
					console.error(JSON.stringify({
						...observation, failureMessage: observation.message, message: "workflow_pipeline_stage_observation_failed",
						executionId: context.executionId, nodeId: context.node.id, stepId: step.stepId,
						resultLookup: resolveFrozenStepSemantics(context, step.node)?.resultLookup,
					}));
					continue;
				}
				stepReceipts = {
					...stepReceipts,
					[step.stepId]: {
						...(retainedOutputRefs ? stageOutputReceipt("failed", retainedOutputRefs) : { status: "failed" as const }),
						errorCode: "workflow_pipeline_step_threw",
						errorMessage: message,
					},
				};
				return pipelineErrorResult(context, steps, spec.outputs, stepReceipts, step.stepId, error,
					collectPipelineDependencyFailures({ stepId: step.stepId, bindings: spec.bindings, receipts: stepReceipts }));
			}
		}
		const waitingExternalCheck = pipelineWaitingExternalCheck(steps, stepReceipts);
		if (steps.some((step) => stepReceipts[step.stepId]?.status === "waiting_external")) {
			if (!waitingExternalCheck) {
				const waitingStep = steps.find((step) => stepReceipts[step.stepId]?.status === "waiting_external");
				return pipelineErrorResult(context, steps, spec.outputs, stepReceipts, waitingStep?.stepId ?? null,
					new Error(`Workflow pipeline waiting step ${waitingStep?.stepId ?? "unknown"} is missing an external-check schedule`));
			}
			const outputRefs = pipelineOutputRefs({
				context,
				steps,
				outputs: spec.outputs,
				stepReceipts,
				cursorStepId: pipelineCursorStepId(steps, stepReceipts),
				complete: false,
				externalCheck: waitingExternalCheck,
			});
			await context.checkpointOutputRefs?.(outputRefs);
			return workflowNodeWaiting(outputRefs, waitingExternalCheck);
		}
		const outputRefs = pipelineOutputRefs({
			context,
			steps,
			outputs: spec.outputs,
			stepReceipts,
			cursorStepId: null,
			complete: restriction ? steps.every(step => stepReceipts[step.stepId]?.status === "success")
				: Object.values(stepReceipts).every((receipt) => receipt.status === "success" || receipt.status === "not_selected"),
		});
		if (!outputRefs.evidence.executorCompleted) {
			return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: "Workflow pipeline ended before every frozen step was settled", outputRefs };
		}
		return { ok: true, outputRefs };
	} catch (error: unknown) {
		if (!(error instanceof PipelineCheckpointFailure)) throw error;
		const failure = {
			observedAt: new Date().toISOString(),
			message: error.message,
			errorCodes: readDatabaseErrorCodes(error.persistence),
			recoverable: error.persistence.recoverable,
		};
		console.error(JSON.stringify({
			...failure, failureMessage: failure.message, message: "workflow_pipeline_checkpoint_failed",
			executionId: context.executionId, nodeId: context.node.id,
		}));
		const externalCheck = workflowExternalPollAfter(5_000);
		const output = pipelineOutputRefs({ context, steps, outputs: spec.outputs, stepReceipts,
			cursorStepId: pipelineCursorStepId(steps, stepReceipts), complete: false, externalCheck });
		const outputRefs = { ...output, evidence: { ...output.evidence, checkpointPersistenceFailure: failure } };
		if (failure.recoverable) return workflowNodeWaiting(outputRefs, externalCheck);
		return { ok: false, errorCode: "workflow_node_runtime_failed", errorMessage: error.message, outputRefs };
	}
}
