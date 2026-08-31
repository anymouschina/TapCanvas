import { createHash } from "node:crypto";
import { AppError } from "../../middleware/error";
import {
	type CapabilityConflictReport,
	type WorkflowCapabilityDescriptor,
	WorkflowCapabilityDescriptorSchema,
} from "./capability-bay.schemas";
import { materializeWorkflowConfigurationInheritance } from "../execution/execution.workflow-configuration";
import {
	inspectVideoWorkflowCanvasDefinition,
} from "../execution/execution.video-workflow-definition-authority";

export {
	inspectVideoWorkflowCanvasDefinition,
	type VideoWorkflowCanvasDefinitionState,
} from "../execution/execution.video-workflow-definition-authority";

type JsonRecord = Record<string, unknown>;
type CapabilityConflict = CapabilityConflictReport["conflicts"][number];

type CapabilityFlowSource = {
	id: string;
	name: string;
	data: string;
	project_id: string | null;
	canvas_revision: number;
};

type CapabilityFlowVersionSource = {
	id: string;
	data: string;
};

function record(value: unknown): JsonRecord | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? value as JsonRecord
		: null;
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function stringList(values: Iterable<unknown>): string[] {
	return [...new Set([...values].map(stringValue).filter(Boolean))].sort();
}

function parseVersionData(value: string): JsonRecord {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error: unknown) {
		throw new AppError("工作流版本不是合法 JSON", {
			status: 500,
			code: "capability_storage_corrupt",
			details: { reason: error instanceof Error ? error.message : String(error) },
		});
	}
	return record(parsed) ?? {};
}

function canonicalJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const object = record(value);
	if (object) {
		return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function nodeData(node: unknown): JsonRecord {
	return record(record(node)?.data) ?? {};
}

function nodeId(node: unknown): string {
	return stringValue(record(node)?.id);
}

export function assertVideoWorkflowCanvasDefinitionCurrent(versionData: string): void {
	const state = inspectVideoWorkflowCanvasDefinition(versionData);
	if (!state.applicable || state.current) return;
	throw new AppError("一键成片工作流定义已过期，请先在工作流编辑器中升级到当前模板并重新添加", {
		status: 409,
		code: "capability_workflow_definition_outdated",
		terminal: true,
		details: state,
	});
}

function workflowExecutorRef(node: unknown): string {
	const data = nodeData(node);
	const spec = record(data.workflowAtomicSpec) ?? {};
	return stringValue(spec.executorRef) || stringValue(data.workflowExecutorRef);
}

export function deriveWorkflowInvocationContract(
	stages: readonly unknown[],
): WorkflowCapabilityDescriptor["invocation"] {
	const resolvedStages = materializeWorkflowConfigurationInheritance(stages);
	const sourceNode = resolvedStages.find((node) => {
		return workflowExecutorRef(node) === "tapcanvas.canvas.group.read/v1";
	});
	const sourceMode = sourceNode
		? stringValue(nodeData(sourceNode).workflowSourceMode) || "canvas_group"
		: "none";
	const requiredTriggerPayloadFields: string[] = [];
	if (sourceMode === "inline_text") {
		requiredTriggerPayloadFields.push("source");
	} else if (sourceMode === "canvas_group") {
		requiredTriggerPayloadFields.push("sourceGroupId");
	} else if (sourceMode !== "project_context" && sourceMode !== "none") {
		throw new AppError(`不支持的工作流来源模式：${sourceMode}`, {
			status: 409,
			code: "capability_workflow_source_mode_invalid",
			details: { sourceMode },
		});
	}
	const unpinnedVideoDeliveryContract = resolvedStages.some((node) => (
		workflowExecutorRef(node) === "agents.delivery.contract/v2"
		&& !stringValue(nodeData(node).workflowVideoModelKey)
	));
	if (unpinnedVideoDeliveryContract) requiredTriggerPayloadFields.push("videoModelKey");
	const imageNodes = resolvedStages.filter((node) => (
		workflowExecutorRef(node) === "tapcanvas.image.generate/v1"
	));
	if (imageNodes.some((node) => !stringValue(nodeData(node).workflowImageModelKey))) {
		requiredTriggerPayloadFields.push("imageModelKey");
	}
	if (imageNodes.some((node) => !stringValue(nodeData(node).workflowImageAspectRatio))) {
		requiredTriggerPayloadFields.push("imageAspectRatio");
	}
	if (imageNodes.some((node) => !stringValue(nodeData(node).workflowImageSize))) {
		requiredTriggerPayloadFields.push("imageSize");
	}
	const videoEstimateNodes = resolvedStages.filter((node) => (
		workflowExecutorRef(node) === "video.estimate/v1"
	));
	if (videoEstimateNodes.some((node) => !stringValue(nodeData(node).workflowVideoModelKey))) {
		requiredTriggerPayloadFields.push("videoModelKey");
	}
	if (videoEstimateNodes.some((node) => !stringValue(nodeData(node).workflowVideoResolution))) {
		requiredTriggerPayloadFields.push("videoResolution");
	}
	if (videoEstimateNodes.some((node) => !stringValue(nodeData(node).workflowVideoAspectRatio))) {
		requiredTriggerPayloadFields.push("videoAspectRatio");
	}
	const executionVariants = stringList(resolvedStages.map((node) => nodeData(node).workflowExecutionVariant));
	const executionVariant = executionVariants.length === 1
		&& (executionVariants[0] === "full_video" || executionVariants[0] === "first_video")
		? executionVariants[0]
		: undefined;
	return {
		sourceMode,
		requiredTriggerPayloadFields: [...new Set(requiredTriggerPayloadFields)],
		...(executionVariant ? { executionVariant } : {}),
	};
}

export function deriveWorkflowInvocationContractFromVersionData(
	versionData: string,
): WorkflowCapabilityDescriptor["invocation"] {
	const root = parseVersionData(versionData);
	const nodes = Array.isArray(root.nodes) ? root.nodes : [];
	const workflowNodes = nodes.filter((node) => {
		const kind = stringValue(nodeData(node).kind);
		return kind === "workflowTrigger" || kind === "workflowStage" || kind === "workflowOutput";
	});
	return deriveWorkflowInvocationContract(workflowNodes);
}

export function capabilityDescriptorSha256(value: WorkflowCapabilityDescriptor): string {
	return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function buildWorkflowCapabilityDescriptor(input: {
	flow: CapabilityFlowSource;
	version: CapabilityFlowVersionSource;
}): WorkflowCapabilityDescriptor {
	const root = parseVersionData(input.version.data);
	const nodes = Array.isArray(root.nodes) ? root.nodes : [];
	const workflowNodes = nodes.filter((node) => {
		const kind = stringValue(nodeData(node).kind);
		return kind === "workflowTrigger" || kind === "workflowStage";
	});
	const triggers = workflowNodes.filter((node) => stringValue(nodeData(node).kind) === "workflowTrigger");
	if (triggers.length !== 1) {
		throw new AppError("只有包含且仅包含一个工作流触发器的画布才能装配给小T", {
			status: 409,
			code: "capability_workflow_trigger_invalid",
			details: { flowId: input.flow.id, triggerCount: triggers.length },
		});
	}
	const stages = workflowNodes.filter((node) => stringValue(nodeData(node).kind) === "workflowStage");
	if (stages.length === 0) {
		throw new AppError("空工作流不能装配给小T", {
			status: 409,
			code: "capability_workflow_empty",
			details: { flowId: input.flow.id },
		});
	}

	const specs = stages.map((node) => record(nodeData(node).workflowAtomicSpec) ?? {});
	const operations = stringList(specs.map((spec) => spec.operation));
	const requiredSkills = stringList(stages.flatMap((node) => {
		const data = nodeData(node);
		return [
			...(Array.isArray(data.workflowRequiredSkills) ? data.workflowRequiredSkills : []),
			data.workflowSkillId,
			data.skillId,
			record(data.workflowAtomicSpec)?.skillId,
		];
	}));
	const requiredTools = stringList(stages.flatMap((node) => {
		const data = nodeData(node);
		return [
			...(Array.isArray(data.workflowAllowedTools) ? data.workflowAllowedTools : []),
			data.toolId,
			record(data.workflowAtomicSpec)?.toolId,
			data.workflowToolId,
			data.workflowToolName,
		];
	}));
	const outputArtifacts = stringList(stages.flatMap((node) => {
		const data = nodeData(node);
		const spec = record(data.workflowAtomicSpec);
		return [
			...(Array.isArray(data.workflowOutputPorts) ? data.workflowOutputPorts : []),
			...(Array.isArray(spec?.outputPorts) ? spec.outputPorts : []),
			data.outputArtifactType,
			data.agentOutputArtifactType,
			data.workflowOutputArtifactType,
			spec?.outputArtifactType,
		];
	}));
	const inputArtifacts = stringList(stages.flatMap((node) => {
		const data = nodeData(node);
		const spec = record(data.workflowAtomicSpec);
		return [
			...(Array.isArray(data.workflowInputPorts) ? data.workflowInputPorts : []),
			...(Array.isArray(spec?.inputPorts) ? spec.inputPorts : []),
		];
	}));
	const paidGeneration = operations.some((operation) => operation === "image_generate" || operation === "video_generate" || operation === "video_submission");
	const externalMutation = operations.some((operation) => operation === "tool_invocation" || operation === "concat" || operation === "video_submission");
	const permissions = stringList([
		"project:read",
		"canvas:read",
		...(externalMutation || paidGeneration ? ["canvas:write", "asset:write"] : []),
		...(paidGeneration ? ["media:generate:paid"] : []),
		"workflow:invoke",
	]);
	const sideEffects: WorkflowCapabilityDescriptor["sideEffects"] = [];
	if (!externalMutation && !paidGeneration) sideEffects.push("none");
	if (externalMutation) sideEffects.push("external_mutation");
	if (paidGeneration) sideEffects.push("paid_generation");
	const semanticEvidence = stages.slice(0, 48).map((node) => {
		const data = nodeData(node);
		const spec = record(data.workflowAtomicSpec) ?? {};
		return {
			label: stringValue(data.label) || nodeId(node),
			description: stringValue(data.description) || stringValue(spec.description),
			operation: stringValue(spec.operation) || stringValue(data.workflowNodeKind),
		};
	});
	const authoredSummary = stringValue(nodeData(triggers[0]).workflowCapabilityDescription)
		|| stringValue(root.workflowCapabilityDescription);
	const invocation = deriveWorkflowInvocationContract(stages);

	return WorkflowCapabilityDescriptorSchema.parse({
		protocolVersion: "tapcanvas.agent-capability/v1",
		capabilityId: `workflow:${input.flow.id}`,
		kind: "workflow",
		name: input.flow.name,
		summary: authoredSummary || semanticEvidence.map((item) => item.description).filter(Boolean).slice(0, 3).join("；"),
		sourceId: input.flow.id,
		sourceVersionId: input.version.id,
		sourceRevision: input.flow.canvas_revision,
		projectId: input.flow.project_id,
		triggerNodeId: nodeId(triggers[0]),
		nodeCount: workflowNodes.length,
		operations,
		requiredSkills,
		requiredTools,
		inputArtifacts,
		outputArtifacts,
		invocation,
		permissions,
		sideEffects,
		semanticEvidence,
	});
}

/**
 * A workflow cannot compete with a Skill that its frozen graph explicitly
 * declares as a runtime dependency. Semantic analysis may still describe the
 * shared responsibility as a primary-route conflict; the machine dependency
 * is authoritative and deterministically classifies that relationship as
 * delegation, so it must not become a replacement choice.
 */
export function workflowCapabilityDescriptorsShareInvocationRoute(
	left: WorkflowCapabilityDescriptor,
	right: WorkflowCapabilityDescriptor,
): boolean {
	const leftVariant = left.invocation?.executionVariant;
	const rightVariant = right.invocation?.executionVariant;
	return !leftVariant || !rightVariant || leftVariant === rightVariant;
}

/**
 * Removes relationships that cannot compete for the same invocation route.
 *
 * Explicit execution variants are server-selected before the workflow tool is
 * exposed. Two workflows pinned to different variants therefore coexist even
 * when they intentionally share the same outputs and low-level tools. A
 * workflow's declared Skill dependencies are likewise delegation, not a
 * primary-route replacement choice.
 */
export function omitNonCompetingCapabilityConflicts(
	target: WorkflowCapabilityDescriptor,
	existingDescriptors: readonly WorkflowCapabilityDescriptor[],
	conflicts: readonly CapabilityConflict[],
): CapabilityConflict[] {
	const dependencies = new Set(target.requiredSkills);
	const existingByCapabilityId = new Map(existingDescriptors.map((descriptor) => (
		[descriptor.capabilityId, descriptor] as const
	)));
	return conflicts.filter((conflict) => {
		if (conflict.withCapabilityId === null) return true;
		const existing = existingByCapabilityId.get(conflict.withCapabilityId);
		if (existing && !workflowCapabilityDescriptorsShareInvocationRoute(target, existing)) {
			return false;
		}
		return !(
			conflict.resolutionMode === "choose_primary" &&
			dependencies.has(conflict.withCapabilityId)
		);
	});
}

export function detectStructuralCapabilityConflicts(
	target: WorkflowCapabilityDescriptor,
	existingDescriptors: readonly WorkflowCapabilityDescriptor[],
): CapabilityConflict[] {
	const conflicts: CapabilityConflict[] = [];
	for (const existing of existingDescriptors) {
		if (existing.sourceId === target.sourceId) {
			if (existing.sourceVersionId !== target.sourceVersionId) conflicts.push({
				id: `version:${existing.capabilityId}`,
				severity: "info",
				category: "version_change",
				withCapabilityId: existing.capabilityId,
				resolutionMode: "acknowledge",
				title: "将更新已装配版本",
				rationale: `当前装配版本 ${existing.sourceVersionId}，待装配版本 ${target.sourceVersionId}。`,
				resolution: "确认后原位更新；历史工作流版本不会被覆盖。",
			});
			continue;
		}
		if (!workflowCapabilityDescriptorsShareInvocationRoute(target, existing)) continue;
		const sharedOutputs = target.outputArtifacts.filter((item) => existing.outputArtifacts.includes(item));
		const sharedTools = target.requiredTools.filter((item) => existing.requiredTools.includes(item));
		if (sharedOutputs.length === 0 && sharedTools.length === 0) continue;
		conflicts.push({
			id: `functional:${existing.capabilityId}`,
			severity: "warning",
			category: "functional_overlap",
			withCapabilityId: existing.capabilityId,
			resolutionMode: "choose_primary",
			title: `与“${existing.name}”存在功能重叠`,
			rationale: [
				sharedOutputs.length ? `共同输出：${sharedOutputs.join("、")}` : "",
				sharedTools.length ? `共同工具：${sharedTools.join("、")}` : "",
			].filter(Boolean).join("；"),
			resolution: "必须选择一个主能力：用当前工作流替换已装配工作流，或保留原能力并取消本次装配。",
		});
	}
	return conflicts;
}

type BuiltInCapabilityDescriptor = Readonly<{
	id: string;
	name: string;
	requiredTools: readonly string[];
	replaceable?: boolean;
}>;

function toolBelongsToBuiltInFamily(workflowTool: string, builtInTool: string): boolean {
	if (workflowTool === builtInTool) return true;
	const family = builtInTool.startsWith("tapcanvas_")
		? builtInTool.slice("tapcanvas_".length)
		: builtInTool;
	return family.length > 0 && workflowTool.startsWith(`${family}.`);
}

/**
 * Finds machine-verifiable overlap between a frozen workflow and a built-in
 * product capability. The comparison is protocol-based and never inspects
 * workflow names or prompt text.
 */
export function detectBuiltInCapabilityConflicts(
	target: WorkflowCapabilityDescriptor,
	builtInCapabilities: readonly BuiltInCapabilityDescriptor[],
): CapabilityConflict[] {
	return builtInCapabilities.flatMap((builtIn) => {
		// Foundational capabilities, such as the low-level media generators, are
		// allowed to be used by a workflow but cannot be replaced by it. Keeping
		// them out of the conflict report also prevents a stale route decision from
		// hiding the primitive from the runtime tool surface.
		if (builtIn.replaceable === false) return [];
		const sharedToolFamilies = builtIn.requiredTools.filter((builtInTool) => (
			target.requiredTools.some((workflowTool) => toolBelongsToBuiltInFamily(workflowTool, builtInTool))
		));
		if (sharedToolFamilies.length === 0) return [];
		return [{
			id: `functional:${builtIn.id}`,
			severity: "warning" as const,
			category: "functional_overlap" as const,
			withCapabilityId: builtIn.id,
			resolutionMode: "choose_primary" as const,
			title: `与“${builtIn.name}”存在主路径重叠`,
			rationale: `冻结工作流与该内置能力使用同一执行工具族：${sharedToolFamilies.join("、")}。`,
			resolution: "必须选择一个端到端主能力；工作流内部仍可调用该工具族完成已冻结节点。",
		}];
	});
}
