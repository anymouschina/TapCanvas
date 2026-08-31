import { describe, expect, it } from "vitest";
import {
	FlowStorageEnvelopeError,
	mergeFlowStorageEnvelope,
} from "./flow.storage-envelope";

describe("mergeFlowStorageEnvelope", () => {
	it("preserves storage metadata omitted by a graph-only writer", () => {
		const current = JSON.stringify({
			nodes: [{ id: "old" }],
			edges: [{ id: "old-edge" }],
			viewport: { x: 1, y: 2, zoom: 1 },
			__tapcanvasFlowOwner: { ownerType: "project", ownerId: "project-1" },
			sceneCreationProgress: { stage: "images" },
		});
		const next = JSON.stringify({
			nodes: [{ id: "new" }],
			edges: [],
			viewport: null,
		});

		expect(JSON.parse(mergeFlowStorageEnvelope(current, next))).toEqual({
			nodes: [{ id: "new" }],
			edges: [],
			viewport: null,
			__tapcanvasFlowOwner: { ownerType: "project", ownerId: "project-1" },
			sceneCreationProgress: { stage: "images" },
		});
	});

	it("uses explicitly supplied metadata instead of the previous value", () => {
		const current = JSON.stringify({
			nodes: [],
			edges: [],
			sceneCreationProgress: { stage: "images" },
		});
		const next = JSON.stringify({
			nodes: [],
			edges: [],
			sceneCreationProgress: null,
		});

		expect(JSON.parse(mergeFlowStorageEnvelope(current, next))).toMatchObject({
			sceneCreationProgress: null,
		});
	});

	it("never restores omitted graph fields from the previous graph", () => {
		const current = JSON.stringify({
			nodes: [{ id: "old" }],
			edges: [{ id: "old-edge" }],
			viewport: { x: 1, y: 2, zoom: 1 },
		});
		const next = JSON.stringify({ nodes: [], edges: [] });

		expect(JSON.parse(mergeFlowStorageEnvelope(current, next))).toEqual({
			nodes: [],
			edges: [],
		});
	});

	it("fails explicitly instead of replacing malformed persisted data", () => {
		expect(() => mergeFlowStorageEnvelope("not-json", "{}"))
			.toThrow(FlowStorageEnvelopeError);
		expect(() => mergeFlowStorageEnvelope("{}", "[]"))
			.toThrow(FlowStorageEnvelopeError);
	});
});
