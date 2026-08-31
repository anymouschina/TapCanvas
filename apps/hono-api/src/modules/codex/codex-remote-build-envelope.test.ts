import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { CodexRemoteBuildSpec } from "@tapcanvas/codex-task-protocol";
import type { WorkerEnv } from "../../types";
import {
	openCodexRemoteBuildSpec,
	sealCodexRemoteBuildSpec,
} from "./codex-remote-build-envelope";

function environment(key: Buffer): WorkerEnv {
	return {
		CODEX_REMOTE_BUILD_ENVELOPE_KEY: key.toString("base64"),
	} as WorkerEnv;
}

const spec: CodexRemoteBuildSpec = {
	configFingerprint: "f".repeat(64),
	runtime: "node24",
	timeoutMs: 1_800_000,
	vcpus: 2,
	commands: {
		install: ["pnpm", "install", "--frozen-lockfile"],
		test: ["pnpm", "test"],
		build: ["pnpm", "build"],
		preview: ["pnpm", "preview"],
	},
	outputDirectory: "dist",
	previewPort: 4173,
	previewReadyPath: "/",
	previewReadyTimeoutMs: 60_000,
	environment: {
		DATABASE_URL: "postgres://private-build-secret",
	},
};

describe("Codex remote build envelope", () => {
	it("round-trips a validated spec without exposing environment values", () => {
		const env = environment(randomBytes(32));
		const sealed = sealCodexRemoteBuildSpec(env, spec);

		expect(sealed).not.toContain("private-build-secret");
		expect(openCodexRemoteBuildSpec(env, sealed)).toEqual(spec);
	});

	it("rejects a different key instead of returning partial data", () => {
		const sealed = sealCodexRemoteBuildSpec(
			environment(randomBytes(32)),
			spec,
		);
		expect(() =>
			openCodexRemoteBuildSpec(environment(randomBytes(32)), sealed),
		).toThrow(/cannot be opened/u);
	});
});
