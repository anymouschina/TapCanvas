import { describe, expect, it } from "vitest";
import {
	TaskKindSchema,
	TaskRequestSchema,
	VendorCallLogListQuerySchema,
} from "./task.schemas";

describe("TaskKindSchema image_to_3d", () => {
	it("accepts image_to_3d", () => {
		expect(TaskKindSchema.parse("image_to_3d")).toBe("image_to_3d");
	});
	it("parses a 3d task request with extras", () => {
		const req = TaskRequestSchema.parse({
			kind: "image_to_3d",
			prompt: "",
			extras: { modelKey: "doubao-seed3d-2-0-260328", imageUrl: "https://x/a.png", model3d: "3.1" },
		});
		expect(req.kind).toBe("image_to_3d");
		expect(req.extras?.model3d).toBe("3.1");
	});
});

describe("TaskKindSchema video_enhance", () => {
	it("accepts video_enhance", () => {
		expect(TaskKindSchema.parse("video_enhance")).toBe("video_enhance");
	});
});

describe("TaskKindSchema video_edit", () => {
	it("accepts a video editing task with an explicit operation", () => {
		const request = TaskRequestSchema.parse({
			kind: "video_edit",
			prompt: "移除字幕",
			extras: {
				modelKey: "wan2.7-videoedit",
				upstreamVideoUrl: "https://assets.example.com/source.mp4",
				editOperation: "subtitle_remove",
				editSelections: [{ x: 0.1, y: 0.8, width: 0.8, height: 0.1 }],
			},
		});
		expect(request.kind).toBe("video_edit");
		expect(request.extras?.editOperation).toBe("subtitle_remove");
	});
});

describe("VendorCallLogListQuerySchema", () => {
	it("parses pagination and supported filters", () => {
		const result = VendorCallLogListQuerySchema.parse({
			page: "2",
			pageSize: "50",
			status: "failed",
			vendor: "newapi",
			createdFrom: "2026-07-01T00:00:00.000Z",
		});
		expect(result).toMatchObject({ page: 2, pageSize: 50, status: "failed", vendor: "newapi" });
	});

	it("rejects invalid statuses and dates", () => {
		expect(VendorCallLogListQuerySchema.safeParse({ status: "unknown" }).success).toBe(false);
		expect(VendorCallLogListQuerySchema.safeParse({ createdFrom: "not-a-date" }).success).toBe(false);
	});
});
