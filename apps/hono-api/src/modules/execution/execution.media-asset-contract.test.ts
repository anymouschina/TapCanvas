import { describe, expect, it } from "vitest";
import { parseWorkflowMediaAssetV1 } from "@tapcanvas/workflow-kernel-protocol";

describe("workflow media asset contract", () => {
	it("accepts persistent typed media with physical dimensions", () => {
		expect(parseWorkflowMediaAssetV1({
			protocolVersion: "workflow.media-asset/v1",
			kind: "video",
			url: "https://assets.tapcanvas.test/master.mp4",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
			durationSeconds: 12,
		})).toEqual({
			protocolVersion: "workflow.media-asset/v1",
			kind: "video",
			url: "https://assets.tapcanvas.test/master.mp4",
			mimeType: "video/mp4",
			width: 1920,
			height: 1080,
			durationSeconds: 12,
		});
	});

	it("rejects temporary local paths and invalid dimensions", () => {
		expect(() => parseWorkflowMediaAssetV1({
			protocolVersion: "workflow.media-asset/v1",
			kind: "image",
			url: "/tmp/image.png",
			mimeType: "image/png",
		})).toThrow("absolute URL");
		expect(() => parseWorkflowMediaAssetV1({
			protocolVersion: "workflow.media-asset/v1",
			kind: "image",
			url: "https://assets.tapcanvas.test/image.png",
			mimeType: "image/png",
			width: 0,
		})).toThrow("positive finite number");
	});
});
