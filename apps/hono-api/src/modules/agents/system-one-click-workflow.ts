import type { PrismaClient } from "@prisma/client";
import { buildWorkflowCapabilityDescriptor, capabilityDescriptorSha256 } from "./capability-bay.descriptor";
import { CapabilityConflictReportSchema } from "./capability-bay.schemas";
import { BUILTIN_ONE_CLICK_WORKFLOW, createBuiltInOneClickWorkflowDefinition } from "./system-one-click-workflow.definition";

function sqlText(value: string): string {
	return "'" + value.replaceAll("'", "''") + "'";
}

/** One release definition drives both startup and the reviewable SQL patch. */
export function builtInOneClickWorkflowSql(): string {
	const identity = BUILTIN_ONE_CLICK_WORKFLOW;
	const definition = createBuiltInOneClickWorkflowDefinition();
	const descriptor = buildWorkflowCapabilityDescriptor({
		flow: { id: identity.flowId, name: definition.flowName, data: definition.flowData, project_id: identity.projectId, canvas_revision: 0 },
		version: { id: identity.flowVersionId, data: definition.flowData },
	});
	const descriptorSha256 = capabilityDescriptorSha256(descriptor);
	const conflictReport = CapabilityConflictReportSchema.parse({
		protocolVersion: "tapcanvas.capability-conflict-report/v1", targetCapabilityId: descriptor.capabilityId,
		checkedAt: identity.releasedAt, descriptorSha256,
		semanticAnalysis: { status: "unavailable", errorCode: "builtin_definition", message: "系统内置版本化定义，未执行在线语义冲突分析。" },
		conflicts: [], blocking: false, requiresConfirmation: false,
	});
	const projectId = sqlText(identity.projectId);
	const flowId = sqlText(identity.flowId);
	const versionId = sqlText(identity.flowVersionId);
	const attachmentId = sqlText(identity.attachmentId);
	const flowData = sqlText(definition.flowData);
	const descriptorJson = sqlText(JSON.stringify(descriptor));
	const reportJson = sqlText(JSON.stringify(conflictReport));
	const releaseTime = sqlText(identity.releasedAt);
	return `-- Generated from system-one-click-workflow.definition.ts. Do not edit by hand.
-- Apply with psql -v ON_ERROR_STOP=1 after bootstrap, or let API startup publish it.
-- Owner comes from an explicit transaction setting or the existing system project.
-- Append-only: no existing workflow, version, preference, run or asset is overwritten.
DO $one_click_v1$
DECLARE
  workflow_owner text;
BEGIN
  workflow_owner := NULLIF(current_setting('tapcanvas.workflow_owner_id', true), '');
  IF workflow_owner IS NULL THEN
    SELECT owner_id INTO workflow_owner FROM projects WHERE id = '00000000-0000-4000-8000-000000000101';
  END IF;
  IF workflow_owner IS NULL OR NOT EXISTS (
    SELECT 1 FROM users WHERE id = workflow_owner AND role = 'admin' AND disabled = 0 AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'one_click_v1: an active bootstrap administrator is required';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('tapcanvas.builtin.one-click-video-nodes/v1'));
  INSERT INTO projects (id, name, owner_id, project_kind, description, created_at, updated_at)
  VALUES (${projectId}, ${sqlText(definition.projectName)}, workflow_owner, 'ai_workflow', '按字长拆分并添加视频节点；系统级共享工作流。', ${releaseTime}, ${releaseTime})
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = ${projectId} AND owner_id = workflow_owner AND project_kind = 'ai_workflow') THEN
    RAISE EXCEPTION 'one_click_v1: reserved project identity collision';
  END IF;
  INSERT INTO flows (id, name, data, owner_id, project_id, canvas_revision, created_at, updated_at)
  VALUES (${flowId}, ${sqlText(definition.flowName)}, ${flowData}, workflow_owner, ${projectId}, 0, ${releaseTime}, ${releaseTime})
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM flows WHERE id = ${flowId} AND owner_id = workflow_owner AND project_id = ${projectId} AND data::jsonb ->> 'builtinWorkflowId' = ${sqlText(identity.id)}) THEN
    RAISE EXCEPTION 'one_click_v1: reserved flow identity collision';
  END IF;
  INSERT INTO flow_versions (id, flow_id, name, data, user_id, created_at)
  VALUES (${versionId}, ${flowId}, ${sqlText(definition.flowName)}, ${flowData}, workflow_owner, ${releaseTime})
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM flow_versions WHERE id = ${versionId} AND flow_id = ${flowId} AND user_id = workflow_owner AND name = ${sqlText(definition.flowName)} AND data = ${flowData}) THEN
    RAISE EXCEPTION 'one_click_v1: immutable workflow version mismatch';
  END IF;
  INSERT INTO agent_capability_attachments (id, user_id, capability_kind, source_id, source_version_id, descriptor_json, descriptor_sha256, conflict_report_json, route_decisions_json, conflict_report_revision, scope, created_at, updated_at)
  VALUES (${attachmentId}, workflow_owner, 'workflow', ${flowId}, ${versionId}, ${descriptorJson}, ${sqlText(descriptorSha256)}, ${reportJson}, '[]', 1, 'all_users', ${releaseTime}, ${releaseTime})
  ON CONFLICT (id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM agent_capability_attachments WHERE id = ${attachmentId} AND user_id = workflow_owner AND capability_kind = 'workflow' AND source_id = ${flowId} AND source_version_id = ${versionId} AND scope = 'all_users' AND descriptor_sha256 = ${sqlText(descriptorSha256)} AND descriptor_json = ${descriptorJson}) THEN
    RAISE EXCEPTION 'one_click_v1: system attachment identity or version mismatch';
  END IF;
END;
$one_click_v1$;
`;
}

export async function syncBuiltInOneClickWorkflow(db: PrismaClient, ownerId: string): Promise<void> {
	if (!ownerId.trim()) throw new Error("one_click_v1: bootstrap owner is required");
	await db.$transaction(async (transaction) => {
		await transaction.$executeRaw`SELECT set_config('tapcanvas.workflow_owner_id', ${ownerId}, true)`;
		await transaction.$executeRawUnsafe(builtInOneClickWorkflowSql());
	});
	console.log(`[startup] built-in one-click workflow available: ${BUILTIN_ONE_CLICK_WORKFLOW.flowId}`);
}
