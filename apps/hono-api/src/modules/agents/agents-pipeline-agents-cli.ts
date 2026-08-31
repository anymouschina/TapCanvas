import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { createAssetRow } from "../asset/asset.repo";
import { getProjectForOwner } from "../project/project.repo";
import { runAgentsBridgeChatTask } from "../task/task.agents-bridge";
import type { ExecuteAgentPipelineRunRequestDto, AgentPipelineRunDto } from "./agents.schemas";
import { AgentPipelineRunSchema } from "./agents.schemas";
import {
	getAgentPipelineRunRowById,
	updateAgentPipelineRunRow,
} from "./agents.repo";

function parseJson(value: string | null): unknown {
	if (!value) return null;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return null;
	}
}

function mapRun(row: {
	id: string;
	owner_id: string;
	project_id: string;
	title: string;
	goal: string | null;
	status: string;
	stages_json: string;
	progress_json: string | null;
	result_json: string | null;
	error_message: string | null;
	created_at: string;
	updated_at: string;
	started_at: string | null;
	finished_at: string | null;
}): AgentPipelineRunDto {
	return AgentPipelineRunSchema.parse({
		id: row.id,
		ownerId: row.owner_id,
		projectId: row.project_id,
		title: row.title,
		goal: row.goal,
		status: row.status,
		stages: parseJson(row.stages_json),
		progress: parseJson(row.progress_json),
		result: parseJson(row.result_json),
		errorMessage: row.error_message,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	});
}

/**
 * The pipeline table remains a durable UI/task handle, but execution is a single
 * agents-cli task. Hono supplies authenticated facts and persists the result; it
 * does not select skills, stages, prompts, or a local creative SOP.
 */
export async function executeUserAgentPipelineRun(
	c: AppContext,
	userId: string,
	id: string,
	input?: ExecuteAgentPipelineRunRequestDto,
): Promise<AgentPipelineRunDto> {
	const run = await getAgentPipelineRunRowById(c.env.DB, { id, ownerId: userId });
	if (!run) {
		throw new AppError("Pipeline run not found", { status: 404, code: "pipeline_run_not_found" });
	}
	if (input?.force !== true && (run.status === "running" || run.status === "succeeded")) {
		throw new AppError("Pipeline run already in progress/completed", {
			status: 409,
			code: "pipeline_run_conflict",
		});
	}
	const project = await getProjectForOwner(c.env.DB, run.project_id, userId);
	if (!project) {
		throw new AppError("Project not found", { status: 400, code: "project_not_found" });
	}
	const nowIso = new Date().toISOString();
	await updateAgentPipelineRunRow(c.env.DB, {
		id,
		ownerId: userId,
		status: "running",
		progressJson: JSON.stringify({ stage: "agents_cli", percent: 10 }),
		resultJson: null,
		errorMessage: null,
		startedAt: run.started_at || nowIso,
		finishedAt: null,
		nowIso,
	});

	try {
		const stages = parseJson(run.stages_json);
		const executionFacts = {
			pipelineRunId: run.id,
			projectId: run.project_id,
			projectName: project.name,
			title: run.title,
			goal: run.goal,
			stages,
			request: input ?? null,
		};
		const task = await runAgentsBridgeChatTask(c, userId, {
			kind: "chat",
			prompt: JSON.stringify(executionFacts),
			extras: {
				pipelineRunId: run.id,
				canvasProjectId: run.project_id,
				pipelineExecutionFacts: executionFacts,
			},
		});
		const rawText =
			task.raw && typeof task.raw === "object" && !Array.isArray(task.raw) &&
			typeof (task.raw as Record<string, unknown>).text === "string"
				? String((task.raw as Record<string, unknown>).text)
				: null;
		let outputAssetId: string | null = null;
		if (rawText?.trim()) {
			const asset = await createAssetRow(c.env.DB, userId, {
				name: `Agent 执行结果 · ${run.title}`,
				projectId: run.project_id,
				data: {
					kind: "agentPipelineResult",
					source: "agents_cli",
					pipelineRunId: run.id,
					taskId: task.id,
					text: rawText,
				},
			}, new Date().toISOString());
			outputAssetId = asset.id;
		}
		const updated = await updateAgentPipelineRunRow(c.env.DB, {
			id,
			ownerId: userId,
			status: "succeeded",
			progressJson: JSON.stringify({ stage: "agents_cli", percent: 100 }),
			resultJson: JSON.stringify({
				source: "agents_cli",
				taskId: task.id,
				taskStatus: task.status,
				outputAssetId,
				text: rawText,
				raw: task.raw,
			}),
			errorMessage: null,
			finishedAt: new Date().toISOString(),
			nowIso: new Date().toISOString(),
		});
		if (!updated) throw new AppError("Pipeline run not found", { status: 404, code: "pipeline_run_not_found" });
		return mapRun(updated);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const updated = await updateAgentPipelineRunRow(c.env.DB, {
			id,
			ownerId: userId,
			status: "failed",
			progressJson: JSON.stringify({ stage: "agents_cli", percent: 100 }),
			errorMessage: message,
			finishedAt: new Date().toISOString(),
			nowIso: new Date().toISOString(),
		});
		if (!updated) throw error;
		return mapRun(updated);
	}
}
