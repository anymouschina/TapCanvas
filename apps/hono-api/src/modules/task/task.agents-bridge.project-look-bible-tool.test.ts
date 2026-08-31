import { describe, expect, it } from "vitest";
import { inspectAgentsBridgeRemoteToolSurface } from "./task.agents-bridge";

describe("Project Look Bible remote tools", () => {
  it("exposes deferred project read and canvas-scoped confirmation contracts", () => {
    const result = inspectAgentsBridgeRemoteToolSurface({
      publicAgentsRequest: true,
      canvasProjectId: "project-1",
      canvasFlowId: "flow-1",
      bookId: null,
      chapterId: null,
    });
    const getTool = result.catalog.find((tool) => tool.name === "tapcanvas_project_look_bible_get");
    const confirmTool = result.catalog.find((tool) => tool.name === "tapcanvas_project_look_bible_confirm");
    expect(getTool?.requiredScope).toEqual(["project"]);
    expect(confirmTool?.requiredScope).toEqual(["project", "canvas"]);
    expect(result.tools.map((tool) => tool.name)).not.toContain("tapcanvas_project_look_bible_confirm");
  });
});
