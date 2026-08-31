import { describe, expect, it } from "vitest";

import { inspectAgentsBridgeRemoteToolSurface } from "./task.agents-bridge";

type JsonSchemaNode = {
	type?: string;
	description?: string;
	properties?: Record<string, JsonSchemaNode>;
	items?: JsonSchemaNode;
	allOf?: readonly JsonSchemaNode[];
	oneOf?: readonly JsonSchemaNode[];
	enum?: readonly unknown[];
	required?: readonly string[];
	const?: unknown;
};

describe("story facts remote tool contract", () => {
	it("exposes a read tool and an idempotent CAS commit tool in project scope", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: null,
			bookId: "book-1",
			chapterId: "chapter-1",
		});
		const readTool = surface.tools.find((tool) => tool.name === "tapcanvas_story_facts_get");
		const commitTool = surface.catalog.find((tool) => tool.name === "tapcanvas_story_facts_commit");

		expect(readTool?.execution).toEqual({
			sideEffect: "none",
			retrySafety: "safe",
			executionMode: "parallel_safe",
			idempotencyKeyField: null,
			resultLookupSupported: true,
		});
		expect(commitTool?.execution).toEqual({
			sideEffect: "external_mutation",
			retrySafety: "idempotency_key_required",
			executionMode: "sequential",
			idempotencyKeyField: "commitId",
			resultLookupSupported: true,
		});
	});

	it("requires persisted source evidence, expectedRevision, and explicit fact operations", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			bookId: "book-1",
			chapterId: "chapter-1",
		});
		const readTool = surface.tools.find((tool) => tool.name === "tapcanvas_story_facts_get");
		const commitTool = surface.catalog.find((tool) => tool.name === "tapcanvas_story_facts_commit");
		const readSchema = readTool?.parameters as JsonSchemaNode | undefined;
		const schema = commitTool?.parameters as JsonSchemaNode | undefined;
		const source = schema?.properties?.source;
		const operations = schema?.properties?.operations;

		expect(readSchema?.required).toEqual(["bookId", "projection"]);
		expect(readSchema?.properties?.projection?.enum).toEqual([
			"authoring",
			"audience_safe",
		]);
		expect(schema?.required).toEqual([
			"bookId",
			"commitId",
			"expectedRevision",
			"source",
			"operations",
		]);
		expect(source?.oneOf?.map((candidate) => candidate.properties?.kind?.const)).toEqual([
			"chapter_canvas_node",
			"book_chapter",
			"creative_brief",
		]);
		expect(operations?.items?.oneOf?.map((candidate) => candidate.properties?.type?.const)).toEqual([
			"add",
			"close",
			"set_status",
			"set_disclosure",
		]);
		expect(operations?.items?.oneOf?.[0]?.required).toContain("disclosure");
		expect(
			operations?.items?.oneOf?.[0]?.properties?.disclosure?.oneOf?.map(
				(candidate) => candidate.properties?.mode?.const,
			),
		).toEqual(["immediate", "gated"]);
		expect(
			operations?.items?.oneOf?.[3]?.properties?.expectedDisclosure?.oneOf?.map(
				(candidate) => candidate.properties?.mode?.const,
			),
		).toEqual(["immediate", "gated"]);
		expect(
			operations?.items?.oneOf?.[0]?.properties?.status?.enum,
		).toEqual(["confirmed", "inferred", "draft_choice"]);
		expect(commitTool?.description).toContain("fresh-reads and hashes the persisted source");
		expect(commitTool?.description).toContain("partialSuccess=true");
		expect(readSchema?.properties?.offset?.type).toBe("number");
		expect(readTool?.description).toContain("mixed revisions are not one consistent snapshot");
	});
});
