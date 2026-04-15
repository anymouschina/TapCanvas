import type { AppContext } from "../../types";
import type { TaskRequestDto, TaskResultDto } from "./task.schemas";
import { upsertTaskResult } from "./task-result.repo";
import { upsertVendorTaskRef } from "./vendor-task-refs.repo";

export async function maybeWrapSyncImageResultAsStoredTask(
	c: AppContext,
	userId: string,
	input: {
		vendor: string;
		requestKind: TaskRequestDto["kind"];
		result: TaskResultDto;
	},
): Promise<TaskResultDto> {
	const vendor = (input.vendor || "").trim().toLowerCase();
	const requestKind = input.requestKind;
	const result = input.result;

	if (vendor !== "dmxapi") return result;
	if (requestKind !== "text_to_image" && requestKind !== "image_edit") return result;
	if (result?.status !== "succeeded") return result;
	if (!Array.isArray((result as any)?.assets) || (result as any).assets.length <= 0) return result;

	const nowIso = new Date().toISOString();
	const storedTaskId = `task_${crypto.randomUUID()}`;
	const upstreamTaskId =
		typeof (result as any)?.id === "string"
			? String((result as any).id).trim()
			: String((result as any)?.id || "").trim();

	try {
		const finalResult: TaskResultDto = {
			id: storedTaskId,
			kind: result.kind,
			status: "succeeded",
			assets: result.assets,
			raw: {
				provider: "task_store",
				vendor,
				upstreamTaskId: upstreamTaskId || null,
				storedAt: nowIso,
			},
		};
		await upsertTaskResult(c.env.DB, {
			userId,
			taskId: storedTaskId,
			vendor,
			kind: String(result.kind),
			status: "succeeded",
			result: finalResult,
			completedAt: nowIso,
			nowIso,
		});
		await upsertVendorTaskRef(
			c.env.DB,
			userId,
			{
				kind: "image",
				taskId: storedTaskId,
				vendor,
				pid: upstreamTaskId || null,
			},
			nowIso,
		);

		return {
			id: storedTaskId,
			kind: result.kind,
			status: "queued",
			assets: [],
			raw: {
				provider: "task_store",
				vendor,
				upstreamTaskId: upstreamTaskId || null,
				storedResultReady: true,
			},
		};
	} catch (err: any) {
		console.warn(
			"[task-store] persist dmxapi result failed",
			err?.message || err,
		);
		return result;
	}
}

