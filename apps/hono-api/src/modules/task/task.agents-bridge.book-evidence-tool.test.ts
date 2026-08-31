import { describe, expect, it } from "vitest";

import { buildAgentsBridgeRemoteTools } from "./task.agents-bridge";

type JsonSchemaNode = {
	type?: string;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	properties?: Record<string, JsonSchemaNode>;
	required?: readonly string[];
	additionalProperties?: boolean;
};

describe("book evidence remote tool contract", () => {
	it("exposes scoped, read-only evidence search with agent-selected query and range", () => {
		const tools = buildAgentsBridgeRemoteTools({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: "book-1",
			chapterId: "chapter-1",
		});
		const tool = tools.find(
			(candidate) => candidate.name === "tapcanvas_book_evidence_search",
		);
		const schema = tool?.parameters as JsonSchemaNode | undefined;

		expect(tool?.execution).toEqual({
			sideEffect: "none",
			retrySafety: "safe",
			executionMode: "parallel_safe",
			idempotencyKeyField: null,
			resultLookupSupported: true,
		});
		expect(schema?.required).toEqual(["bookId", "query"]);
		expect(schema?.additionalProperties).toBe(false);
		expect(schema?.properties?.query).toMatchObject({
			type: "string",
			minLength: 1,
			maxLength: 500,
		});
		expect(schema?.properties?.chapterStart?.minimum).toBe(1);
		expect(schema?.properties?.chapterEnd?.minimum).toBe(1);
		expect(schema?.properties?.limit).toMatchObject({
			minimum: 1,
			maximum: 20,
	});
	expect(tool?.description).toContain("sourceTextSha256");
	expect(tool?.description).toContain("exact quote");
	expect(tool?.description).toContain("empty results array");
});
});
