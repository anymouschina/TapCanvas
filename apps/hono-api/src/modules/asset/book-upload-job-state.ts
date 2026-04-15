export type BookUploadJobStatus = "queued" | "running" | "succeeded" | "failed";

export type BookUploadJobSnapshot = {
	status: BookUploadJobStatus;
	updatedAt?: string | null;
	startedAt?: string | null;
	progress?: {
		phase?: string | null;
		percent?: number | null;
	} | null;
};

function parseIsoMs(value: string | null | undefined): number | null {
	if (typeof value !== "string") return null;
	const text = value.trim();
	if (!text) return null;
	const ms = Date.parse(text);
	return Number.isFinite(ms) ? ms : null;
}

function normalizePhase(value: string | null | undefined): string {
	return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizePercent(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return Math.max(0, Math.trunc(value));
}

export function isStalledBookUploadJob(input: {
	job: BookUploadJobSnapshot;
	nowMs?: number;
	staleAfterMs: number;
}): boolean {
	const { job, staleAfterMs } = input;
	if (job.status !== "queued" && job.status !== "running") return false;
	const nowMs = Number.isFinite(input.nowMs) ? Math.trunc(input.nowMs as number) : Date.now();
	const lastUpdatedMs = parseIsoMs(job.updatedAt) ?? parseIsoMs(job.startedAt);
	if (lastUpdatedMs === null) return false;
	if (nowMs - lastUpdatedMs < staleAfterMs) return false;

	if (job.status === "queued" && !parseIsoMs(job.startedAt)) {
		return true;
	}

	const phase = normalizePhase(job.progress?.phase);
	const percent = normalizePercent(job.progress?.percent);
	if (phase && phase !== "queued") return false;
	return percent === null || percent <= 1;
}
