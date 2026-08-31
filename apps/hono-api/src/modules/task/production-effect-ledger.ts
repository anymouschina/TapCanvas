import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import {
	VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION,
	type VideoProductionWorkflowEventKind,
	type VideoProductionWorkflowNodeId,
} from "@tapcanvas/video-orchestrator-protocol";
import { getPrismaClient } from "../../platform/node/prisma";

export const PRODUCTION_EFFECT_LEDGER_VERSION = 1 as const;

export const PRODUCTION_EFFECT_STATUSES = [
	"reserved",
	"submitting",
	"accepted",
	"materialized",
	"rejected_pre_upstream",
	"uncertain",
	"failed",
	"cancelled",
] as const;
export type ProductionEffectStatus = (typeof PRODUCTION_EFFECT_STATUSES)[number];

export type ProductionEffectRecord = Readonly<{
	id: string;
	runId: string;
	workflowNodeId: VideoProductionWorkflowNodeId;
	effectKey: string;
	revision: number;
	operation: string;
	inputHash: string;
	status: ProductionEffectStatus;
	provider: string | null;
	providerTaskId: string | null;
	providerReceipt: Record<string, unknown> | null;
	assetUrl: string | null;
	errorCode: string | null;
	errorMessage: string | null;
	createdAt: string;
	updatedAt: string;
	acceptedAt: string | null;
	materializedAt: string | null;
	finishedAt: string | null;
}>;

type ProductionEffectRow = Readonly<{
	id: string;
	run_id: string;
	workflow_node_id: string;
	effect_key: string;
	revision: number;
	operation: string;
	input_hash: string;
	status: string;
	provider: string | null;
	provider_task_id: string | null;
	provider_receipt: string | null;
	asset_url: string | null;
	error_code: string | null;
	error_message: string | null;
	created_at: string;
	updated_at: string;
	accepted_at: string | null;
	materialized_at: string | null;
	finished_at: string | null;
}>;

const ALLOWED_TRANSITIONS: Readonly<Record<ProductionEffectStatus, ReadonlySet<ProductionEffectStatus>>> = {
	reserved: new Set(["submitting", "rejected_pre_upstream", "uncertain", "cancelled"]),
	submitting: new Set(["accepted", "rejected_pre_upstream", "uncertain"]),
	accepted: new Set(["materialized", "failed"]),
	uncertain: new Set(["accepted", "materialized", "failed"]),
	materialized: new Set(),
	rejected_pre_upstream: new Set(),
	failed: new Set(),
	cancelled: new Set(),
};

function requireText(value: unknown, field: string): string {
	const normalized = typeof value === "string" ? value.trim() : "";
	if (!normalized) throw new Error(`${field} is required`);
	return normalized;
}

function readStatus(value: string): ProductionEffectStatus {
	if ((PRODUCTION_EFFECT_STATUSES as readonly string[]).includes(value)) {
		return value as ProductionEffectStatus;
	}
	throw new Error(`production effect has invalid status: ${value}`);
}

function parseReceipt(value: string | null): Record<string, unknown> | null {
	if (!value) return null;
	const parsed: unknown = JSON.parse(value);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("production effect provider receipt must be a JSON object");
	}
	return parsed as Record<string, unknown>;
}

function toRecord(row: ProductionEffectRow): ProductionEffectRecord {
	return {
		id: row.id,
		runId: row.run_id,
		workflowNodeId: row.workflow_node_id as VideoProductionWorkflowNodeId,
		effectKey: row.effect_key,
		revision: row.revision,
		operation: row.operation,
		inputHash: row.input_hash,
		status: readStatus(row.status),
		provider: row.provider,
		providerTaskId: row.provider_task_id,
		providerReceipt: parseReceipt(row.provider_receipt),
		assetUrl: row.asset_url,
		errorCode: row.error_code,
		errorMessage: row.error_message,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		acceptedAt: row.accepted_at,
		materializedAt: row.materialized_at,
		finishedAt: row.finished_at,
	};
}

export function buildProductionEffectId(input: {
	runId: string;
	workflowNodeId: VideoProductionWorkflowNodeId;
	effectKey: string;
	revision: number;
	operation: string;
	inputHash: string;
}): string {
	if (!Number.isInteger(input.revision) || input.revision < 1) {
		throw new Error("production effect revision must be a positive integer");
	}
	const identity = [
		PRODUCTION_EFFECT_LEDGER_VERSION,
		requireText(input.runId, "runId"),
		input.workflowNodeId,
		requireText(input.effectKey, "effectKey"),
		input.revision,
		requireText(input.operation, "operation"),
		requireText(input.inputHash, "inputHash"),
	].join("\u001f");
	return `effect_${createHash("sha256").update(identity).digest("hex")}`;
}

export function assertProductionEffectTransition(
	from: ProductionEffectStatus,
	to: ProductionEffectStatus,
): void {
	if (from === to) return;
	if (!ALLOWED_TRANSITIONS[from].has(to)) {
		throw new Error(`invalid production effect transition: ${from} -> ${to}`);
	}
}

async function lockWorkflowRun(db: Prisma.TransactionClient, runId: string): Promise<void> {
	// pg_advisory_xact_lock returns PostgreSQL void. Prisma's query decoder
	// cannot deserialize that type, so this lock is an execute-only statement.
	await db.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
}

async function appendLockedWorkflowEvent(input: {
	db: Prisma.TransactionClient;
	runId: string;
	workflowNodeId: VideoProductionWorkflowNodeId;
	kind: VideoProductionWorkflowEventKind;
	payloadRef: string | null;
	artifactIds?: readonly string[];
	effectIds?: readonly string[];
	createdAt: string;
}): Promise<number> {
	const aggregate = await input.db.production_workflow_events.aggregate({
		where: { run_id: input.runId },
		_max: { seq: true },
	});
	const seq = (aggregate._max.seq ?? 0) + 1;
	await input.db.production_workflow_events.create({
		data: {
			id: randomUUID(),
			run_id: input.runId,
			seq,
			workflow_node_id: input.workflowNodeId,
			event_kind: input.kind,
			payload_ref: input.payloadRef,
			artifact_ids: JSON.stringify(input.artifactIds ?? []),
			effect_ids: JSON.stringify(input.effectIds ?? []),
			created_at: input.createdAt,
		},
	});
	return seq;
}

export async function appendProductionWorkflowEvent(input: {
	runId: string;
	workflowNodeId: VideoProductionWorkflowNodeId;
	kind: VideoProductionWorkflowEventKind;
	payloadRef?: string | null;
	artifactIds?: readonly string[];
	effectIds?: readonly string[];
	createdAt: string;
}): Promise<number> {
	const runId = requireText(input.runId, "runId");
	return await getPrismaClient().$transaction(async (db) => {
		await lockWorkflowRun(db, runId);
		return await appendLockedWorkflowEvent({ ...input, runId, payloadRef: input.payloadRef ?? null, db });
	});
}

export async function reserveProductionEffect(input: {
	runId: string;
	workflowNodeId: VideoProductionWorkflowNodeId;
	effectKey: string;
	revision?: number;
	operation: string;
	inputHash: string;
	createdAt: string;
}): Promise<{ effect: ProductionEffectRecord; created: boolean; eventSeq: number | null }> {
	const runId = requireText(input.runId, "runId");
	const effectKey = requireText(input.effectKey, "effectKey");
	const operation = requireText(input.operation, "operation");
	const inputHash = requireText(input.inputHash, "inputHash");
	return await getPrismaClient().$transaction(async (db) => {
		await lockWorkflowRun(db, runId);
		const run = await db.video_runs.findUnique({
			where: { id: runId },
			select: { state: true },
		});
		if (!run) throw new Error(`production run not found while reserving effect: ${runId}`);
		if (["concatenated", "failed", "cancelled"].includes(run.state)) {
			throw new Error(`production run rejects new effects in terminal state ${run.state}: ${runId}`);
		}
		const latest = await db.production_effects.findFirst({
			where: { run_id: runId, effect_key: effectKey },
			orderBy: { revision: "desc" },
		});
		if (
			input.revision === undefined &&
			latest &&
			[
				"reserved",
				"submitting",
				"accepted",
				"uncertain",
				"materialized",
			].includes(latest.status) &&
			latest.workflow_node_id === input.workflowNodeId &&
			latest.operation === operation &&
			latest.input_hash === inputHash
		) {
			return { effect: toRecord(latest as ProductionEffectRow), created: false, eventSeq: null };
		}
		const revision = input.revision ?? ((latest?.revision ?? 0) + 1);
		if (!Number.isInteger(revision) || revision < 1) {
			throw new Error("production effect revision must be a positive integer");
		}
		const id = buildProductionEffectId({ ...input, runId, effectKey, operation, inputHash, revision });
		const existing = await db.production_effects.findUnique({
			where: { run_id_effect_key_revision: { run_id: runId, effect_key: effectKey, revision } },
		});
		if (existing) {
			if (
				existing.workflow_node_id !== input.workflowNodeId ||
				existing.operation !== operation ||
				existing.input_hash !== inputHash
			) {
				throw new Error(`production effect revision belongs to a different contract: ${runId}/${effectKey}/${revision}`);
			}
			return { effect: toRecord(existing as ProductionEffectRow), created: false, eventSeq: null };
		}
		const created = await db.production_effects.create({
			data: {
				id,
				run_id: runId,
				workflow_node_id: input.workflowNodeId,
				effect_key: effectKey,
				revision,
				operation,
				input_hash: inputHash,
				status: "reserved",
				created_at: input.createdAt,
				updated_at: input.createdAt,
			},
		});
		const eventSeq = await appendLockedWorkflowEvent({
			db,
			runId,
			workflowNodeId: input.workflowNodeId,
			kind: "effect",
			payloadRef: `production-effect:${id}:reserved`,
			effectIds: [id],
			createdAt: input.createdAt,
		});
		return { effect: toRecord(created as ProductionEffectRow), created: true, eventSeq };
	});
}

export async function transitionProductionEffect(input: {
	effectId: string;
	toStatus: ProductionEffectStatus;
	updatedAt: string;
	provider?: string | null;
	providerTaskId?: string | null;
	providerReceipt?: Readonly<Record<string, unknown>> | null;
	assetUrl?: string | null;
	errorCode?: string | null;
	errorMessage?: string | null;
}): Promise<{ effect: ProductionEffectRecord; changed: boolean; eventSeq: number | null }> {
	const effectId = requireText(input.effectId, "effectId");
	return await getPrismaClient().$transaction(async (db) => {
		const before = await db.production_effects.findUnique({ where: { id: effectId } });
		if (!before) throw new Error(`production effect not found: ${effectId}`);
		await lockWorkflowRun(db, before.run_id);
		const current = await db.production_effects.findUnique({ where: { id: effectId } });
		if (!current) throw new Error(`production effect disappeared while locked: ${effectId}`);
		const currentStatus = readStatus(current.status);
		assertProductionEffectTransition(currentStatus, input.toStatus);
		const provider = input.provider === undefined ? current.provider : input.provider;
		const providerTaskId = input.providerTaskId === undefined ? current.provider_task_id : input.providerTaskId;
		const providerReceipt = input.providerReceipt === undefined
			? current.provider_receipt
			: input.providerReceipt === null ? null : JSON.stringify(input.providerReceipt);
		const assetUrl = input.assetUrl === undefined ? current.asset_url : input.assetUrl;
		if (current.provider_task_id && providerTaskId !== current.provider_task_id) {
			throw new Error(`production effect provider task identity is immutable: ${effectId}`);
		}
		if (current.asset_url && assetUrl !== current.asset_url) {
			throw new Error(`production effect materialized asset URL is immutable: ${effectId}`);
		}
		if (input.toStatus === "accepted" && (!provider || !providerTaskId)) {
			throw new Error("accepted production effect requires provider and providerTaskId");
		}
		if (input.toStatus === "materialized") {
			if (!assetUrl) throw new Error("materialized production effect requires assetUrl");
			const parsedUrl = new URL(assetUrl);
			if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
				throw new Error("materialized production effect assetUrl must use HTTP(S)");
			}
		}
		const changed = currentStatus !== input.toStatus ||
			provider !== current.provider ||
			providerTaskId !== current.provider_task_id ||
			providerReceipt !== current.provider_receipt ||
			assetUrl !== current.asset_url ||
			(input.errorCode !== undefined && input.errorCode !== current.error_code) ||
			(input.errorMessage !== undefined && input.errorMessage !== current.error_message);
		if (!changed) return { effect: toRecord(current as ProductionEffectRow), changed: false, eventSeq: null };
		const terminal = input.toStatus === "materialized" || input.toStatus === "rejected_pre_upstream" ||
			input.toStatus === "failed" || input.toStatus === "cancelled";
		const updated = await db.production_effects.update({
			where: { id: effectId },
			data: {
				status: input.toStatus,
				provider,
				provider_task_id: providerTaskId,
				provider_receipt: providerReceipt,
				asset_url: assetUrl,
				...(input.errorCode !== undefined ? { error_code: input.errorCode } : {}),
				...(input.errorMessage !== undefined ? { error_message: input.errorMessage } : {}),
				updated_at: input.updatedAt,
				...(input.toStatus === "accepted" && !current.accepted_at ? { accepted_at: input.updatedAt } : {}),
				...(input.toStatus === "materialized" && !current.materialized_at ? { materialized_at: input.updatedAt } : {}),
				...(terminal && !current.finished_at ? { finished_at: input.updatedAt } : {}),
			},
		});
		const eventSeq = await appendLockedWorkflowEvent({
			db,
			runId: updated.run_id,
			workflowNodeId: updated.workflow_node_id as VideoProductionWorkflowNodeId,
			kind: "effect",
			payloadRef: `production-effect:${effectId}:${input.toStatus}`,
			effectIds: [effectId],
			createdAt: input.updatedAt,
		});
		return { effect: toRecord(updated as ProductionEffectRow), changed: true, eventSeq };
	});
}

export async function findLatestProductionEffect(input: {
	runId: string;
	effectKey: string;
}): Promise<ProductionEffectRecord | null> {
	const row = await getPrismaClient().production_effects.findFirst({
		where: { run_id: requireText(input.runId, "runId"), effect_key: requireText(input.effectKey, "effectKey") },
		orderBy: { revision: "desc" },
	});
	return row ? toRecord(row as ProductionEffectRow) : null;
}

export async function latestProductionWorkflowEventSeq(runIdValue: string): Promise<number> {
	const runId = requireText(runIdValue, "runId");
	const aggregate = await getPrismaClient().production_workflow_events.aggregate({
		where: { run_id: runId },
		_max: { seq: true },
	});
	return aggregate._max.seq ?? 0;
}

export async function assertProductionRunAllowsNewEffects(runIdValue: string): Promise<void> {
	const runId = requireText(runIdValue, "runId");
	const run = await getPrismaClient().video_runs.findUnique({
		where: { id: runId },
		select: { state: true },
	});
	if (!run) throw new Error(`production run not found before effect submission: ${runId}`);
	if (["concatenated", "failed", "cancelled"].includes(run.state)) {
		throw new Error(`production run rejects new effects in terminal state ${run.state}: ${runId}`);
	}
}

export type ProductionEffectCancellationReceipt = Readonly<{
	runId: string;
	cancelledBeforeUpstream: number;
	markedUncertainDuringSubmit: number;
	preservedAcceptedUncertainOrMaterialized: number;
	eventSeq: number;
}>;

/**
 * Stops only effects that are provably pre-upstream. A `submitting` request is
 * ambiguous and becomes `uncertain`; accepted/materialized identities are
 * immutable evidence and remain visible after cancellation.
 */
export async function cancelProductionEffectsForRuns(input: {
	runIds: readonly string[];
	cancelledAt: string;
}): Promise<ProductionEffectCancellationReceipt[]> {
	const runIds = [...new Set(input.runIds.map((runId) => runId.trim()).filter(Boolean))];
	const receipts: ProductionEffectCancellationReceipt[] = [];
	for (const runId of runIds) {
		const receipt = await getPrismaClient().$transaction(async (db) => {
			await lockWorkflowRun(db, runId);
			const cancelled = await db.production_effects.updateMany({
				where: { run_id: runId, status: "reserved" },
				data: {
					status: "cancelled",
					error_code: "run_cancelled_before_upstream",
					error_message: "Run cancellation confirmed before provider submission.",
					updated_at: input.cancelledAt,
					finished_at: input.cancelledAt,
				},
			});
			const uncertain = await db.production_effects.updateMany({
				where: { run_id: runId, status: "submitting" },
				data: {
					status: "uncertain",
					error_code: "run_cancelled_during_submit",
					error_message: "Run was cancelled while provider acceptance was uncertain; reconciliation evidence is preserved.",
					updated_at: input.cancelledAt,
				},
			});
			const preservedAcceptedUncertainOrMaterialized = await db.production_effects.count({
				where: {
					run_id: runId,
					status: { in: ["accepted", "uncertain", "materialized"] },
				},
			});
			const eventSeq = await appendLockedWorkflowEvent({
				db,
				runId,
				workflowNodeId: "media-production",
				kind: "status",
				payloadRef: "run:cancellation_requested",
				createdAt: input.cancelledAt,
			});
			return {
				runId,
				cancelledBeforeUpstream: cancelled.count,
				markedUncertainDuringSubmit: uncertain.count,
				preservedAcceptedUncertainOrMaterialized,
				eventSeq,
			};
		});
		receipts.push(receipt);
	}
	return receipts;
}

export const PRODUCTION_WORKFLOW_EVENT_PROTOCOL_VERSION = VIDEO_PRODUCTION_WORKFLOW_PROTOCOL_VERSION;
