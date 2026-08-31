import { describe, expect, it } from "vitest";

import { inspectAgentsBridgeRemoteToolSurface } from "./task.agents-bridge";

type JsonSchemaNode = {
	type?: string;
	description?: string;
	properties?: Record<string, JsonSchemaNode>;
	required?: readonly string[];
};

describe("storyboard plan remote tool artifact-only contract", () => {
	it("requires the complete v1.2 artifact without a semantic review attestation", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: "book-1",
			chapterId: "book-1-chapter-1",
		});
		const tool = surface.catalog.find(
			(candidate) => candidate.name === "tapcanvas_book_storyboard_plan_upsert",
		);
		const schema = tool?.parameters as JsonSchemaNode | undefined;

		expect(tool).toBeDefined();
		expect(schema?.required).toEqual(["bookId", "chapter", "storyboardStructured"]);
		expect(schema?.properties).toHaveProperty("storyboardStructured");
		expect(schema?.properties).not.toHaveProperty("semanticReview");
		expect(tool?.description).toContain("canonical SHA-256");
		expect(tool?.description).not.toContain("semantic_review");
	});
});
