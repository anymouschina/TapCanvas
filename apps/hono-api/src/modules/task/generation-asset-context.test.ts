import { describe, expect, it } from "vitest";

import {
	attachGenerationAssetContextToRaw,
	attachGenerationAssetContextToTaskResult,
	readGenerationAssetContextFromRaw,
	readGenerationAssetContextFromTaskRequest,
} from "./generation-asset-context";

const generationContext = {
	projectId: "project-1",
	flowId: "flow-1",
	nodeId: "node-1",
	workflowExecutionId: "execution-1",
};

describe("generation asset context contract", () => {
	it("reads the strict context from task extras", () => {
		expect(readGenerationAssetContextFromTaskRequest({
			extras: { generationContext },
		})).toEqual(generationContext);
	});

	it("rejects an explicitly supplied context without a project identity", () => {
		expect(() => readGenerationAssetContextFromTaskRequest({
			extras: { generationContext: { nodeId: "node-1" } },
		})).toThrow("生成资产上下文格式无效");
	});

	it("preserves provider evidence while attaching context to every task state", () => {
		const raw = attachGenerationAssetContextToRaw(
			{ provider: "new_api", upstreamTaskId: "upstream-1" },
			generationContext,
		);
		expect(raw).toEqual({
			provider: "new_api",
			upstreamTaskId: "upstream-1",
			generationContext,
		});
		expect(readGenerationAssetContextFromRaw(raw)).toEqual(generationContext);

		const result = attachGenerationAssetContextToTaskResult({
			id: "task-1",
			kind: "text_to_video",
			status: "running",
			assets: [],
			raw: { provider: "new_api" },
		}, generationContext);
		expect(result.raw).toMatchObject({ generationContext });
	});

	it("fails explicitly for malformed context recovered from task raw data", () => {
		expect(() => readGenerationAssetContextFromRaw({
			generationContext: { projectId: "" },
		})).toThrow("生成资产上下文格式无效");
	});
});
