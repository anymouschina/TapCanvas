import { describe, expect, it } from "vitest";

import { inspectAgentsBridgeRemoteToolSurface } from "./task.agents-bridge";

function getExplicitCriticTool() {
	return inspectAgentsBridgeRemoteToolSurface({
		publicAgentsRequest: true,
		canvasProjectId: "project-critic-schema",
		canvasFlowId: "flow-critic-schema",
	}).explicitCapabilityTools.find(
		(candidate) => candidate.name === "tapcanvas_shot_table_critic",
	);
}

describe("tapcanvas_shot_table_critic remote schema", () => {
	it("is hidden by default and available only as an explicit capability", () => {
		const surface = inspectAgentsBridgeRemoteToolSurface({
      publicAgentsRequest: true,
      canvasProjectId: null,
      canvasFlowId: null,
    });

		expect(surface.tools).toEqual([]);
		expect(surface.catalog).toEqual([]);
		expect(surface.explicitCapabilityTools.map((tool) => tool.name)).toEqual([
			"tapcanvas_shot_table_critic",
		]);
		expect(surface.explicitCapabilityTools[0]?.execution).toEqual({
      sideEffect: "none",
      retrySafety: "safe",
      executionMode: "parallel_safe",
      idempotencyKeyField: null,
      resultLookupSupported: true,
    });
  });

  it("does not expose execution-model selection to the language model", () => {
		const tool = getExplicitCriticTool();

    expect(tool).toBeDefined();
    const properties = tool?.parameters?.properties as Record<string, unknown> | undefined;
    expect(properties).not.toHaveProperty("criticModel");
    expect(tool?.parameters?.required ?? []).not.toContain("criticModel");
  });

  it("does not expose an adaptation-courage input that could reward source drift", () => {
		const tool = getExplicitCriticTool();

    expect(tool).toBeDefined();
    const properties = tool?.parameters?.properties as Record<string, unknown> | undefined;
    expect(properties).not.toHaveProperty("adaptationStrategy");
  });

  it("separates text-storyboard and video-clips diagnostic review modes", () => {
		const tool = getExplicitCriticTool();

    const properties = tool?.parameters?.properties as Record<string, unknown> | undefined;
    expect(properties?.reviewMode).toMatchObject({
      type: "string",
      enum: ["text_storyboard", "video_clips"],
    });
    expect(properties?.shotTable).toMatchObject({ type: "string" });
    expect(properties?.sourceMaterial).toMatchObject({ type: "string" });
    expect(properties?.reviewContract).toMatchObject({ type: "object" });
    expect(properties).not.toHaveProperty("groupId");
    expect(tool?.parameters?.required).toContain("reviewMode");
  });
});
