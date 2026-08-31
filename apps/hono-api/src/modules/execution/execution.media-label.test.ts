import { describe, expect, it } from "vitest";

import {
	workflowImageSemanticLabel,
	workflowVideoSemanticLabel,
} from "./execution.media-label";

describe("workflow media semantic labels", () => {
	it("uses frozen image identity facts instead of a workflow ordinal", () => {
		expect(workflowImageSemanticLabel({
			assetMetadata: {
				referenceType: "character",
				canonicalName: "body-liu-xiu-001",
				displayName: "刘秀",
			},
			itemIndex: 5,
		})).toBe("刘秀角色卡");
		expect(workflowImageSemanticLabel({
			assetMetadata: {
				referenceType: "scene",
				canonicalName: "五指巷小义庄",
				displayName: "五指巷小义庄",
			},
			itemIndex: 1,
		})).toBe("五指巷小义庄场景卡");
	});

	it("uses the structured clip logline for video output labels", () => {
		expect(workflowVideoSemanticLabel({
			structuredClip: { logline: "刘秀隔门回应突发求救" },
			itemIndex: 0,
		})).toBe("第 1 段｜刘秀隔门回应突发求救");
	});
});
