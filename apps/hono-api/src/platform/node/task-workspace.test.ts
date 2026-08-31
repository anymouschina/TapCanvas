import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTaskWorkspace } from "./task-workspace";

const originalRoot = process.env.TAPCANVAS_TEMP_ROOT;
const originalMinimum = process.env.TAPCANVAS_TEMP_MIN_FREE_BYTES;
const roots: string[] = [];

afterEach(async () => {
	if (originalRoot === undefined) delete process.env.TAPCANVAS_TEMP_ROOT;
	else process.env.TAPCANVAS_TEMP_ROOT = originalRoot;
	if (originalMinimum === undefined) delete process.env.TAPCANVAS_TEMP_MIN_FREE_BYTES;
	else process.env.TAPCANVAS_TEMP_MIN_FREE_BYTES = originalMinimum;
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("createTaskWorkspace", () => {
	it("creates and removes an isolated workspace below the configured root", async () => {
		const root = await mkdtemp(join(tmpdir(), "tapcanvas-workspace-test-"));
		roots.push(root);
		process.env.TAPCANVAS_TEMP_ROOT = root;
		process.env.TAPCANVAS_TEMP_MIN_FREE_BYTES = "0";

		const workspace = await createTaskWorkspace("video concat");

		expect(workspace.path.startsWith(`${root}/video_concat-`)).toBe(true);
		expect(workspace.freeBytesBeforeCreate).toBeGreaterThan(0);
		await workspace.cleanup();
		await expect(createTaskWorkspace("../escape")).resolves.toMatchObject({
			path: expect.stringContaining("___escape-"),
		});
	});

	it("rejects a relative configured root instead of creating an ambiguous workspace", async () => {
		process.env.TAPCANVAS_TEMP_ROOT = "relative-workspace";
		await expect(createTaskWorkspace("video")).rejects.toThrow(
			"TAPCANVAS_TEMP_ROOT must be an absolute path",
		);
	});
});
