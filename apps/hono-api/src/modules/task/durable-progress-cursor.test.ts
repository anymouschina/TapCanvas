import { describe, expect, it } from "vitest";

import { parseDurableProgressCursor } from "./durable-progress-cursor";

describe("parseDurableProgressCursor", () => {
	it("preserves a graph-neutral cursor without interpreting domain unit names", () => {
		expect(parseDurableProgressCursor({
			version: 1,
			graph: " future-domain ",
			scopeId: " project-7:repair-frontier ",
			phase: " composing ",
			revision: " rev-7 ",
			completedUnitIds: ["part:0", "part:0", "part:1"],
			pendingUnitIds: ["part:2"],
			allowedNextActions: ["write_part"],
			requiredReadActions: ["read_part_contract", "read_part_contract"],
			allowedSupportingTools: ["read_part_asset", "read_part_asset"],
		})).toEqual({
			version: 1,
			graph: "future-domain",
			scopeId: "project-7:repair-frontier",
			phase: "composing",
			revision: "rev-7",
			executionGeneration: null,
			completedUnitIds: ["part:0", "part:1"],
			pendingUnitIds: ["part:2"],
			allowedNextActions: ["write_part"],
			requiredReadActions: ["read_part_contract"],
			allowedSupportingTools: ["read_part_asset"],
		});
	});

	it("normalizes omitted optional repair-frontier fields without inventing values", () => {
		expect(parseDurableProgressCursor({
			version: 1,
			graph: "video_authoring",
			phase: "preflight",
		})).toEqual({
			version: 1,
			graph: "video_authoring",
			scopeId: null,
			phase: "preflight",
			revision: null,
			executionGeneration: null,
			completedUnitIds: [],
			pendingUnitIds: [],
			allowedNextActions: [],
			requiredReadActions: [],
			allowedSupportingTools: [],
		});
	});

	it("rejects malformed cursor identity instead of preserving arbitrary records", () => {
		expect(parseDurableProgressCursor({ version: 1, graph: "", phase: "draft" })).toBeNull();
		expect(parseDurableProgressCursor({ version: 2, graph: "video", phase: "draft" })).toBeNull();
	});

	it("rejects oversized identity fields instead of truncating them into another cursor", () => {
		const valid = {
			version: 1,
			graph: "video_authoring",
			scopeId: "run-1:preflight",
			phase: "draft",
			revision: "revision-1",
			executionGeneration: "lease-1",
			completedUnitIds: ["beat:0"],
			pendingUnitIds: ["beat:1"],
			allowedNextActions: ["put_beat"],
			requiredReadActions: ["get_header"],
			allowedSupportingTools: ["chapter_get"],
		};
		for (const [field, oversized] of [
			["graph", "g".repeat(161)],
			["phase", "p".repeat(161)],
			["scopeId", "s".repeat(257)],
			["revision", "r".repeat(257)],
			["executionGeneration", "e".repeat(257)],
		] as const) {
			expect(parseDurableProgressCursor({ ...valid, [field]: oversized })).toBeNull();
		}
	});

	it("rejects oversized or malformed cursor lists instead of dropping authorization facts", () => {
		const valid = {
			version: 1,
			graph: "video_authoring",
			phase: "draft",
		};
		for (const field of [
			"completedUnitIds",
			"pendingUnitIds",
			"allowedNextActions",
			"requiredReadActions",
			"allowedSupportingTools",
		] as const) {
			expect(parseDurableProgressCursor({
				...valid,
				[field]: Array.from({ length: 129 }, (_, index) => `${field}-${index}`),
			})).toBeNull();
			expect(parseDurableProgressCursor({ ...valid, [field]: ["x".repeat(257)] })).toBeNull();
			expect(parseDurableProgressCursor({ ...valid, [field]: [42] })).toBeNull();
		}
	});
});
