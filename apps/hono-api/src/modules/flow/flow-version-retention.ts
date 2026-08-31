import { Prisma } from "@prisma/client";

import { getPrismaClient } from "../../platform/node/prisma";

const FLOW_VERSION_RETENTION_DAYS = 7;
const FLOW_VERSION_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FLOW_VERSION_RETENTION_INITIAL_DELAY_MS = 60 * 1000;
const FLOW_VERSION_RETENTION_BATCH_SIZE = 250;
const FLOW_VERSION_RETENTION_BATCH_PAUSE_MS = 100;

type FlowVersionRetentionCandidate = Readonly<{
	id: string;
}>;

export type FlowVersionRetentionSweepResult = Readonly<{
	cutoffIso: string;
	candidateVersions: number;
	deletedVersions: number;
	batches: number;
	durationMs: number;
}>;

type FlowVersionRetentionSweepOptions = Readonly<{
	now?: Date;
	batchSize?: number;
	pauseBetweenBatchesMs?: number;
}>;

function retentionCutoff(now: Date): string {
	if (!Number.isFinite(now.getTime())) throw new Error("flow version retention requires a valid clock");
	return new Date(now.getTime() - FLOW_VERSION_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer`);
	}
	return value;
}

async function pause(durationMs: number): Promise<void> {
	if (durationMs <= 0) return;
	await new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, durationMs);
		timer.unref?.();
	});
}

async function executeFlowVersionRetentionSweep(
	options: FlowVersionRetentionSweepOptions,
): Promise<FlowVersionRetentionSweepResult> {
	const startedAt = Date.now();
	const cutoffIso = retentionCutoff(options.now ?? new Date());
	const batchSize = positiveInteger(
		options.batchSize ?? FLOW_VERSION_RETENTION_BATCH_SIZE,
		"flow version retention batch size",
	);
	const pauseBetweenBatchesMs = Math.max(
		0,
		Math.trunc(options.pauseBetweenBatchesMs ?? FLOW_VERSION_RETENTION_BATCH_PAUSE_MS),
	);
	const prisma = getPrismaClient();

	// This selection establishes the destructive-operation invariants once:
	// - rank 1 is the newest version of every flow and can never be selected;
	// - versions newer than the seven-day cutoff remain available for rollback;
	// - immutable versions referenced by workflow executions remain auditable.
	// Projects and flows are never mutation targets of this maintenance task.
	const candidates = await prisma.$queryRaw<FlowVersionRetentionCandidate[]>(Prisma.sql`
		WITH ranked_versions AS (
			SELECT
				fv.id,
				fv.flow_id,
				fv.created_at,
				ROW_NUMBER() OVER (
					PARTITION BY fv.flow_id
					ORDER BY fv.created_at DESC, fv.id DESC
				) AS version_rank
			FROM flow_versions fv
		)
		SELECT ranked_versions.id
		FROM ranked_versions
		WHERE ranked_versions.version_rank > 1
			AND ranked_versions.created_at < ${cutoffIso}
			AND NOT EXISTS (
				SELECT 1
				FROM workflow_executions execution
				WHERE execution.flow_version_id = ranked_versions.id
			)
		ORDER BY ranked_versions.created_at ASC, ranked_versions.id ASC
	`);

	let deletedVersions = 0;
	let batches = 0;
	for (let offset = 0; offset < candidates.length; offset += batchSize) {
		const ids = candidates.slice(offset, offset + batchSize).map((candidate) => candidate.id);
		if (ids.length === 0) continue;
		const deleted = await prisma.flow_versions.deleteMany({
			where: {
				id: { in: ids },
				// Re-check the reference at delete time to close the selection/delete race.
				workflow_executions: { none: {} },
			},
		});
		deletedVersions += deleted.count;
		batches += 1;
		if (offset + batchSize < candidates.length) {
			await pause(pauseBetweenBatchesMs);
		}
	}

	return {
		cutoffIso,
		candidateVersions: candidates.length,
		deletedVersions,
		batches,
		durationMs: Date.now() - startedAt,
	};
}

let activeSweep: Promise<FlowVersionRetentionSweepResult> | null = null;

export async function sweepExpiredFlowVersions(
	options: FlowVersionRetentionSweepOptions = {},
): Promise<FlowVersionRetentionSweepResult> {
	if (activeSweep) return await activeSweep;
	const sweep = executeFlowVersionRetentionSweep(options);
	activeSweep = sweep;
	try {
		return await sweep;
	} finally {
		if (activeSweep === sweep) activeSweep = null;
	}
}

export function startFlowVersionRetentionScheduler(): () => void {
	if (process.env.NODE_ENV === "test") return () => undefined;
	let stopped = false;
	const runSweep = (): void => {
		if (stopped) return;
		void sweepExpiredFlowVersions()
			.then((result) => {
				console.info("[flow-version-retention] sweep completed", result);
			})
			.catch((error: unknown) => {
				console.error("[flow-version-retention] sweep failed", error);
			});
	};
	const initialTimer = setTimeout(runSweep, FLOW_VERSION_RETENTION_INITIAL_DELAY_MS);
	const intervalTimer = setInterval(runSweep, FLOW_VERSION_RETENTION_INTERVAL_MS);
	initialTimer.unref?.();
	intervalTimer.unref?.();
	return () => {
		stopped = true;
		clearTimeout(initialTimer);
		clearInterval(intervalTimer);
	};
}
