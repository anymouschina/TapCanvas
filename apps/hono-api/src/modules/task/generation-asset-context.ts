import { z } from "zod";

import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import type { AppContext } from "../../types";
import { getProjectForUserAccess } from "../project/project.repo";
import {
	TaskResultSchema,
	type TaskRequestDto,
	type TaskResultDto,
} from "./task.schemas";

export const GenerationAssetContextSchema = z
	.object({
		projectId: z.string().trim().min(1),
		flowId: z.string().trim().min(1).optional(),
		nodeId: z.string().trim().min(1).optional(),
		chapterId: z.string().trim().min(1).optional(),
		workflowExecutionId: z.string().trim().min(1).optional(),
	})
	.strict();

export type GenerationAssetContext = z.infer<
	typeof GenerationAssetContextSchema
>;

function readRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function parseGenerationAssetContext(value: unknown): GenerationAssetContext | null {
	if (typeof value === "undefined" || value === null) return null;
	const parsed = GenerationAssetContextSchema.safeParse(value);
	if (parsed.success) return parsed.data;
	throw new AppError("生成资产上下文格式无效", {
		status: 400,
		code: "invalid_generation_asset_context",
		details: { issues: parsed.error.issues },
	});
}

export function readGenerationAssetContextFromTaskRequest(
	request: Pick<TaskRequestDto, "extras">,
): GenerationAssetContext | null {
	const extras = readRecord(request.extras);
	return parseGenerationAssetContext(extras?.generationContext);
}

export function readGenerationAssetContextFromRaw(
	raw: unknown,
): GenerationAssetContext | null {
	return parseGenerationAssetContext(readRecord(raw)?.generationContext);
}

export function attachGenerationAssetContextToRaw(
	raw: unknown,
	context: GenerationAssetContext | null,
): unknown {
	if (!context) return raw;
	const record = readRecord(raw);
	return {
		...(record ?? { providerRaw: raw }),
		generationContext: context,
	};
}

export function attachGenerationAssetContextToTaskResult(
	result: TaskResultDto,
	context: GenerationAssetContext | null,
): TaskResultDto {
	if (!context) return result;
	return TaskResultSchema.parse({
		...result,
		raw: attachGenerationAssetContextToRaw(result.raw, context),
	});
}

export async function resolveAuthorizedGenerationAssetContext(
	c: AppContext,
	userId: string,
	request: Pick<TaskRequestDto, "extras">,
): Promise<GenerationAssetContext | null> {
	const context = readGenerationAssetContextFromTaskRequest(request);
	if (!context) return null;

	const project = await getProjectForUserAccess(
		c.env.DB,
		context.projectId,
		userId,
	);
	if (!project) {
		throw new AppError("无权把生成结果写入指定项目", {
			status: 403,
			code: "generation_asset_project_forbidden",
			details: { projectId: context.projectId },
		});
	}

	const prisma = getPrismaClient();
	if (context.flowId) {
		const flow = await prisma.flows.findFirst({
			where: { id: context.flowId, project_id: context.projectId },
			select: { id: true },
		});
		if (!flow) {
			throw new AppError("生成资产上下文中的画布不属于指定项目", {
				status: 400,
				code: "generation_asset_flow_project_mismatch",
				details: {
					projectId: context.projectId,
					flowId: context.flowId,
				},
			});
		}
	}

	if (context.chapterId) {
		const chapter = await prisma.chapters.findFirst({
			where: { id: context.chapterId, project_id: context.projectId },
			select: { id: true },
		});
		if (!chapter) {
			throw new AppError("生成资产上下文中的章节不属于指定项目", {
				status: 400,
				code: "generation_asset_chapter_project_mismatch",
				details: {
					projectId: context.projectId,
					chapterId: context.chapterId,
				},
			});
		}
	}

	if (context.workflowExecutionId) {
		const execution = await prisma.workflow_executions.findFirst({
			where: {
				id: context.workflowExecutionId,
				project_id: context.projectId,
			},
			select: { id: true },
		});
		if (!execution) {
			throw new AppError("生成资产上下文中的工作流执行不属于指定项目", {
				status: 400,
				code: "generation_asset_execution_project_mismatch",
				details: {
					projectId: context.projectId,
					workflowExecutionId: context.workflowExecutionId,
				},
			});
		}
	}

	return context;
}
