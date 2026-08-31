import type { AppContext } from "../../types";
import { resolveTeamCreditsCostForTask } from "../billing/billing.service";
import {
	releaseTeamCreditsOnFailure,
	settleTeamCreditsOnSuccess,
} from "../team/team.service";
import {
	upsertVendorCallLogFinal,
	upsertVendorCallLogPayloads,
	upsertVendorCallLogStarted,
} from "./vendor-call-logs.repo";
import { extractBillingSpecKeyFromTaskRaw } from "./task.billing";
import { normalizeVendorKey } from "./task.vendor-utils";
import { TaskResultSchema } from "./task.schemas";

type TaskResult = ReturnType<typeof TaskResultSchema.parse>;

function normalizeOptionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function readResultBillingIdentity(input: {
	result: TaskResult;
	modelKey?: string | null;
	specKey?: string | null;
}): { modelKey: string | null; specKey: string | null } {
	const raw = readRecord(input.result.raw);
	const response = readRecord(raw?.response);
	const details = readRecord(raw?.details);
	const error = readRecord(raw?.error);
	const errorDetails = readRecord(error?.details);
	const modelKey =
		normalizeOptionalString(input.modelKey) ??
		normalizeOptionalString(raw?.model) ??
		normalizeOptionalString(raw?.modelKey) ??
		normalizeOptionalString(raw?.model_key) ??
		normalizeOptionalString(response?.model) ??
		normalizeOptionalString(response?.modelKey) ??
		normalizeOptionalString(response?.model_key) ??
		normalizeOptionalString(details?.modelKey) ??
		normalizeOptionalString(details?.model_key) ??
		normalizeOptionalString(errorDetails?.modelKey) ??
		normalizeOptionalString(errorDetails?.model_key);
	const specKey =
		normalizeOptionalString(input.specKey) ??
		extractBillingSpecKeyFromTaskRaw(input.result.raw) ??
		normalizeOptionalString(details?.specKey) ??
		normalizeOptionalString(errorDetails?.specKey);
	return { modelKey, specKey };
}

function reportCreditFinalizationFailure(input: {
	taskId: string;
	taskKind: string;
	status: "succeeded" | "failed";
	modelKey: string | null;
	specKey: string | null;
	error: unknown;
}): void {
	console.error(JSON.stringify({
		event: "vendor_call_credit_finalization_failed",
		taskId: input.taskId,
		taskKind: input.taskKind,
		status: input.status,
		modelKey: input.modelKey,
		specKey: input.specKey,
		error: String(input.error instanceof Error ? input.error.message : input.error).slice(0, 600),
	}));
}

async function recordVendorCallStarted(
	c: AppContext,
	input: {
		userId: string;
		vendor: string;
		taskId: string;
		taskKind?: string | null;
	},
): Promise<void> {
	const nowIso = new Date().toISOString();
	try {
		await upsertVendorCallLogStarted(c.env.DB, {
			userId: input.userId,
			vendor: input.vendor,
			taskId: input.taskId,
			taskKind: input.taskKind ?? null,
			nowIso,
		});
	} catch (err: any) {
		console.warn(
			"[vendor-call-logs] upsert started failed",
			err?.message || err,
		);
	}
}

async function recordVendorCallFinal(
	c: AppContext,
	input: {
		userId: string;
		vendor: string;
		taskId: string;
		taskKind?: string | null;
		status: "succeeded" | "failed";
		errorMessage?: string | null;
		durationMs?: number | null;
	},
): Promise<void> {
	const nowIso = new Date().toISOString();
	try {
		await upsertVendorCallLogFinal(c.env.DB, {
			userId: input.userId,
			vendor: input.vendor,
			taskId: input.taskId,
			taskKind: input.taskKind ?? null,
			status: input.status,
			errorMessage: input.errorMessage ?? null,
			durationMs:
				typeof input.durationMs === "number" &&
				Number.isFinite(input.durationMs)
					? Math.max(0, Math.round(input.durationMs))
					: null,
			nowIso,
		});
	} catch (err: any) {
		console.warn(
			"[vendor-call-logs] upsert final failed",
			err?.message || err,
		);
	}
}

export async function recordVendorCallPayloads(
	c: AppContext,
	input: {
		userId: string;
		vendor: string;
		taskId: string;
		taskKind?: string | null;
		request?: unknown;
		upstreamResponse?: unknown;
	},
): Promise<void> {
	const nowIso = new Date().toISOString();
	try {
		await upsertVendorCallLogPayloads(c.env.DB, {
			userId: input.userId,
			vendor: input.vendor,
			taskId: input.taskId,
			taskKind: input.taskKind ?? null,
			request: input.request,
			upstreamResponse: input.upstreamResponse,
			nowIso,
		});
	} catch (err: any) {
		console.warn(
			"[vendor-call-logs] upsert payloads failed",
			err?.message || err,
		);
	}
}

export async function recordVendorCallFromTaskResult(
	c: AppContext,
	input: {
		userId: string;
		vendor: string;
		taskKind?: string | null;
		modelKey?: string | null;
		specKey?: string | null;
		result: TaskResult;
		durationMs?: number | null;
		finalizeCredits?: boolean;
	},
): Promise<void> {
	const taskId =
		typeof input.result?.id === "string" ? input.result.id.trim() : "";
	if (!taskId) return;
	const vendorKey = normalizeVendorKey(input.vendor);
	if (input.result.status === "queued" || input.result.status === "running") {
		await recordVendorCallStarted(c, {
			userId: input.userId,
			vendor: vendorKey,
			taskId,
			taskKind: input.taskKind ?? null,
		});
		return;
	}
	if (input.result.status !== "succeeded" && input.result.status !== "failed") {
		return;
	}

	const errorMessage = (() => {
		if (input.result.status !== "failed") return null;
		const raw: any = input.result?.raw as any;
		const candidates = [
			raw?.failureReason,
			raw?.message,
			raw?.error,
			raw?.response?.failureReason,
			raw?.response?.failure_reason,
			raw?.response?.error?.message,
			raw?.response?.error_message,
			raw?.response?.error,
			raw?.response?.message,
		];
		for (const value of candidates) {
			if (typeof value === "string" && value.trim()) {
				return value.trim();
			}
		}
		return null;
	})();

	await recordVendorCallFinal(c, {
		userId: input.userId,
		vendor: vendorKey,
		taskId,
		taskKind: input.taskKind ?? null,
		status: input.result.status,
		errorMessage,
		durationMs: input.durationMs ?? null,
	});
	if (input.finalizeCredits === false) return;

	const resolvedTaskKind =
		typeof input.taskKind === "string" && input.taskKind.trim()
			? input.taskKind.trim()
			: typeof (input.result as any)?.kind === "string" &&
					(input.result as any).kind.trim()
				? (input.result as any).kind.trim()
				: "";
	if (!resolvedTaskKind) return;

	const billingIdentity = readResultBillingIdentity(input);
	const resolvedModelKey = billingIdentity.modelKey;
	const resolvedSpecKey = billingIdentity.specKey;

	// Team credits: reserved at submit time; settle/release when task ends.
	if (input.result.status === "succeeded") {
		try {
			const amount = await resolveTeamCreditsCostForTask(c, {
				taskKind: resolvedTaskKind,
				modelKey: resolvedModelKey,
				specKey: resolvedSpecKey,
			});
			await settleTeamCreditsOnSuccess(c, input.userId, {
				taskId,
				taskKind: resolvedTaskKind,
				amount,
				vendor: vendorKey,
				modelKey: resolvedModelKey,
				specKey: resolvedSpecKey,
			});
		} catch (error) {
			reportCreditFinalizationFailure({
				taskId,
				taskKind: resolvedTaskKind,
				status: input.result.status,
				modelKey: resolvedModelKey,
				specKey: resolvedSpecKey,
				error,
			});
		}
		return;
	}

	try {
		await releaseTeamCreditsOnFailure(c, input.userId, {
			taskId,
			taskKind: resolvedTaskKind,
			vendor: vendorKey,
			modelKey: resolvedModelKey,
			specKey: resolvedSpecKey,
		});
	} catch (error) {
		reportCreditFinalizationFailure({
			taskId,
			taskKind: resolvedTaskKind,
			status: input.result.status,
			modelKey: resolvedModelKey,
			specKey: resolvedSpecKey,
			error,
		});
	}
}

export async function recordVendorCallLogFromTaskResult(
	c: AppContext,
	input: {
		userId: string;
		vendor: string;
		taskKind?: string | null;
		result: TaskResult;
		durationMs?: number | null;
	},
): Promise<void> {
	await recordVendorCallFromTaskResult(c, {
		...input,
		finalizeCredits: false,
	});
}

export async function recordVendorCallsForTaskResult(
	c: AppContext,
	input: {
		userId: string;
		taskKind?: string | null;
		modelKey?: string | null;
		specKey?: string | null;
		result: TaskResult;
		vendors: Array<string | null | undefined>;
		durationMs?: number | null;
	},
): Promise<void> {
	for (const vendorCandidate of input.vendors) {
		const vendor =
			typeof vendorCandidate === "string" ? vendorCandidate.trim() : "";
		if (!vendor) continue;
		await recordVendorCallFromTaskResult(c, {
			userId: input.userId,
			vendor,
			taskKind: input.taskKind ?? null,
			modelKey: input.modelKey ?? null,
			specKey: input.specKey ?? null,
			result: input.result,
			durationMs: input.durationMs ?? null,
		});
	}
}

export async function recordVendorCallForTaskResult(
	c: AppContext,
	input: {
		userId: string;
		vendor: string;
		taskKind?: string | null;
		modelKey?: string | null;
		specKey?: string | null;
		result: TaskResult;
		durationMs?: number | null;
	},
): Promise<void> {
	await recordVendorCallFromTaskResult(c, {
		userId: input.userId,
		vendor: input.vendor,
		taskKind: input.taskKind ?? null,
		modelKey: input.modelKey ?? null,
		specKey: input.specKey ?? null,
		result: input.result,
		durationMs: input.durationMs ?? null,
	});
}
