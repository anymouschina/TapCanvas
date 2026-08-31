import fs from "node:fs";

import { describe, expect, it } from "vitest";

describe("Node WorkerEnv projection", () => {
	it("projects the trusted Tanva desktop allowlist into c.env", () => {
		const source = fs.readFileSync(new URL("./node-env.ts", import.meta.url), "utf8");

		expect(source).toContain(
			"PUBLIC_AGENTS_PRIVILEGED_DESKTOP_USER_IDS:\n\t\t\tprocess.env.PUBLIC_AGENTS_PRIVILEGED_DESKTOP_USER_IDS",
		);
	});
});
