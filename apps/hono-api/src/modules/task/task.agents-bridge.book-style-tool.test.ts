import { describe, expect, it } from "vitest";

import { inspectAgentsBridgeRemoteToolSurface } from "./task.agents-bridge";

describe("tapcanvas_book_style_confirm remote tool", () => {
  it("向 agents 暴露结构化书级 Style Bible 确认契约", () => {
		const tool = inspectAgentsBridgeRemoteToolSurface({
      publicAgentsRequest: true,
      canvasProjectId: "project-1",
      canvasFlowId: "flow-1",
			bookId: "book-1",
		}).catalog.find((candidate) => candidate.name === "tapcanvas_book_style_confirm");
    expect(tool).toBeDefined();
    const parameters = tool?.parameters as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(parameters.required).toEqual(
      expect.arrayContaining([
        "bookId",
        "styleName",
        "visualDirectives",
        "negativeDirectives",
        "consistencyRules",
      ]),
    );
		expect(parameters.properties).not.toHaveProperty("characterPromptTemplate");
		expect(parameters.properties).toHaveProperty("referenceImageNodeIds");
		expect(parameters.properties).toHaveProperty("referenceAssetIds");
    expect(parameters.properties).toHaveProperty("confirmed");
  });
});
