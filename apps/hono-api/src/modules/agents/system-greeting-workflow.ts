import type { PrismaClient } from "@prisma/client";
import {
	buildWorkflowCapabilityDescriptor,
	capabilityDescriptorSha256,
} from "./capability-bay.descriptor";
import { CapabilityConflictReportSchema } from "./capability-bay.schemas";

export const BUILTIN_GREETING_WORKFLOW = Object.freeze({
	// This is the stable workflow identity. Definition revisions are represented by
	// workflowDefinitionVersion and flowVersionId, not by changing this key.
	id: "tapcanvas.builtin.greeting-fixed-reply/v1",
	projectId: "00000000-0000-4000-8000-000000000101",
	flowId: "00000000-0000-4000-8000-000000000102",
	flowVersionId: "00000000-0000-4000-8000-000000000105",
	attachmentId: "00000000-0000-4000-8000-000000000104",
	triggerNodeId: "builtin-greeting:manual-trigger",
	textNodeId: "builtin-greeting:fixed-text",
	outputNodeId: "builtin-greeting:output",
	reply: "我是你爹",
	releasedAt: "2026-08-31T08:00:00.000Z",
});

type BuiltInGreetingDefinition = Readonly<{
	projectName: string;
	flowName: string;
	flowData: string;
}>;

export function createBuiltInGreetingWorkflowDefinition(): BuiltInGreetingDefinition {
	const workflowInstanceId = "builtin-greeting-fixed-reply-v2";
	const flowData = {
		nodes: [
			{
				id: BUILTIN_GREETING_WORKFLOW.triggerNodeId,
				type: "taskNode",
				position: { x: 0, y: 0 },
				data: {
					kind: "workflowTrigger",
					label: "简短问候",
					adminWorkflow: true,
					workflowInstanceId,
					workflowKey: BUILTIN_GREETING_WORKFLOW.id,
					workflowDefinitionVersion: 2,
					workflowTriggerSpec: { version: 1, kind: "manual" },
					workflowOutputPorts: ["trigger"],
					workflowPermission: "admin",
					workflowCapabilityDescription: "仅处理用户不带其他任务的简短打招呼，例如表达你好、问候或招呼；执行后必须把工作流固定交付的文本原样回复给用户。包含其他问题或任务时不要调用。",
					status: "idle",
				},
			},
			{
				id: BUILTIN_GREETING_WORKFLOW.textNodeId,
				type: "taskNode",
				position: { x: 240, y: 0 },
				data: {
					kind: "workflowStage",
					label: "固定问候回复",
					description: "输出系统内置且不可由用户输入改写的固定问候文本。",
					adminWorkflow: true,
					workflowInstanceId,
					workflowKey: BUILTIN_GREETING_WORKFLOW.id,
					workflowDefinitionVersion: 2,
					workflowNodeId: "fixed-text",
					workflowNodeKind: "text_input",
					workflowAtomicSpec: {
						category: "source",
						operation: "text_input",
						executorRef: "workflow.input.text/v1",
						executionMode: "once",
						inputPorts: ["trigger"],
						outputPorts: ["text"],
						outputArtifactType: "tapcanvas.text/v1",
					},
					workflowInputPorts: ["trigger"],
					workflowOutputPorts: ["text"],
					workflowOutputArtifactType: "tapcanvas.text/v1",
					workflowTextInput: BUILTIN_GREETING_WORKFLOW.reply,
					workflowStatus: "queued",
					workflowPermission: "admin",
					status: "idle",
				},
			},
			{
				id: BUILTIN_GREETING_WORKFLOW.outputNodeId,
				type: "taskNode",
				position: { x: 480, y: 0 },
				data: {
					kind: "workflowOutput",
					label: "问候输出",
					description: "把固定文本作为工作流的标准输出交付。",
					adminWorkflow: true,
					workflowInstanceId,
					workflowKey: BUILTIN_GREETING_WORKFLOW.id,
					workflowDefinitionVersion: 2,
					workflowNodeId: "output",
					workflowAtomicSpec: {
						category: "control",
						operation: "output",
						executorRef: "workflow.output/v1",
						executionMode: "once",
						inputPorts: ["text"],
						outputPorts: ["output"],
						outputArtifactType: "tapcanvas.text/v1",
					},
					workflowInputPorts: ["text"],
					workflowOutputPorts: ["output"],
					workflowOutputArtifactType: "tapcanvas.text/v1",
					workflowStatus: "queued",
					workflowPermission: "admin",
					status: "idle",
				},
			},
		],
		edges: [
			{
				id: "builtin-greeting:trigger-to-text",
				source: BUILTIN_GREETING_WORKFLOW.triggerNodeId,
				target: BUILTIN_GREETING_WORKFLOW.textNodeId,
				sourceHandle: "out-workflow:trigger",
				targetHandle: "in-workflow:trigger",
			},
			{
				id: "builtin-greeting:text-to-output",
				source: BUILTIN_GREETING_WORKFLOW.textNodeId,
				target: BUILTIN_GREETING_WORKFLOW.outputNodeId,
				sourceHandle: "out-workflow:text",
				targetHandle: "in-workflow:text",
			},
		],
		viewport: { x: 0, y: 0, zoom: 1 },
		builtinWorkflowId: BUILTIN_GREETING_WORKFLOW.id,
		__tapcanvasFlowOwner: { ownerType: "project", ownerId: BUILTIN_GREETING_WORKFLOW.projectId },
	};
	return {
		projectName: "系统内置工作流",
		flowName: "简短问候固定回复",
		flowData: JSON.stringify(flowData),
	};
}

function assertReservedIdentity(currentOwnerId: string | null | undefined, ownerId: string, label: string): void {
	if (currentOwnerId && currentOwnerId !== ownerId) {
		throw new Error(`${label} reserved identity is owned by another user`);
	}
}

export async function syncBuiltInGreetingWorkflow(db: PrismaClient, ownerId: string): Promise<void> {
	const definition = createBuiltInGreetingWorkflowDefinition();
	const [existingProject, existingFlow, existingVersion, existingAttachment] = await Promise.all([
		db.projects.findUnique({
			where: { id: BUILTIN_GREETING_WORKFLOW.projectId },
			select: { owner_id: true, name: true, project_kind: true, description: true },
		}),
		db.flows.findUnique({
			where: { id: BUILTIN_GREETING_WORKFLOW.flowId },
			select: { owner_id: true, project_id: true, name: true, data: true, canvas_revision: true },
		}),
		db.flow_versions.findUnique({
			where: { id: BUILTIN_GREETING_WORKFLOW.flowVersionId },
			select: { user_id: true, flow_id: true, name: true, data: true },
		}),
		db.agent_capability_attachments.findUnique({ where: { id: BUILTIN_GREETING_WORKFLOW.attachmentId } }),
	]);
	assertReservedIdentity(existingProject?.owner_id, ownerId, "Built-in greeting project");
	assertReservedIdentity(existingFlow?.owner_id, ownerId, "Built-in greeting flow");
	assertReservedIdentity(existingVersion?.user_id, ownerId, "Built-in greeting version");
	if (existingFlow) {
		const stored = JSON.parse(existingFlow.data) as { builtinWorkflowId?: unknown };
		if (stored.builtinWorkflowId !== BUILTIN_GREETING_WORKFLOW.id) throw new Error("Built-in greeting flow identity collision");
	}
	if (existingVersion && existingVersion.data !== definition.flowData) {
		throw new Error("Built-in greeting workflow version is immutable; publish a new built-in version instead of rewriting it");
	}
	if (existingVersion && (
		existingVersion.flow_id !== BUILTIN_GREETING_WORKFLOW.flowId
		|| existingVersion.name !== definition.flowName
	)) throw new Error("Built-in greeting workflow version identity collision");
	if (existingAttachment && (
		existingAttachment.user_id !== ownerId
		|| existingAttachment.capability_kind !== "workflow"
		|| existingAttachment.source_id !== BUILTIN_GREETING_WORKFLOW.flowId
	)) throw new Error("Built-in greeting capability attachment identity collision");
	const naturalAttachment = await db.agent_capability_attachments.findFirst({
		where: {
			user_id: ownerId,
			capability_kind: "workflow",
			source_id: BUILTIN_GREETING_WORKFLOW.flowId,
		},
		select: { id: true },
	});
	if (naturalAttachment && naturalAttachment.id !== BUILTIN_GREETING_WORKFLOW.attachmentId) {
		throw new Error("Built-in greeting workflow already has a non-system attachment identity");
	}

	const descriptor = buildWorkflowCapabilityDescriptor({
		flow: {
			id: BUILTIN_GREETING_WORKFLOW.flowId,
			name: definition.flowName,
			data: definition.flowData,
			project_id: BUILTIN_GREETING_WORKFLOW.projectId,
			canvas_revision: 0,
		},
		version: { id: BUILTIN_GREETING_WORKFLOW.flowVersionId, data: definition.flowData },
	});
	const descriptorSha256 = capabilityDescriptorSha256(descriptor);
	const conflictReport = CapabilityConflictReportSchema.parse({
		protocolVersion: "tapcanvas.capability-conflict-report/v1",
		targetCapabilityId: descriptor.capabilityId,
		checkedAt: BUILTIN_GREETING_WORKFLOW.releasedAt,
		descriptorSha256,
		semanticAnalysis: {
			status: "unavailable",
			errorCode: "builtin_definition",
			message: "系统内置工作流由版本化定义发布，未伪造一次在线语义冲突分析。",
		},
		conflicts: [],
		blocking: false,
		requiresConfirmation: false,
	});
	const descriptorJson = JSON.stringify(descriptor);
	const conflictReportJson = JSON.stringify(conflictReport);
	const routeDecisionsJson = JSON.stringify([]);
	const projectDescription = "Docker 启动时同步的系统内置工作流集合。";
	const now = new Date().toISOString();
	let changed = false;
	await db.$transaction(async (transaction) => {
		if (!existingProject) {
			await transaction.projects.create({ data: {
				id: BUILTIN_GREETING_WORKFLOW.projectId,
				name: definition.projectName,
				owner_id: ownerId,
				project_kind: "ai_workflow",
				description: projectDescription,
				created_at: now,
				updated_at: now,
			} });
			changed = true;
		} else if (
			existingProject.name !== definition.projectName
			|| existingProject.project_kind !== "ai_workflow"
			|| existingProject.description !== projectDescription
		) {
			await transaction.projects.update({
				where: { id: BUILTIN_GREETING_WORKFLOW.projectId },
				data: { name: definition.projectName, project_kind: "ai_workflow", description: projectDescription, updated_at: now },
			});
			changed = true;
		}
		if (!existingFlow) {
			await transaction.flows.create({ data: {
				id: BUILTIN_GREETING_WORKFLOW.flowId,
				name: definition.flowName,
				data: definition.flowData,
				owner_id: ownerId,
				project_id: BUILTIN_GREETING_WORKFLOW.projectId,
				created_at: now,
				updated_at: now,
				canvas_revision: 0,
			} });
			changed = true;
		} else if (
			existingFlow.name !== definition.flowName
			|| existingFlow.data !== definition.flowData
			|| existingFlow.project_id !== BUILTIN_GREETING_WORKFLOW.projectId
			|| existingFlow.canvas_revision !== 0
		) {
			await transaction.flows.update({
				where: { id: BUILTIN_GREETING_WORKFLOW.flowId },
				data: {
					name: definition.flowName,
					data: definition.flowData,
					project_id: BUILTIN_GREETING_WORKFLOW.projectId,
					canvas_revision: 0,
					updated_at: now,
				},
			});
			changed = true;
		}
		if (!existingVersion) {
			await transaction.flow_versions.create({
				data: {
					id: BUILTIN_GREETING_WORKFLOW.flowVersionId,
					flow_id: BUILTIN_GREETING_WORKFLOW.flowId,
					name: definition.flowName,
					data: definition.flowData,
					user_id: ownerId,
					created_at: now,
				},
			});
			changed = true;
		}
		if (!existingAttachment) {
			await transaction.agent_capability_attachments.create({ data: {
				id: BUILTIN_GREETING_WORKFLOW.attachmentId,
				user_id: ownerId,
				capability_kind: "workflow",
				source_id: BUILTIN_GREETING_WORKFLOW.flowId,
				source_version_id: BUILTIN_GREETING_WORKFLOW.flowVersionId,
				descriptor_json: descriptorJson,
				descriptor_sha256: descriptorSha256,
				conflict_report_json: conflictReportJson,
				route_decisions_json: routeDecisionsJson,
				conflict_report_revision: 1,
				scope: "all_users",
				created_at: now,
				updated_at: now,
			} });
			changed = true;
		} else if (
			existingAttachment.source_version_id !== BUILTIN_GREETING_WORKFLOW.flowVersionId
			|| existingAttachment.descriptor_json !== descriptorJson
			|| existingAttachment.descriptor_sha256 !== descriptorSha256
			|| existingAttachment.conflict_report_json !== conflictReportJson
			|| existingAttachment.route_decisions_json !== routeDecisionsJson
			|| existingAttachment.conflict_report_revision !== 1
			|| existingAttachment.scope !== "all_users"
		) {
			await transaction.agent_capability_attachments.update({
				where: { id: BUILTIN_GREETING_WORKFLOW.attachmentId },
				data: {
					source_version_id: BUILTIN_GREETING_WORKFLOW.flowVersionId,
					descriptor_json: descriptorJson,
					descriptor_sha256: descriptorSha256,
					conflict_report_json: conflictReportJson,
					route_decisions_json: routeDecisionsJson,
					conflict_report_revision: 1,
					scope: "all_users",
					updated_at: now,
				},
			});
			changed = true;
		}
	});
	console.log(`[startup] built-in greeting workflow ${changed ? "synchronized" : "unchanged"}: ${BUILTIN_GREETING_WORKFLOW.flowId}`);
}
