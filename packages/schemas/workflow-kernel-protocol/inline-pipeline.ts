/**
 * Immutable inline pipeline definitions are part of Workflow IR. The executor
 * runs this graph once for the current outer item and checkpoints each frozen
 * node independently; the protocol contains no domain-specific control flow.
 */
export const WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION = "workflow.pipeline.run/v1" as const;
export const WORKFLOW_PIPELINE_RUN_EXECUTOR_REF = WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION;

/** Assert that a runtime dispatch is for the generic inline-pipeline executor. */
export function assertPipelineExecutorRef(value: unknown): asserts value is typeof WORKFLOW_PIPELINE_RUN_EXECUTOR_REF {
	if (value !== WORKFLOW_PIPELINE_RUN_EXECUTOR_REF) {
		throw new Error(`Workflow pipeline executorRef must equal ${WORKFLOW_PIPELINE_RUN_EXECUTOR_REF}`);
	}
}

export type WorkflowPipelineValueModeV1 = "value" | "collection";

export type WorkflowPipelineInputV1 = Readonly<{
	portId: string;
	mode: WorkflowPipelineValueModeV1;
	/** Outer node port contract, before an `each` input is unboxed. */
	artifactTypes: readonly string[];
	/** Element contract visible to `value` bindings after the outer collection is unboxed. */
	itemArtifactTypes?: readonly string[];
}>;

export type WorkflowPipelineNodeSnapshotV1 = Readonly<{
	id: string;
	type: string;
	kind: string;
	data: Readonly<Record<string, unknown>>;
}>;

export type WorkflowPipelineStepV1 = Readonly<{
	stepId: string;
	node: WorkflowPipelineNodeSnapshotV1;
}>;

export type WorkflowPipelineSourceV1 = Readonly<
	| { kind: "input"; portId: string }
	| { kind: "step"; stepId: string; portId: string }
>;

export type WorkflowPipelineStepPortV1 = Readonly<{
	stepId: string;
	portId: string;
}>;

export type WorkflowPipelineBindingV1 = Readonly<{
	from: WorkflowPipelineSourceV1;
	to: WorkflowPipelineStepPortV1;
	/** `collection` wraps a scalar in one item and passes a collection through unchanged. */
	mode: WorkflowPipelineValueModeV1;
}>;

export type WorkflowPipelineOutputV1 = Readonly<{
	portId: string;
	from: WorkflowPipelineStepPortV1;
	mode: WorkflowPipelineValueModeV1;
}>;

export type WorkflowPipelineRunSpecV1 = Readonly<{
	protocolVersion: typeof WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION;
	inputs: readonly WorkflowPipelineInputV1[];
	steps: readonly WorkflowPipelineStepV1[];
	bindings: readonly WorkflowPipelineBindingV1[];
	outputs: readonly WorkflowPipelineOutputV1[];
}>;

export type WorkflowPipelinePortArtifactContractV1 = Readonly<{
	inputArtifactTypes: Readonly<Record<string, readonly string[]>>;
	outputArtifactTypes: Readonly<Record<string, readonly string[]>>;
}>;

type RecordValue = Record<string, unknown>;

function requireRecord(value: unknown, field: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${field} must be an object`);
	}
	return value as RecordValue;
}

function requireText(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
	return value.trim();
}

function readPortIds(value: unknown, field: string): readonly string[] {
	if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
	const portIds = value.map((portId, index) => requireText(portId, `${field}[${index}]`));
	if (new Set(portIds).size !== portIds.length) throw new Error(`${field} must contain unique port ids`);
	return portIds;
}

function readArtifactTypes(value: unknown, field: string): readonly string[] {
	if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
	const artifactTypes = value.map((artifactType, index) => requireText(artifactType, `${field}[${index}]`));
	if (new Set(artifactTypes).size !== artifactTypes.length) throw new Error(`${field} must contain unique artifact types`);
	return artifactTypes;
}

function requireMode(value: unknown, field: string): WorkflowPipelineValueModeV1 {
	if (value !== "value" && value !== "collection") throw new Error(`${field} must be value or collection`);
	return value;
}

function cloneJsonValue(value: unknown, field: string, seen: WeakSet<object>): unknown {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error(`${field} must contain only finite numbers`);
		return value;
	}
	if (Array.isArray(value)) {
		if (seen.has(value)) throw new Error(`${field} must not contain cycles`);
		seen.add(value);
		const copy = value.map((item, index) => cloneJsonValue(item, `${field}[${index}]`, seen));
		seen.delete(value);
		return Object.freeze(copy);
	}
	if (typeof value === "object") {
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new Error(`${field} must contain plain JSON objects`);
		}
		if (seen.has(value)) throw new Error(`${field} must not contain cycles`);
		seen.add(value);
		const record = value as RecordValue;
		const copy: RecordValue = {};
		for (const [key, item] of Object.entries(record)) {
			if (item === undefined) throw new Error(`${field}.${key} must not be undefined`);
			copy[key] = cloneJsonValue(item, `${field}.${key}`, seen);
		}
		seen.delete(value);
		return Object.freeze(copy);
	}
	throw new Error(`${field} must contain only JSON values`);
}

function parseInput(value: unknown, index: number): WorkflowPipelineInputV1 {
	const input = requireRecord(value, `Workflow pipeline inputs[${index}]`);
	const itemArtifactTypes = input.itemArtifactTypes === undefined
		? undefined
		: readArtifactTypes(input.itemArtifactTypes, `Workflow pipeline inputs[${index}].itemArtifactTypes`);
	return Object.freeze({
		portId: requireText(input.portId, `Workflow pipeline inputs[${index}].portId`),
		mode: requireMode(input.mode, `Workflow pipeline inputs[${index}].mode`),
		artifactTypes: readArtifactTypes(input.artifactTypes, `Workflow pipeline inputs[${index}].artifactTypes`),
		...(itemArtifactTypes === undefined ? {} : { itemArtifactTypes }),
	});
}

function parseNodeSnapshot(value: unknown, field: string): WorkflowPipelineNodeSnapshotV1 {
	const node = requireRecord(value, field);
	const data = requireRecord(node.data, `${field}.data`);
	const atomicSpec = requireRecord(data.workflowAtomicSpec, `${field}.data.workflowAtomicSpec`);
	if (atomicSpec.version !== 1) throw new Error(`${field}.data.workflowAtomicSpec.version must be 1`);
	if (!new Set(["once", "each", "collect"]).has(String(atomicSpec.executionMode))) {
		throw new Error(`${field}.data.workflowAtomicSpec.executionMode is invalid`);
	}
	const inputPorts = readPortIds(atomicSpec.inputPorts, `${field}.data.workflowAtomicSpec.inputPorts`);
	const outputPorts = readPortIds(atomicSpec.outputPorts, `${field}.data.workflowAtomicSpec.outputPorts`);
	const nodeInputPorts = data.workflowInputPorts === undefined
		? inputPorts
		: readPortIds(data.workflowInputPorts, `${field}.data.workflowInputPorts`);
	const nodeOutputPorts = data.workflowOutputPorts === undefined
		? outputPorts
		: readPortIds(data.workflowOutputPorts, `${field}.data.workflowOutputPorts`);
	if (nodeInputPorts.length !== inputPorts.length || nodeInputPorts.some((portId, index) => portId !== inputPorts[index])) {
		throw new Error(`${field} workflowInputPorts disagree with workflowAtomicSpec.inputPorts`);
	}
	if (nodeOutputPorts.length !== outputPorts.length || nodeOutputPorts.some((portId, index) => portId !== outputPorts[index])) {
		throw new Error(`${field} workflowOutputPorts disagree with workflowAtomicSpec.outputPorts`);
	}
	const selectiveOutputPorts = atomicSpec.selectiveOutputPorts === undefined
		? []
		: readPortIds(atomicSpec.selectiveOutputPorts, `${field}.data.workflowAtomicSpec.selectiveOutputPorts`);
	if (selectiveOutputPorts.some((portId) => !outputPorts.includes(portId))) {
		throw new Error(`${field}.data.workflowAtomicSpec.selectiveOutputPorts must refer to declared output ports`);
	}
	const clonedData = cloneJsonValue(data, `${field}.data`, new WeakSet<object>()) as Readonly<Record<string, unknown>>;
	return Object.freeze({
		id: requireText(node.id, `${field}.id`),
		type: requireText(node.type, `${field}.type`),
		kind: requireText(node.kind, `${field}.kind`),
		data: clonedData,
	});
}

function parseStep(value: unknown, index: number): WorkflowPipelineStepV1 {
	const step = requireRecord(value, `Workflow pipeline steps[${index}]`);
	const stepId = requireText(step.stepId, `Workflow pipeline steps[${index}].stepId`);
	return Object.freeze({
		stepId,
		node: parseNodeSnapshot(step.node, `Workflow pipeline steps[${index}].node`),
	});
}

function parseSource(value: unknown, field: string): WorkflowPipelineSourceV1 {
	const source = requireRecord(value, field);
	if (source.kind === "input") {
		return Object.freeze({ kind: "input", portId: requireText(source.portId, `${field}.portId`) });
	}
	if (source.kind === "step") {
		return Object.freeze({
			kind: "step",
			stepId: requireText(source.stepId, `${field}.stepId`),
			portId: requireText(source.portId, `${field}.portId`),
		});
	}
	throw new Error(`${field}.kind must be input or step`);
}

function parseStepPort(value: unknown, field: string): WorkflowPipelineStepPortV1 {
	const port = requireRecord(value, field);
	return Object.freeze({
		stepId: requireText(port.stepId, `${field}.stepId`),
		portId: requireText(port.portId, `${field}.portId`),
	});
}

function parseBinding(value: unknown, index: number): WorkflowPipelineBindingV1 {
	const binding = requireRecord(value, `Workflow pipeline bindings[${index}]`);
	return Object.freeze({
		from: parseSource(binding.from, `Workflow pipeline bindings[${index}].from`),
		to: parseStepPort(binding.to, `Workflow pipeline bindings[${index}].to`),
		mode: requireMode(binding.mode, `Workflow pipeline bindings[${index}].mode`),
	});
}

function parseOutput(value: unknown, index: number): WorkflowPipelineOutputV1 {
	const output = requireRecord(value, `Workflow pipeline outputs[${index}]`);
	return Object.freeze({
		portId: requireText(output.portId, `Workflow pipeline outputs[${index}].portId`),
		from: parseStepPort(output.from, `Workflow pipeline outputs[${index}].from`),
		mode: requireMode(output.mode, `Workflow pipeline outputs[${index}].mode`),
	});
}

function outputArtifactTypes(node: WorkflowPipelineNodeSnapshotV1, portId: string): readonly string[] {
	const data = node.data as RecordValue;
	const atomicSpec = data.workflowAtomicSpec as RecordValue;
	const declared = atomicSpec.outputArtifactTypes;
	if (declared && typeof declared === "object" && !Array.isArray(declared)) {
		const value = (declared as RecordValue)[portId];
		if (value !== undefined) return readArtifactTypes(value, `${node.id}.outputArtifactTypes.${portId}`);
	}
	for (const field of ["workflowAgentOutputArtifactType", "workflowOutputArtifactType"] as const) {
		const artifactType = data[field];
		if (typeof artifactType === "string" && artifactType.trim()) return [artifactType.trim()];
	}
	return [];
}

function inputArtifactTypes(node: WorkflowPipelineNodeSnapshotV1, portId: string): readonly string[] {
	const atomicSpec = (node.data as RecordValue).workflowAtomicSpec as RecordValue;
	const declared = atomicSpec.inputArtifactTypes;
	if (!declared || typeof declared !== "object" || Array.isArray(declared)) return [];
	const value = (declared as RecordValue)[portId];
	return value === undefined ? [] : readArtifactTypes(value, `${node.id}.inputArtifactTypes.${portId}`);
}

function portIds(node: WorkflowPipelineNodeSnapshotV1, direction: "input" | "output"): readonly string[] {
	const atomicSpec = (node.data as RecordValue).workflowAtomicSpec as RecordValue;
	return readPortIds(atomicSpec[`${direction}Ports`], `${node.id}.workflowAtomicSpec.${direction}Ports`);
}

/** Parse, validate and freeze one reusable item-scoped Workflow IR subgraph. */
export function parseWorkflowPipelineRunSpec(value: unknown): WorkflowPipelineRunSpecV1 {
	const record = requireRecord(value, "Workflow pipeline spec");
	if (record.protocolVersion !== WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION) {
		throw new Error(`Workflow pipeline protocolVersion must be ${WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION}`);
	}
	if (!Array.isArray(record.inputs) || record.inputs.length === 0) throw new Error("Workflow pipeline requires inputs");
	if (!Array.isArray(record.steps) || record.steps.length === 0) throw new Error("Workflow pipeline requires steps");
	if (!Array.isArray(record.bindings)) throw new Error("Workflow pipeline bindings must be an array");
	if (!Array.isArray(record.outputs) || record.outputs.length === 0) throw new Error("Workflow pipeline requires outputs");

	const inputs = record.inputs.map(parseInput);
	const steps = record.steps.map(parseStep);
	const bindings = record.bindings.map(parseBinding);
	const outputs = record.outputs.map(parseOutput);
	const inputById = new Map(inputs.map((input) => [input.portId, input]));
	const stepById = new Map(steps.map((step) => [step.stepId, step]));
	if (inputById.size !== inputs.length) throw new Error("Workflow pipeline input port ids must be unique");
	if (stepById.size !== steps.length) throw new Error("Workflow pipeline step ids must be unique");
	const nodeIds = new Set<string>();
	for (const step of steps) {
		if (nodeIds.has(step.node.id)) throw new Error("Workflow pipeline node snapshot ids must be unique");
		nodeIds.add(step.node.id);
	}
	const outputIds = outputs.map((output) => output.portId);
	if (new Set(outputIds).size !== outputIds.length) throw new Error("Workflow pipeline output port ids must be unique");

	const targetKeys = new Set<string>();
	const usedInputIds = new Set<string>();
	const adjacency = new Map(steps.map((step) => [step.stepId, new Set<string>()]));
	const indegree = new Map(steps.map((step) => [step.stepId, 0]));
	for (const binding of bindings) {
		const targetStep = stepById.get(binding.to.stepId);
		if (!targetStep) throw new Error(`Workflow pipeline binding target step ${binding.to.stepId} does not exist`);
		if (!portIds(targetStep.node, "input").includes(binding.to.portId)) {
			throw new Error(`Workflow pipeline target ${binding.to.stepId}.${binding.to.portId} is not a declared input port`);
		}
		const targetKey = `${binding.to.stepId}\u0000${binding.to.portId}`;
		if (targetKeys.has(targetKey)) throw new Error(`Workflow pipeline target ${binding.to.stepId}.${binding.to.portId} has multiple bindings`);
		targetKeys.add(targetKey);
		const destinationTypes = inputArtifactTypes(targetStep.node, binding.to.portId);
		if (binding.from.kind === "input") {
			const input = inputById.get(binding.from.portId);
			if (!input) throw new Error(`Workflow pipeline input ${binding.from.portId} does not exist`);
			usedInputIds.add(input.portId);
			const sourceTypes = binding.mode === "collection"
				? input.artifactTypes
				: input.itemArtifactTypes ?? input.artifactTypes;
			assertArtifactTypesCompatible(sourceTypes, destinationTypes, `input ${input.portId} → ${binding.to.stepId}.${binding.to.portId}`);
		} else {
			const sourceStep = stepById.get(binding.from.stepId);
			if (!sourceStep) throw new Error(`Workflow pipeline binding source step ${binding.from.stepId} does not exist`);
			const sourceTypes = outputArtifactTypes(sourceStep.node, binding.from.portId);
			if (!portIds(sourceStep.node, "output").includes(binding.from.portId)) {
				throw new Error(`Workflow pipeline source ${binding.from.stepId}.${binding.from.portId} is not a declared output port`);
			}
			assertArtifactTypesCompatible(sourceTypes, destinationTypes, `${binding.from.stepId}.${binding.from.portId} → ${binding.to.stepId}.${binding.to.portId}`);
			const destinations = adjacency.get(binding.from.stepId);
			if (!destinations) throw new Error(`Workflow pipeline source step ${binding.from.stepId} is unavailable`);
			if (!destinations.has(binding.to.stepId)) {
				destinations.add(binding.to.stepId);
				indegree.set(binding.to.stepId, (indegree.get(binding.to.stepId) ?? 0) + 1);
			}
		}
	}
	if (usedInputIds.size !== inputs.length) throw new Error("Every Workflow pipeline input must be bound at least once");
	for (const step of steps) {
		const data = step.node.data as RecordValue;
		const atomicSpec = data.workflowAtomicSpec as RecordValue;
		const optional = atomicSpec.optionalInputPorts === undefined
			? []
			: readPortIds(atomicSpec.optionalInputPorts, `${step.stepId}.workflowAtomicSpec.optionalInputPorts`);
		if (optional.some((portId) => !portIds(step.node, "input").includes(portId))) {
			throw new Error(`Workflow pipeline step ${step.stepId} has an undeclared optional input port`);
		}
		for (const portId of portIds(step.node, "input")) {
			if (!optional.includes(portId) && !targetKeys.has(`${step.stepId}\u0000${portId}`)) {
				throw new Error(`Workflow pipeline required input ${step.stepId}.${portId} has no binding`);
			}
		}
	}
	const ready = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([stepId]) => stepId);
	let visitedCount = 0;
	while (ready.length > 0) {
		const stepId = ready.shift();
		if (!stepId) continue;
		visitedCount += 1;
		for (const targetStepId of adjacency.get(stepId) ?? []) {
			const nextDegree = (indegree.get(targetStepId) ?? 0) - 1;
			indegree.set(targetStepId, nextDegree);
			if (nextDegree === 0) ready.push(targetStepId);
		}
	}
	if (visitedCount !== steps.length) throw new Error("Workflow pipeline bindings must form an acyclic graph");

	for (const output of outputs) {
		const sourceStep = stepById.get(output.from.stepId);
		if (!sourceStep) throw new Error(`Workflow pipeline output source step ${output.from.stepId} does not exist`);
		if (!portIds(sourceStep.node, "output").includes(output.from.portId)) {
			throw new Error(`Workflow pipeline output source ${output.from.stepId}.${output.from.portId} is not a declared output port`);
		}
	}
	const stepsOnOutputPath = new Set(outputs.map((output) => output.from.stepId));
	let changed = true;
	while (changed) {
		changed = false;
		for (const binding of bindings) {
			if (binding.from.kind === "step" && stepsOnOutputPath.has(binding.to.stepId) && !stepsOnOutputPath.has(binding.from.stepId)) {
				stepsOnOutputPath.add(binding.from.stepId);
				changed = true;
			}
		}
	}
	if (stepsOnOutputPath.size !== steps.length) throw new Error("Every Workflow pipeline step must contribute to a declared output path");
	for (const output of outputs) {
		if (inputById.has(output.portId)) throw new Error(`Workflow pipeline output ${output.portId} conflicts with an input port`);
	}

	return Object.freeze({
		protocolVersion: WORKFLOW_PIPELINE_RUN_PROTOCOL_VERSION,
		inputs: Object.freeze(inputs),
		steps: Object.freeze(steps),
		bindings: Object.freeze(bindings),
		outputs: Object.freeze(outputs),
	});
}

function assertArtifactTypesCompatible(source: readonly string[], destination: readonly string[], field: string): void {
	if (source.length === 0 || destination.length === 0) return;
	if (!source.some((artifactType) => destination.includes(artifactType))) {
		throw new Error(`Workflow pipeline artifact types do not match for ${field}`);
	}
}

/** Derive the generic pipeline executor's public typed ports from its frozen IR. */
export function deriveWorkflowPipelinePortArtifactContractV1(value: unknown): WorkflowPipelinePortArtifactContractV1 {
	const spec = parseWorkflowPipelineRunSpec(value);
	const inputArtifactTypes = Object.fromEntries(spec.inputs.flatMap((input) => (
		input.artifactTypes.length > 0 ? [[input.portId, input.artifactTypes] as const] : []
	)));
	const stepById = new Map(spec.steps.map((step) => [step.stepId, step]));
	const outputArtifactTypes = Object.fromEntries(spec.outputs.flatMap((output) => {
		const step = stepById.get(output.from.stepId);
		if (!step) return [];
		const types = outputArtifactTypesForNode(step.node, output.from.portId);
		return types.length > 0 ? [[output.portId, types] as const] : [];
	}));
	return Object.freeze({
		inputArtifactTypes: Object.freeze(inputArtifactTypes),
		outputArtifactTypes: Object.freeze(outputArtifactTypes),
	});
}

function outputArtifactTypesForNode(node: WorkflowPipelineNodeSnapshotV1, portId: string): readonly string[] {
	const data = node.data as RecordValue;
	const atomicSpec = data.workflowAtomicSpec as RecordValue;
	const outputTypes = atomicSpec.outputArtifactTypes;
	if (outputTypes && typeof outputTypes === "object" && !Array.isArray(outputTypes)) {
		const value = (outputTypes as RecordValue)[portId];
		if (value !== undefined) return readArtifactTypes(value, `${node.id}.outputArtifactTypes.${portId}`);
	}
	for (const field of ["workflowAgentOutputArtifactType", "workflowOutputArtifactType"] as const) {
		const artifactType = data[field];
		if (typeof artifactType === "string" && artifactType.trim()) return [artifactType.trim()];
	}
	return [];
}
