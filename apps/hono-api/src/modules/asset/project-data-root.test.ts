import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { findProjectDataRepoRoot } from "./project-data-root";

describe("findProjectDataRepoRoot", () => {
	const tempRoots: string[] = [];

	afterEach(() => {
		for (const tempRoot of tempRoots.splice(0)) {
			fs.rmSync(tempRoot, { recursive: true, force: true });
		}
	});

	it("walks up from apps/hono-api to repo root", () => {
		const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tapcanvas-data-root-"));
		tempRoots.push(repoRoot);
		fs.mkdirSync(path.join(repoRoot, ".git"));
		const startDir = path.join(repoRoot, "apps", "hono-api", "dist");
		fs.mkdirSync(startDir, { recursive: true });

		expect(findProjectDataRepoRoot(startDir)).toBe(repoRoot);
	});

	it("keeps the runtime working directory when no repository marker exists", () => {
		const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "tapcanvas-runtime-root-"));
		tempRoots.push(runtimeRoot);

		expect(findProjectDataRepoRoot(runtimeRoot)).toBe(runtimeRoot);
	});
});
