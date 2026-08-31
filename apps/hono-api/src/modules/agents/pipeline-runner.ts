// apps/hono-api/src/modules/agents/pipeline-runner.ts
import { createHash } from "node:crypto";

function pLimit(concurrency: number) {
	let running = 0;
	const queue: Array<() => void> = [];
	return function limit<T>(fn: () => Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			queue.push(async () => {
				running++;
				try { resolve(await fn()) } catch (e) { reject(e) } finally {
					running--;
					if (queue.length > 0) queue.shift()!();
				}
			});
			if (running < concurrency) queue.shift()!();
		});
	};
}

// ── 类型 ──────────────────────────────────────────────────────────────────────

export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StageExecution {
	id: string;
	label: string;
	status: StageStatus;
	attempt: number;
	inputHash: string;
	outputRef: string | null;
	errorMessage: string | null;
	startedAt: string | null;
	finishedAt: string | null;
}

export interface StageDefinition<TInput = unknown, TOutput = unknown> {
	id: string;
	label: string;
	maxAttempts?: number;
	run: (input: TInput) => Promise<TOutput>;
	validate?: (output: TOutput) => { ok: true } | { ok: false; error: string };
}

// ── 迁移：string[] → StageExecution[] ────────────────────────────────────────

export function migrateStagesJson(raw: unknown): StageExecution[] {
	if (!Array.isArray(raw)) return [];

	if (raw.length > 0 && typeof raw[0] === "object" && raw[0] !== null && "id" in raw[0]) {
		return (raw as Array<Record<string, unknown>>).map((item) => {
			const id = typeof item.id === "string" ? item.id : "";
			const label = typeof item.label === "string" ? item.label : id;
			const status: StageStatus =
				item.status === "pending" ||
				item.status === "running" ||
				item.status === "done" ||
				item.status === "failed" ||
				item.status === "skipped"
					? (item.status as StageStatus)
					: "pending";
			const attempt = typeof item.attempt === "number" && Number.isFinite(item.attempt) ? item.attempt : 0;
			return {
				id,
				label,
				status,
				attempt,
				inputHash: typeof item.inputHash === "string" ? item.inputHash : "",
				outputRef: typeof item.outputRef === "string" ? item.outputRef : null,
				errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : null,
				startedAt: typeof item.startedAt === "string" ? item.startedAt : null,
				finishedAt: typeof item.finishedAt === "string" ? item.finishedAt : null,
			};
		});
	}

	return (raw as string[])
		.filter((s) => typeof s === "string" && s.trim())
		.map((s) => ({
			id: s,
			label: s,
			status: "pending" as StageStatus,
			attempt: 0,
			inputHash: "",
			outputRef: null,
			errorMessage: null,
			startedAt: null,
			finishedAt: null,
		}));
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

export function hashInput(input: unknown): string {
	const str = typeof input === "string" ? input : JSON.stringify(input);
	return createHash("sha256").update(str).digest("hex").slice(0, 16);
}

export function nowIso(): string {
	return new Date().toISOString();
}

// ── Stage 执行器 ──────────────────────────────────────────────────────────────

export interface StageExecutorOptions<TInput, TOutput> {
	stage: StageDefinition<TInput, TOutput>;
	existingExecution: StageExecution | null;
	input: TInput;
	onUpdate: (execution: StageExecution) => Promise<void>;
	onRetryPrompt?: (error: string, attempt: number) => TInput;
}

export async function executeStage<TInput, TOutput>(
	opts: StageExecutorOptions<TInput, TOutput>,
): Promise<{ execution: StageExecution; output: TOutput | null }> {
	const { stage, existingExecution, onUpdate, onRetryPrompt } = opts;
	const maxAttempts = stage.maxAttempts ?? 3;
	const inputHash = hashInput(opts.input);

	if (existingExecution?.status === "done" && existingExecution.inputHash === inputHash) {
		if (existingExecution.outputRef) {
			try {
				const output = JSON.parse(existingExecution.outputRef) as TOutput;
				return { execution: existingExecution, output };
			} catch {
				// outputRef 损坏，降级重新执行本 stage
			}
		} else {
			return { execution: existingExecution, output: null };
		}
	}

	let currentInput = opts.input;
	let execution: StageExecution = {
		id: stage.id,
		label: stage.label,
		status: "running",
		attempt: Math.min(existingExecution?.attempt ?? 0, maxAttempts - 1),
		inputHash,
		outputRef: null,
		errorMessage: null,
		startedAt: nowIso(),
		finishedAt: null,
	};
	await onUpdate(execution);

	while (execution.attempt < maxAttempts) {
		execution.attempt += 1;
		try {
			const output = await stage.run(currentInput);

			if (stage.validate) {
				const result = stage.validate(output);
				if (!result.ok) {
					execution.errorMessage = result.error;
					await onUpdate({ ...execution, status: "running" });
					if (onRetryPrompt && execution.attempt < maxAttempts) {
						currentInput = onRetryPrompt(result.error, execution.attempt);
					}
					continue;
				}
			}

			execution = {
				...execution,
				status: "done",
				outputRef: JSON.stringify(output),
				errorMessage: null,
				finishedAt: nowIso(),
			};
			await onUpdate(execution);
			return { execution, output };
		} catch (err) {
			execution.errorMessage = err instanceof Error ? err.message : String(err);
			if (execution.attempt >= maxAttempts) break;
			await onUpdate({ ...execution, status: "running" });
		}
	}

	execution = { ...execution, status: "failed", finishedAt: nowIso() };
	await onUpdate(execution);
	return { execution, output: null };
}

// ── 并发执行多个 Stage ────────────────────────────────────────────────────────

export interface ParallelStageGroup<TInput, TOutput> {
	stages: Array<StageDefinition<TInput, TOutput> & { input: TInput }>;
	existingExecutions: Map<string, StageExecution>;
	concurrency?: number;
	onUpdate: (stageId: string, execution: StageExecution) => Promise<void>;
	onRetryPrompt?: (stageId: string, error: string, attempt: number) => TInput;
}

export async function executeStagesConcurrently<TInput, TOutput>(
	group: ParallelStageGroup<TInput, TOutput>,
): Promise<Map<string, { execution: StageExecution; output: TOutput | null }>> {
	const limit = pLimit(group.concurrency ?? 5);
	const results = new Map<string, { execution: StageExecution; output: TOutput | null }>();

	const tasks = group.stages.map((stageDef) =>
		limit(async () => {
			const result = await executeStage({
				stage: stageDef,
				existingExecution: group.existingExecutions.get(stageDef.id) ?? null,
				input: stageDef.input,
				onUpdate: (execution) => group.onUpdate(stageDef.id, execution),
				onRetryPrompt: group.onRetryPrompt
					? (error, attempt) => group.onRetryPrompt!(stageDef.id, error, attempt)
					: undefined,
			});
			results.set(stageDef.id, result);
		}),
	);

	await Promise.all(tasks);
	return results;
}
