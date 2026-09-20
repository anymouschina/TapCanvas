import type { PrismaClient } from "@prisma/client";
import { VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION, VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT } from "@tapcanvas/video-orchestrator-protocol";
import graph from "./system-video-production-workflow.graph.json";
import { builtInOneClickWorkflowSql } from "./system-one-click-workflow";

export const BUILTIN_VIDEO_PRODUCTION_WORKFLOW = Object.freeze({
	id: "tapcanvas.builtin.video-production/v90",
	projectId: "00000000-0000-4000-8000-000000000121",
	flowId: "00000000-0000-4000-8000-000000000122",
	flowVersionId: "00000000-0000-4000-8000-000000000123",
	attachmentId: "00000000-0000-4000-8000-000000000124",
	releasedAt: "2026-09-20T00:00:00.000Z",
});

export function createBuiltInVideoProductionWorkflowDefinition() {
	if (graph.workflowCanvasDefinitionVersion !== VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION
		|| graph.workflowCanvasDefinitionFingerprint !== VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT) {
		throw new Error("System video workflow is stale; regenerate it from the canonical editor definition");
	}
	return {
		projectName: "一键成片 · 系统工作流",
		flowName: `一键成片 v${VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION}`,
		flowData: JSON.stringify({
			...graph,
			builtinWorkflowId: BUILTIN_VIDEO_PRODUCTION_WORKFLOW.id,
			__tapcanvasFlowOwner: { ownerType: "project", ownerId: BUILTIN_VIDEO_PRODUCTION_WORKFLOW.projectId },
		}),
	};
}

export function builtInVideoProductionWorkflowSql(): string {
	return builtInOneClickWorkflowSql({
		identity: BUILTIN_VIDEO_PRODUCTION_WORKFLOW,
		definition: createBuiltInVideoProductionWorkflowDefinition(),
		description: "章节规划、共享资产、逐段视觉设计与持久成片；保留已生成资产和真实交付证据。",
		definitionSource: "system-video-production-workflow.ts (graph generated from videoWorkflowDefinition.ts)",
	});
}

export async function syncBuiltInVideoProductionWorkflow(db: PrismaClient, ownerId: string): Promise<void> {
	if (!ownerId.trim()) throw new Error("System video workflow requires a bootstrap owner");
	await db.$transaction(async transaction => {
		await transaction.$executeRaw`SELECT set_config('tapcanvas.workflow_owner_id', ${ownerId}, true)`;
		await transaction.$executeRawUnsafe(builtInVideoProductionWorkflowSql());
	});
	console.log(`[startup] built-in video production workflow available: ${BUILTIN_VIDEO_PRODUCTION_WORKFLOW.flowId}`);
}
