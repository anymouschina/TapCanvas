import { describe, expect, it } from "vitest";
import { collectPipelineDependencyFailures, describePipelineDependencyFailure } from "./execution.pipeline-failures";
import type { WorkflowNodeOutputV1 } from "./execution.node-runtime";

function partialOutput(): WorkflowNodeOutputV1 {
  return { protocolVersion: "1", executorRef: "tapcanvas.image.generate/v1", nodeId: "images", executionMode: "each",
    ports: { images: ["https://assets.example/ready.png"] },
    artifacts: [{ type: "tapcanvas.image/v1", identity: "ready", value: "https://assets.example/ready.png" }],
    evidence: { partial: true, completedItems: 1, failedItems: 1 },
    itemRuns: [{ itemId: "missing", index: 1, runtimeNodeId: "images::item::missing", status: "failed",
      ports: {}, artifacts: [], lineage: [], errorCode: "provider_failed", errorMessage: "provider rejected the request: HTTP 451",
      evidence: { taskId: "accepted-task", providerStatus: "failed" } }],
  };
}

describe("pipeline dependency failure evidence", () => {
  it("exposes the actual partial ancestor failure while preserving successful output", () => {
    const output = partialOutput();
    const before = JSON.stringify(output);
    const failures = collectPipelineDependencyFailures({ stepId: "bind",
      bindings: [{ from: { kind: "step", stepId: "images", portId: "images" }, to: { stepId: "bind", portId: "references" }, mode: "value" }],
      receipts: { images: { status: "success", outputRefs: output } },
    });
    expect(failures).toEqual([{ stepId: "images", runtimeNodeId: "images::item::missing", itemId: "missing",
      taskId: "accepted-task", providerStatus: "failed", errorCode: "provider_failed", errorMessage: "provider rejected the request: HTTP 451" }]);
    expect(describePipelineDependencyFailure("missing URL", failures)).toContain("HTTP 451");
    expect(JSON.stringify(output)).toBe(before);
  });

  it("does not attribute an unrelated branch failure to the current action", () => {
    expect(collectPipelineDependencyFailures({ stepId: "bind", bindings: [],
      receipts: { unrelated: { status: "success", outputRefs: partialOutput() } },
    })).toEqual([]);
    expect(describePipelineDependencyFailure("missing URL", [])).toBe("missing URL");
  });

  it("follows declared transitive bindings and nested pipeline receipts without parsing error text", () => {
    const outer = { ...partialOutput(), itemRuns: [], evidence: { pipelineState: {
      protocolVersion: "workflow.pipeline.state/v1", steps: { nested: { status: "success", outputRefs: partialOutput() } },
    } } };
    const failures = collectPipelineDependencyFailures({ stepId: "bind", bindings: [
      { from: { kind: "step", stepId: "source", portId: "images" }, to: { stepId: "pass", portId: "images" }, mode: "value" },
      { from: { kind: "step", stepId: "pass", portId: "images" }, to: { stepId: "bind", portId: "images" }, mode: "value" },
    ], receipts: { source: { status: "success", outputRefs: outer }, pass: { status: "success" } } });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ stepId: "source", taskId: "accepted-task" });
  });
});
