import { describe, expect, it } from "vitest";

import type { WorkerEnv } from "../../types";
import { requireImagePromptRuntimeConfig } from "./image-prompt-runtime-config";

const validEnvironment: WorkerEnv = {
	DB: {} as WorkerEnv["DB"],
	JWT_SECRET: "test-secret",
	IMAGE_PROMPT_HMAC_SERVICE_ID: "hmaigc-production",
	IMAGE_PROMPT_HMAC_SECRET: `inbound-${"a".repeat(32)}`,
	IMAGE_PROMPT_AGENTS_BASE_URL: "http://agents.internal:8799",
	IMAGE_PROMPT_AGENTS_TOKEN: `agents-${"b".repeat(32)}`,
	IMAGE_PROMPT_AGENTS_TIMEOUT_MS: "90000",
	IMAGE_PROMPT_HMAIGC_RELAY_URL:
		"http://hmaigc.internal/internal/v1/model-relays/image-prompt/chat-completions",
	IMAGE_PROMPT_HMAIGC_RELAY_SERVICE_ID: "hono-image-prompt",
	IMAGE_PROMPT_HMAIGC_RELAY_HMAC_SECRET: `relay-${"c".repeat(32)}`,
};

describe("image prompt runtime configuration", () => {
	it("loads one complete configuration with three independent credentials", () => {
		expect(requireImagePromptRuntimeConfig(validEnvironment)).toMatchObject({
			inbound: { serviceId: "hmaigc-production" },
			agents: { timeoutMs: 90_000 },
			hmaigcRelay: { serviceId: "hono-image-prompt" },
		});
	});

	it.each([
		["inbound/agents", "IMAGE_PROMPT_AGENTS_TOKEN", validEnvironment.IMAGE_PROMPT_HMAC_SECRET],
		[
			"inbound/relay",
			"IMAGE_PROMPT_HMAIGC_RELAY_HMAC_SECRET",
			validEnvironment.IMAGE_PROMPT_HMAC_SECRET,
		],
		[
			"agents/relay",
			"IMAGE_PROMPT_HMAIGC_RELAY_HMAC_SECRET",
			validEnvironment.IMAGE_PROMPT_AGENTS_TOKEN,
		],
	] as const)("rejects reused %s credentials", (_label, key, value) => {
		expect(() => requireImagePromptRuntimeConfig({ ...validEnvironment, [key]: value })).toThrow(
			/must use distinct secrets/,
		);
	});

	it("rejects an incomplete or short private configuration", () => {
		expect(() =>
			requireImagePromptRuntimeConfig({
				...validEnvironment,
				IMAGE_PROMPT_HMAIGC_RELAY_HMAC_SECRET: "short",
			}),
		).toThrow(/32-512 UTF-8 bytes/);
		expect(() =>
			requireImagePromptRuntimeConfig({
				...validEnvironment,
				IMAGE_PROMPT_HMAIGC_RELAY_URL: "",
			}),
		).toThrow(/IMAGE_PROMPT_HMAIGC_RELAY_URL is required/);
	});
});
