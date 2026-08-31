import { getPrismaClient } from "../../platform/node/prisma";

function readWorkflowCapabilityId(descriptorJson: string): string | null {
	try {
		const parsed: unknown = JSON.parse(descriptorJson);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		const capabilityId = (parsed as { capabilityId?: unknown }).capabilityId;
		return typeof capabilityId === "string" && capabilityId.trim() ? capabilityId.trim() : null;
	} catch {
		return null;
	}
}

export async function deleteProjectGraph(projectId: string): Promise<void> {
	const prisma = getPrismaClient();

	await prisma.$transaction(async (tx) => {
		const flowRows = await tx.flows.findMany({
			where: { project_id: projectId },
			select: { id: true },
		});
		const flowIds = flowRows.map((row) => row.id);
		const capabilityAttachments = flowIds.length > 0
			? await tx.agent_capability_attachments.findMany({
					where: { source_id: { in: flowIds } },
					select: { descriptor_json: true },
				})
			: [];
		const capabilityIds = capabilityAttachments
			.map((row) => readWorkflowCapabilityId(row.descriptor_json))
			.filter((value): value is string => value !== null);
		if (flowIds.length > 0) {
			await tx.agent_capability_attachments.deleteMany({
				where: { source_id: { in: flowIds } },
			});
		}
		if (capabilityIds.length > 0) {
			await tx.agent_capability_preferences.deleteMany({
				where: { replaced_by_capability_id: { in: capabilityIds } },
			});
		}

		const flowVersionRows =
			flowIds.length > 0
				? await tx.flow_versions.findMany({
						where: { flow_id: { in: flowIds } },
						select: { id: true },
					})
				: [];
		const flowVersionIds = flowVersionRows.map((row) => row.id);

		const executionRows =
			flowIds.length > 0
				? await tx.workflow_executions.findMany({
						where: { flow_id: { in: flowIds } },
						select: { id: true },
					})
				: [];
		const executionIds = executionRows.map((row) => row.id);

		if (executionIds.length > 0) {
			await tx.workflow_node_runs.deleteMany({
				where: { execution_id: { in: executionIds } },
			});
			await tx.workflow_execution_events.deleteMany({
				where: { execution_id: { in: executionIds } },
			});
			await tx.workflow_executions.deleteMany({
				where: { id: { in: executionIds } },
			});
		}

		if (flowVersionIds.length > 0) {
			await tx.flow_versions.deleteMany({
				where: { id: { in: flowVersionIds } },
			});
		}

		if (flowIds.length > 0) {
			await tx.flows.deleteMany({
				where: { id: { in: flowIds } },
			});
		}

		await tx.video_generation_histories.deleteMany({
			where: { project_id: projectId },
		});
		await tx.agent_pipeline_runs.deleteMany({
			where: { project_id: projectId },
		});
		// 发布记录是「公开快照」：删项目时摘钩保留（媒体在 TOS 不随项目删除），
		// 已公开作品不因原项目删除而消失。
		await tx.assets.updateMany({
			where: {
				project_id: projectId,
				data: { contains: '"kind":"publishRecord"' },
			},
			data: { project_id: null },
		});
		await tx.assets.deleteMany({
			where: { project_id: projectId },
		});
		await tx.chapters.deleteMany({
			where: { project_id: projectId },
		});
		await tx.projects.delete({
			where: { id: projectId },
		});
	});
}
