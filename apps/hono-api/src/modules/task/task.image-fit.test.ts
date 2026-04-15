import { describe, expect, it } from "vitest";
import {
	computeContainPadPlacement,
	parseSizeToDimensions,
} from "./task.image-fit";

describe("task.image-fit", () => {
	it("parses WxH size strings", () => {
		expect(parseSizeToDimensions("1280x720")).toEqual({
			width: 1280,
			height: 720,
		});
		expect(parseSizeToDimensions(" 1024 x 1792 ")).toEqual({
			width: 1024,
			height: 1792,
		});
		expect(parseSizeToDimensions("small")).toBeNull();
	});

	it("computes contain+pad placement without cropping content", () => {
		expect(
			computeContainPadPlacement({
				sourceWidth: 1000,
				sourceHeight: 1000,
				targetWidth: 1280,
				targetHeight: 720,
			}),
		).toEqual({
			drawWidth: 720,
			drawHeight: 720,
			offsetX: 280,
			offsetY: 0,
		});

		expect(
			computeContainPadPlacement({
				sourceWidth: 720,
				sourceHeight: 1280,
				targetWidth: 1280,
				targetHeight: 720,
			}),
		).toEqual({
			drawWidth: 405,
			drawHeight: 720,
			offsetX: 437,
			offsetY: 0,
		});
	});
});
