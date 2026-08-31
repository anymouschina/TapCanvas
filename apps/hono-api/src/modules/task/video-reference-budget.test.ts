import { describe, expect, it } from "vitest";

import {
	validateOrchestratedSd2References,
	validateSd2ClipReferenceBudget,
} from "./video-reference-budget";

const image = (name: string): string => `https://cdn.example/${name}.png`;

describe("validateSd2ClipReferenceBudget", () => {
	it("accepts the model's full reference budget as clip dependencies", () => {
		const result = validateSd2ClipReferenceBudget({
			clipIndex: 2,
			businessReferenceImages: Array.from(
				{ length: 9 },
				(_, index) => image(`business-${index}`),
			),
			maximumBusinessReferences: 9,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.totalReferenceImages).toHaveLength(9);
		expect(result.totalReferenceImages[0]).toBe(image("business-0"));
	});

	it("fails before submission when a clip exceeds the full model budget", () => {
		const result = validateSd2ClipReferenceBudget({
			clipIndex: 4,
			businessReferenceImages: Array.from({ length: 10 }, (_, index) => image(`ref-${index}`)),
			maximumBusinessReferences: 9,
		});
		expect(result).toMatchObject({
			ok: false,
			code: "business_reference_limit_exceeded",
			clipIndex: 4,
			actualBusinessReferences: 10,
			maximumBusinessReferences: 9,
		});
	});

	it("deduplicates ordinary clip references", () => {
		const result = validateSd2ClipReferenceBudget({
			clipIndex: 0,
			businessReferenceImages: [image("same"), image("same")],
			maximumBusinessReferences: 9,
		});
		expect(result).toMatchObject({ ok: true, businessReferenceImages: [image("same")] });
	});
});

describe("validateOrchestratedSd2References", () => {
	const ref = (
		name: string,
		purpose: string = "other",
		role: string = "reference_image",
	) => ({ url: image(name), purpose, role });

	it("accepts one clip storyboard and selected assets within budget", () => {
		const result = validateOrchestratedSd2References({
			clipIndex: 0,
			references: [
				ref("clip-storyboard", "storyboard"),
				ref("core-character", "character"),
				ref("weapon", "prop"),
			],
			maximumBusinessReferences: 8,
		});
		expect(result).toEqual({ ok: true });
	});

	it("accepts text-to-video references", () => {
		const result = validateOrchestratedSd2References({
			clipIndex: 0,
			references: [ref("core-character", "character")],
			maximumBusinessReferences: 8,
		});
		expect(result).toEqual({ ok: true });
	});

	it("accepts selected assets without reserving a storyboard slot", () => {
		const result = validateOrchestratedSd2References({
			clipIndex: 0,
			references: [
				ref("core-character", "character"),
				ref("environment", "scene"),
			],
			maximumBusinessReferences: 8,
		});
		expect(result).toEqual({ ok: true });
	});

	it("rejects provider budget and frame-role violations", () => {
		expect(
			validateOrchestratedSd2References({
				clipIndex: 0,
				references: [ref("clip-storyboard", "storyboard")],
				maximumBusinessReferences: 8,
			}),
		).toEqual({ ok: true });

		expect(
			validateOrchestratedSd2References({
				clipIndex: 1,
				references: [
					...Array.from({ length: 9 }, (_, index) =>
						ref(`business-${index}`, index === 0 ? "storyboard" : "character"),
					),
				],
				maximumBusinessReferences: 8,
			}),
		).toMatchObject({ ok: false, code: "clip_reference_budget_exceeded" });

		expect(
			validateOrchestratedSd2References({
				clipIndex: 3,
				references: [ref("keyframe", "storyboard", "first_frame")],
				maximumBusinessReferences: 8,
			}),
		).toMatchObject({ ok: false, code: "orchestrated_sd2_frame_role_forbidden" });
	});
});
