import path from "node:path";
import { describe, expect, it } from "vitest";

import { findProjectDataRepoRoot } from "./project-data-root";

describe("findProjectDataRepoRoot", () => {
	it("walks up from apps/hono-api to repo root", () => {
		const startDir = path.resolve(process.cwd(), "apps/hono-api");
		const repoRoot = findProjectDataRepoRoot(startDir);
		expect(repoRoot).toBe(path.resolve(process.cwd(), "..", ".."));
	});
});
