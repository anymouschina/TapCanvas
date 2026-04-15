import type { AppContext } from "../../types";
import { TaskResultSchema, type TaskKind, type TaskResultDto } from "./task.schemas";
import { getTaskResultByTaskId, upsertTaskResult } from "./task-result.repo";
import { getVendorTaskRefByTaskId } from "./vendor-task-refs.repo";
import { fetchDreaminaTaskResult } from "../dreamina/dreamina.service";
import {
	fetchApimartTaskResult,
	fetchAsyncDataTaskResult,
	fetchGrsaiDrawTaskResult,
	fetchMappedTaskResultForVendor,
	fetchTuziTaskResult,
} from "./task.service";
import {
	normalizeDispatchVendor,
	normalizeProxyVendorHint,
	shouldUseGrsaiDrawPollingForImageTask,
} from "./task.vendor";

export type TaskPollingMode = "public" | "internal";

export type TaskPollingOutcome =
	| { ok: true; vendor: string; result: TaskResultDto }
	| { ok: false; status: number; body: unknown };

function resolveRefKind(taskKind: TaskKind | null): "video" | "image" | null {
	if (taskKind === "text_to_video" || taskKind === "image_to_video") return "video";
	if (taskKind === "text_to_image" || taskKind === "image_edit") return "image";
	return null;
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
	const vendorInput = typeof input.vendor === "string" ? input.vendor.trim() : "";

	// 1) Stored result fast-path: only terminal results should short-circuit polling.
	let storedRow: any | null = null;
	let storedTaskResult: TaskResultDto | null = null;
	try {
		storedRow = await getTaskResultByTaskId(c.env.DB, userId, taskId);
		if (storedRow?.result) {
			const payload = JSON.parse(storedRow.result);
			const parsed = TaskResultSchema.safeParse(payload);
			if (parsed.success) {
				storedTaskResult = parsed.data;
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
		vendor: vendorInput,
		kind: resolveRefKind(taskKind),
	};

	let inferredFromVendorRef = false;
	if (!resolved.vendor || resolved.vendor.toLowerCase() === "auto") {
		const tryKinds: Array<"video" | "image"> = resolved.kind
			? [resolved.kind]
			: ["video", "image"];
		for (const k of tryKinds) {
			const ref = await getVendorTaskRefByTaskId(c.env.DB, userId, k, taskId);
			if (ref?.vendor) {
				resolved.vendor = ref.vendor;
				resolved.kind = k;
				inferredFromVendorRef = true;
				break;
			}
		}
	}

	resolved.vendor = resolved.vendor.trim();
	if (!resolved.vendor || resolved.vendor.toLowerCase() === "auto") {
		return {
			ok: false,
			status: 400,
			body: {
				error:
					"vendor is required (or the task vendor cannot be inferred)",
				code: "vendor_required",
			},
		};
	}

	// If the stored vendor encodes a proxy/channel (e.g. "comfly:veo"),
	// force that proxy so polling hits the correct upstream.
	{
		const raw = resolved.vendor.trim().toLowerCase();
		const head = raw.split(":")[0]?.trim() || "";
		if (head === "direct") {
			try {
				c.set("proxyDisabled", true);
			} catch {
				// ignore
			}
		}
		const hint = normalizeProxyVendorHint(raw);
		if (hint) {
			try {
				c.set("proxyVendorHint", hint);
			} catch {
				// ignore
			}
		}
	}

	// Hint proxy selector: prefer higher-success channels for this task kind.
	if (taskKind) c.set("routingTaskKind", taskKind);

	const vendorHead = resolved.vendor.trim().toLowerCase().split(":")[0]?.trim() || "";
	const dispatch = normalizeDispatchVendor(resolved.vendor);
	const useGrsaiDrawImagePolling =
		resolved.kind === "image" &&
		shouldUseGrsaiDrawPollingForImageTask(resolved.vendor);
	let result: any;

	if (dispatch === "apimart") {
		result = await fetchApimartTaskResult(c, userId, taskId, prompt, {
			taskKind: (taskKind as any) ?? null,
		});
	} else if (useGrsaiDrawImagePolling) {
		result = await fetchGrsaiDrawTaskResult(c, userId, taskId, {
			taskKind: (taskKind as any) ?? null,
			promptFromClient: prompt,
		});
	} else if (dispatch === "asyncdata") {
		if (resolved.kind === "image") {
			return {
				ok: false,
				status: 400,
				body: {
					error: "asyncdata 仅支持视频任务轮询",
					code: "invalid_task_kind",
				},
			};
		}
		result = await fetchAsyncDataTaskResult(c, userId, taskId, {
			taskKind: (taskKind as any) ?? null,
			promptFromClient: prompt,
		});
	} else if (dispatch === "tuzi") {
		if (resolved.kind === "image") {
			return {
				ok: false,
				status: 400,
				body: {
					error:
						input.mode === "public"
							? "tuzi 图像任务通常为同步返回；如需轮询请携带创建接口返回的 taskId/vendor（或直接使用创建接口返回结果）"
							: "tuzi 图像任务通常为同步返回；请直接使用创建接口返回结果",
					code: "invalid_task_kind",
				},
			};
		}
		result = await fetchTuziTaskResult(c, userId, taskId, {
			taskKind: (taskKind as any) ?? null,
			promptFromClient: prompt,
		});
	} else if (dispatch === "dreamina-cli" || dispatch === "dreamina") {
		const storedRaw =
			storedTaskResult?.raw && typeof storedTaskResult.raw === "object"
				? (storedTaskResult.raw as Record<string, unknown>)
				: {};
		result = await fetchDreaminaTaskResult(c, userId, {
			taskId,
			taskKind: taskKind || storedTaskResult?.kind || "text_to_image",
			projectId:
				typeof storedRaw.projectId === "string" ? storedRaw.projectId : null,
			accountId:
				typeof storedRaw.accountId === "string" ? storedRaw.accountId : null,
		});
	} else if (resolved.kind === "image") {
		return {
			ok: false,
			status: 400,
			body: {
				error:
					"该图像任务不支持轮询（请使用创建接口返回结果，或选择支持轮询的厂商）",
				code: "polling_not_supported",
			},
		};
	} else if (dispatch === "veo") {
		const mapped = await fetchMappedTaskResultForVendor(c, userId, "veo", {
			taskId,
			taskKind: (taskKind as any) ?? null,
			kindHint: "video",
			promptFromClient: prompt,
		});
		if (!mapped) {
			return {
				ok: false,
				status: 400,
				body: {
					error: "厂商 veo 未配置可用的视频结果映射（model_catalog_mappings）",
					code: "mapping_not_configured",
				},
			};
		}
		result = mapped;
	} else {
		// Default: try model-catalog mapping polling (public vendor mapping).
		const mapped = await fetchMappedTaskResultForVendor(c, userId, resolved.vendor, {
			taskId,
			taskKind: (taskKind as any) ?? null,
			kindHint: resolved.kind,
			promptFromClient: prompt,
		});
		if (!mapped) {
			return {
				ok: false,
				status: 400,
				body: {
					error: "该任务未配置可用的结果映射（model_catalog_mappings）",
					code: "mapping_not_configured",
				},
			};
		}
		result = mapped;
	}

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
