import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";

import {
	listProductionWorkflowNodeEvents,
	parseProductionWorkflowEventPageQuery,
} from "./production-workflow-events-query";

describe("production workflow event cursor", () => {
	it("validates the bounded page contract", () => {
		expect(parseProductionWorkflowEventPageQuery({})).toEqual({ beforeSeq: null, limit: 30 });
		expect(parseProductionWorkflowEventPageQuery({ beforeSeq: "101", limit: "50" })).toEqual({ beforeSeq: 101, limit: 50 });
		expect(() => parseProductionWorkflowEventPageQuery({ beforeSeq: "0" })).toThrow("beforeSeq must be a positive integer");
		expect(() => parseProductionWorkflowEventPageQuery({ limit: "101" })).toThrow("limit must be an integer between 1 and 100");
	});

	it("returns a chronological page while querying only one fixed workflow node", async () => {
		const findMany = vi.fn().mockResolvedValue([
			{ id: "event-5", run_id: "run-1", seq: 5, workflow_node_id: "media-production", event_kind: "effect", payload_ref: "effect:5", artifact_ids: "[]", effect_ids: "[\"effect-5\"]", created_at: "2026-08-10T12:00:05.000Z" },
			{ id: "event-4", run_id: "run-1", seq: 4, workflow_node_id: "media-production", event_kind: "artifact", payload_ref: "artifact:4", artifact_ids: "[\"video-result:4\"]", effect_ids: "[]", created_at: "2026-08-10T12:00:04.000Z" },
			{ id: "event-3", run_id: "run-1", seq: 3, workflow_node_id: "media-production", event_kind: "status", payload_ref: "status:3", artifact_ids: "[]", effect_ids: "[]", created_at: "2026-08-10T12:00:03.000Z" },
		]);
		const db = {
			video_runs: { findUnique: vi.fn().mockResolvedValue({ id: "run-1" }) },
			production_workflow_events: { findMany },
		} as unknown as PrismaClient;

		const page = await listProductionWorkflowNodeEvents({
			db,
			runId: "run-1",
			nodeId: "media-production",
			beforeSeq: 10,
			limit: 2,
		});

		expect(findMany).toHaveBeenCalledWith({
			where: { run_id: "run-1", workflow_node_id: "media-production", seq: { lt: 10 } },
			orderBy: { seq: "desc" },
			take: 3,
		});
		expect(page.events.map((event) => event.seq)).toEqual([4, 5]);
		expect(page.nextBeforeSeq).toBe(4);
	});
});
