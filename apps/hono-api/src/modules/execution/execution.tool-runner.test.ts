import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";
import { invokeWorkflowTool, type WorkflowToolInvocationRequest } from "./execution.tool-runner";

const env = {
  INTERNAL_WORKER_TOKEN: "workflow-test-token",
  TAPCANVAS_API_INTERNAL_BASE: "http://api.test",
} as WorkerEnv;
const request: WorkflowToolInvocationRequest = {
  executionId: "execution-test", nodeId: "source", ownerId: "owner-test",
  projectId: "project-test", flowId: "flow-test",
  toolName: "tapcanvas_analyze_video", args: { nodeId: "video-test", fps: 5 },
};

afterEach(() => { vi.unstubAllGlobals(); });

describe("workflow tool invocation", () => {
  it("invokes a scoped catalog tool using its registered schema and authenticated endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true, content: "observed", data: { text: "observed" },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await invokeWorkflowTool(env, request);
    expect(result.data).toEqual({ text: "observed" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      toolName: request.toolName, canvasProjectId: "project-test", canvasFlowId: "flow-test",
      executionId: "execution-test", args: request.args,
    });
  });

  it("does not widen scope or skip parameter validation for catalog tools", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(invokeWorkflowTool(env, { ...request, projectId: null, flowId: "" }))
      .rejects.toThrow("not authorized");
    await expect(invokeWorkflowTool(env, { ...request, args: { nodeId: "video-test", fps: 99 } }))
      .rejects.toThrow("registered schema");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
