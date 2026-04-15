import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveProjectDataRepoRoot } from "../asset/project-data-root";
import { resolveProjectBookDirectoryName } from "./agents-tool-bridge.book-lookup";
import { selectStoryboardPlanReadResult } from "./agents-tool-bridge.storyboard-plan";

describe("resolveProjectBookDirectoryName", () => {
	it("resolves a physical book directory by logical bookId from index.json", async () => {
		const projectId = "project-book-lookup";
		const userId = "user-book-lookup";
		const dirName = "______-1774356427374";
		const logicalBookId = "real-book-id-1";
		const booksRoot = path.join(
			resolveProjectDataRepoRoot(),
			"project-data",
			"users",
			userId,
			"projects",
			projectId,
			"books",
		);
		const bookDir = path.join(booksRoot, dirName);
		await fs.mkdir(bookDir, { recursive: true });
		await fs.writeFile(
			path.join(bookDir, "index.json"),
			JSON.stringify({ bookId: logicalBookId, title: "地煞七十二变" }),
			"utf8",
		);

		const resolved = await resolveProjectBookDirectoryName({
			projectId,
			userId,
			requestedBookId: logicalBookId,
		});

		expect(resolved).toBe(dirName);
	});
});

describe("selectStoryboardPlanReadResult", () => {
	it("prefers the newest plan within the requested chapter when no ids are provided", () => {
		const { matchedPlan, chapterPlans } = selectStoryboardPlanReadResult({
			plans: [
				{
					planId: "plan-older",
					taskId: "task-older",
					chapter: 5,
					mode: "full",
					groupSize: 9,
					shotPrompts: ["镜头一"],
					createdAt: "2026-04-04T09:00:00.000Z",
					updatedAt: "2026-04-04T09:05:00.000Z",
					createdBy: "user-1",
					updatedBy: "user-1",
				},
				{
					planId: "plan-newer",
					taskId: "task-newer",
					chapter: 5,
					mode: "full",
					groupSize: 9,
					shotPrompts: ["镜头二"],
					createdAt: "2026-04-04T09:10:00.000Z",
					updatedAt: "2026-04-04T09:15:00.000Z",
					createdBy: "user-1",
					updatedBy: "user-1",
				},
				{
					planId: "plan-other-chapter",
					taskId: "task-other",
					chapter: 6,
					mode: "full",
					groupSize: 9,
					shotPrompts: ["镜头三"],
					createdAt: "2026-04-04T10:00:00.000Z",
					updatedAt: "2026-04-04T10:05:00.000Z",
					createdBy: "user-1",
					updatedBy: "user-1",
				},
			],
			chapter: 5,
		});

		expect(chapterPlans.map((plan) => plan.planId)).toEqual(["plan-newer", "plan-older"]);
		expect(matchedPlan?.planId).toBe("plan-newer");
	});

	it("uses taskId inside the requested chapter without crossing into other chapters", () => {
		const { matchedPlan, chapterPlans } = selectStoryboardPlanReadResult({
			plans: [
				{
					planId: "plan-ch5",
					taskId: "task-shared",
					chapter: 5,
					mode: "full",
					groupSize: 9,
					shotPrompts: ["镜头一"],
					createdAt: "2026-04-04T09:00:00.000Z",
					updatedAt: "2026-04-04T09:05:00.000Z",
					createdBy: "user-1",
					updatedBy: "user-1",
				},
				{
					planId: "plan-ch6",
					taskId: "task-shared",
					chapter: 6,
					mode: "full",
					groupSize: 9,
					shotPrompts: ["镜头二"],
					createdAt: "2026-04-04T10:00:00.000Z",
					updatedAt: "2026-04-04T10:05:00.000Z",
					createdBy: "user-1",
					updatedBy: "user-1",
				},
			],
			chapter: 5,
			taskId: "task-shared",
		});

		expect(chapterPlans).toHaveLength(1);
		expect(matchedPlan?.planId).toBe("plan-ch5");
	});
});
