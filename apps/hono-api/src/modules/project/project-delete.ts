import { getPrismaClient } from "../../platform/node/prisma";

export async function deleteProjectGraph(projectId: string): Promise<void> {
	const prisma = getPrismaClient();

	await prisma.$transaction(async (tx) => {
		const flowRows = await tx.flows.findMany({
			where: { project_id: projectId },
			select: { id: true },
		});
		const flowIds = flowRows.map((row) => row.id);

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
