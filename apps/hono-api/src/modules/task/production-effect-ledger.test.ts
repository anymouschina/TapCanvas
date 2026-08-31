import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaDb = vi.hoisted(() => ({
	$executeRaw: vi.fn().mockResolvedValue(1),
	production_effects: {
		updateMany: vi.fn(),
		count: vi.fn(),
		findFirst: vi.fn(),
		findUnique: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
	},
	video_runs: {
		findUnique: vi.fn(),
	},
	production_workflow_events: {
		aggregate: vi.fn(),
		create: vi.fn().mockResolvedValue({}),
	},
}));

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		$transaction: async (callback: (db: typeof prismaDb) => Promise<unknown>) => callback(prismaDb),
	}),
}));

import {
	assertProductionEffectTransition,
	buildProductionEffectId,
	cancelProductionEffectsForRuns,
	reserveProductionEffect,
} from "./production-effect-ledger";

beforeEach(() => {
	vi.clearAllMocks();
	prismaDb.$executeRaw.mockResolvedValue(1);
	prismaDb.production_workflow_events.create.mockResolvedValue({});
});

describe("production effect identity", () => {
	it("is deterministic and changes when a replacement revision changes", () => {
		const base = {
			runId: "run-1",
			workflowNodeId: "media-production" as const,
			effectKey: "video-clip:3",
			operation: "video.generate",
			inputHash: "sha256-input",
		};
		const first = buildProductionEffectId({ ...base, revision: 1 });
		expect(buildProductionEffectId({ ...base, revision: 1 })).toBe(first);
		expect(buildProductionEffectId({ ...base, revision: 2 })).not.toBe(first);
	});

	it("reuses an accepted effect with the same contract instead of opening a duplicate revision", async () => {
		prismaDb.video_runs.findUnique.mockResolvedValue({ state: "video_running" });
		prismaDb.production_effects.findFirst.mockResolvedValue({
			id: "effect-accepted",
			run_id: "run-1",
			workflow_node_id: "media-production",
			effect_key: "video-clip:3",
			revision: 1,
			operation: "video.generate",
			input_hash: "sha256-input",
			status: "accepted",
			provider: "newapi",
			provider_task_id: "provider-task-1",
			provider_receipt: null,
			asset_url: null,
			error_code: null,
			error_message: null,
			created_at: "2026-08-10T12:00:00.000Z",
			updated_at: "2026-08-10T12:00:01.000Z",
			accepted_at: "2026-08-10T12:00:01.000Z",
			materialized_at: null,
			finished_at: null,
		});

		const result = await reserveProductionEffect({
			runId: "run-1",
			workflowNodeId: "media-production",
			effectKey: "video-clip:3",
			operation: "video.generate",
			inputHash: "sha256-input",
			createdAt: "2026-08-10T12:00:02.000Z",
		});

		expect(result).toMatchObject({ created: false, eventSeq: null, effect: {
			id: "effect-accepted",
			status: "accepted",
			providerTaskId: "provider-task-1",
		} });
		expect(prismaDb.production_effects.create).not.toHaveBeenCalled();
	});

	it("rejects a reservation after the authoritative run reached a terminal state", async () => {
		prismaDb.video_runs.findUnique.mockResolvedValue({ state: "cancelled" });

		await expect(reserveProductionEffect({
			runId: "run-cancelled",
			workflowNodeId: "media-production",
			effectKey: "video-clip:0",
			operation: "video.generate",
			inputHash: "sha256-input",
			createdAt: "2026-08-10T12:00:00.000Z",
		})).rejects.toThrow("production run rejects new effects in terminal state cancelled");
		expect(prismaDb.production_effects.findFirst).not.toHaveBeenCalled();
	});
});

describe("production effect lifecycle", () => {
	it("allows reconciliation without reopening terminal materialized effects", () => {
		expect(() => assertProductionEffectTransition("reserved", "submitting")).not.toThrow();
		expect(() => assertProductionEffectTransition("submitting", "accepted")).not.toThrow();
		expect(() => assertProductionEffectTransition("uncertain", "accepted")).not.toThrow();
		expect(() => assertProductionEffectTransition("accepted", "materialized")).not.toThrow();
		expect(() => assertProductionEffectTransition("accepted", "cancelled")).toThrow(
			"invalid production effect transition",
		);
		expect(() => assertProductionEffectTransition("uncertain", "cancelled")).toThrow(
			"invalid production effect transition",
		);
		expect(() => assertProductionEffectTransition("submitting", "cancelled")).toThrow(
			"invalid production effect transition",
		);
		expect(() => assertProductionEffectTransition("submitting", "rejected_pre_upstream")).not.toThrow();
		expect(() => assertProductionEffectTransition("materialized", "failed")).toThrow(
			"invalid production effect transition",
		);
	});

	it("requires a new revision after a verified pre-upstream rejection", () => {
		expect(() => assertProductionEffectTransition("rejected_pre_upstream", "submitting")).toThrow(
			"invalid production effect transition",
		);
	});
});

describe("production effect cancellation", () => {
	it("cancels only pre-upstream reservations and preserves ambiguous or accepted evidence", async () => {
		prismaDb.production_effects.updateMany
			.mockResolvedValueOnce({ count: 2 })
			.mockResolvedValueOnce({ count: 1 });
		prismaDb.production_effects.count.mockResolvedValue(4);
		prismaDb.production_workflow_events.aggregate.mockResolvedValue({ _max: { seq: 41 } });

		const receipts = await cancelProductionEffectsForRuns({
			runIds: [" run-1 ", "run-1", ""],
			cancelledAt: "2026-08-10T12:00:00.000Z",
		});

		expect(receipts).toEqual([{
			runId: "run-1",
			cancelledBeforeUpstream: 2,
			markedUncertainDuringSubmit: 1,
			preservedAcceptedUncertainOrMaterialized: 4,
			eventSeq: 42,
		}]);
		expect(prismaDb.$executeRaw).toHaveBeenCalledTimes(1);
		expect(prismaDb.production_effects.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
			where: { run_id: "run-1", status: "reserved" },
			data: expect.objectContaining({ status: "cancelled" }),
		}));
		expect(prismaDb.production_effects.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
			where: { run_id: "run-1", status: "submitting" },
			data: expect.objectContaining({ status: "uncertain" }),
		}));
		expect(prismaDb.production_effects.count).toHaveBeenCalledWith({
			where: {
				run_id: "run-1",
				status: { in: ["accepted", "uncertain", "materialized"] },
			},
		});
		expect(prismaDb.production_workflow_events.create).toHaveBeenCalledWith({
			data: expect.objectContaining({
				run_id: "run-1",
				seq: 42,
				workflow_node_id: "media-production",
				event_kind: "status",
				payload_ref: "run:cancellation_requested",
			}),
		});
	});
});
