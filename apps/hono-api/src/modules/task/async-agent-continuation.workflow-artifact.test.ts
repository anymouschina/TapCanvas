import { describe, expect, it } from "vitest";

import type { AsyncAgentContinuationArtifactDependencyV2 } from "./async-agent-continuation";
import { collectWorkflowExecutionMaterializedArtifacts } from "./async-agent-continuation.workflow-artifact";

const dependency: AsyncAgentContinuationArtifactDependencyV2 = {
	version: 2,
	artifactId: "video:run:workflow-family-1",
	nodeId: null,
	taskId: null,
	runId: "workflow-family-1",
	runProtocol: "workflow_execution_family",
};

describe("workflow continuation materialized artifact evidence", () => {
	it("extracts a verified persistent master video from a successful family member", () => {
		const result = collectWorkflowExecutionMaterializedArtifacts({
			dependency,
			nodeRuns: [{
				execution_id: "workflow-execution-success",
				node_id: "delivery-verify",
				status: "success",
				finished_at: "2026-08-28T13:07:15.415Z",
				output_refs: JSON.stringify({
					artifacts: [{
						type: "tapcanvas.master-video/v1",
						identity: "delivery-verify",
						value: "https://assets.example/chapter-1.mp4",
					}],
					evidence: {
						executorCompleted: true,
						verifiedItems: 1,
						expectedArtifactType: "tapcanvas.master-video/v1",
					},
				}),
			}],
		});

		expect(result).toEqual([{
			version: 1,
			artifactId: dependency.artifactId,
			mediaType: "video",
			nodeId: "delivery-verify",
			taskId: null,
			runId: dependency.runId,
			sourceExecutionId: "workflow-execution-success",
			assetId: null,
			assetUrl: "https://assets.example/chapter-1.mp4",
			observedAt: "2026-08-28T13:07:15.415Z",
			source: "workflow_execution",
		}]);
	});

	it("rejects unverified, non-persistent and wrong-media workflow outputs", () => {
		const result = collectWorkflowExecutionMaterializedArtifacts({
			dependency,
			nodeRuns: [{
				execution_id: "workflow-execution-success",
				node_id: "delivery-unverified",
				status: "success",
				finished_at: "2026-08-28T13:07:15.415Z",
				output_refs: JSON.stringify({
					artifacts: [{ type: "tapcanvas.image/v1", value: "https://assets.example/frame.png" }],
					evidence: {
						executorCompleted: true,
						verifiedItems: 1,
						expectedArtifactType: "tapcanvas.image/v1",
					},
				}),
			}, {
				execution_id: "workflow-execution-success",
				node_id: "delivery-data-url",
				status: "success",
				finished_at: "2026-08-28T13:07:15.415Z",
				output_refs: JSON.stringify({
					artifacts: [{ type: "tapcanvas.master-video/v1", value: "data:video/mp4;base64,abc" }],
					evidence: {
						executorCompleted: true,
						verifiedItems: 1,
						expectedArtifactType: "tapcanvas.master-video/v1",
					},
				}),
			}],
		});

		expect(result).toEqual([]);
	});
});
