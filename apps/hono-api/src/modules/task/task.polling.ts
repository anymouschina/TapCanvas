import type { AppContext } from "../../types";
import { TaskResultSchema, type TaskKind, type TaskResultDto } from "./task.schemas";
import { getTaskResultByTaskId, upsertTaskResult } from "./task-result.repo";
import { getVendorTaskRefByTaskId } from "./vendor-task-refs.repo";
import { fetchNewApiTaskResult } from "./task.service";

export type TaskPollingMode = "public" | "internal";

export type TaskPollingOutcome =
	| { ok: true; vendor: string; result: TaskResultDto }
	| { ok: false; status: number; body: unknown };

function resolveRefKind(taskKind: TaskKind | null): "video" | "image" | null {
	if (taskKind === "text_to_video" || taskKind === "image_to_video") return "video";
	if (taskKind === "text_to_image" || taskKind === "image_edit") return "image";
	return null;
}

function shouldBypassStoredTerminalResult(input: {
	result: TaskResultDto;
	storedVendor: string;
	explicitTaskKind: TaskKind | null;
}): boolean {
	const kind = input.explicitTaskKind ?? input.result.kind;
	const isVideoTask = kind === "text_to_video" || kind === "image_to_video";
	if (!isVideoTask) return false;
	if (input.result.status !== "succeeded") return false;
	if (Array.isArray(input.result.assets) && input.result.assets.length > 0) return false;
	const vendor = input.storedVendor.trim().toLowerCase();
	return vendor === "newapi" || vendor.startsWith("newapi:");
}

export async function fetchTaskResultForPolling(
	c: AppContext,
	userId: string,
	input: {
		taskId: string;
		vendor?: string | null;
		taskKind?: TaskKind | null;
		prompt?: string | null;
		mode: TaskPollingMode;
	},
): Promise<TaskPollingOutcome> {
	const taskId = (input.taskId || "").trim();
	const taskKind = input.taskKind ?? null;
	const prompt = typeof input.prompt === "string" ? input.prompt : null;

	// 1) Stored result fast-path: only terminal results should short-circuit polling.
	let storedRow: any | null = null;
	let storedVendor = "";
	try {
		storedRow = await getTaskResultByTaskId(c.env.DB, userId, taskId);
		storedVendor =
			typeof storedRow?.vendor === "string" && storedRow.vendor.trim()
				? String(storedRow.vendor).trim()
				: "";
		if (storedRow?.result) {
			const payload = JSON.parse(storedRow.result);
			const parsed = TaskResultSchema.safeParse(payload);
			if (parsed.success) {
				if (
					shouldBypassStoredTerminalResult({
						result: parsed.data,
						storedVendor,
						explicitTaskKind: taskKind,
					})
				) {
					storedRow = null;
				} else
				if (
					parsed.data.status === "succeeded" ||
					parsed.data.status === "failed"
				) {
					return {
						ok: true,
						vendor:
							typeof storedRow.vendor === "string" && storedRow.vendor.trim()
								? String(storedRow.vendor).trim()
								: "",
						result: parsed.data,
					};
				}
			}
		}
	} catch {
		// ignore and fall back to vendor polling
	}

	const resolved: { vendor: string; kind: "video" | "image" | null } = {
		vendor: "newapi",
		kind: resolveRefKind(taskKind),
	};

	let inferredFromVendorRef = false;
	if (!resolved.kind) {
		for (const k of ["video", "image"] as const) {
			const ref = await getVendorTaskRefByTaskId(c.env.DB, userId, k, taskId);
			if (ref?.vendor) {
				resolved.kind = k;
				inferredFromVendorRef = true;
				break;
			}
		}
	}

	// Hint proxy selector: prefer higher-success channels for this task kind.
	if (taskKind) c.set("routingTaskKind", taskKind);

	let result: any;

	if (resolved.kind === "image") {
		return {
			ok: false,
			status: 400,
			body: {
				error: "new-api 图像任务通常为同步返回；请直接使用创建接口返回结果",
				code: "invalid_task_kind",
			},
		};
	}
	result = await fetchNewApiTaskResult(c, userId, taskId, {
		taskKind: (taskKind as any) ?? null,
		vendor: "newapi",
		promptFromClient: prompt,
	});

	const parsedResult = TaskResultSchema.parse(result);
	if (storedRow || inferredFromVendorRef) {
		const nowIso = new Date().toISOString();
		const completedAt =
			parsedResult.status === "succeeded" || parsedResult.status === "failed"
				? nowIso
				: null;
		try {
			await upsertTaskResult(c.env.DB, {
				userId,
				taskId,
				vendor: resolved.vendor,
				kind: String(parsedResult.kind),
				status: parsedResult.status,
				result: parsedResult,
				completedAt,
				nowIso,
			});
		} catch {
			// ignore
		}
	}

	return { ok: true, vendor: resolved.vendor, result: parsedResult };
}
