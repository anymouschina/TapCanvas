import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildInternalApiKey,
	parseInternalApiKey,
} from "./internal-api-key";

describe("internal API key delegation contract", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("round-trips user and original API key attribution", () => {
		const credential = buildInternalApiKey({
			internalWorkerToken: "worker-secret",
			userId: "user-1",
			apiKeyId: "key-1",
		});
		expect(credential?.startsWith("tc_internal:v2:")).toBe(true);
		expect(credential?.includes(Buffer.from("worker-secret", "utf8").toString("base64url"))).toBe(false);
		expect(parseInternalApiKey(credential ?? "", "worker-secret")).toEqual({
			userId: "user-1",
			apiKeyId: "key-1",
		});
	});

	it("keeps internal system work attributable to its user without inventing an API key", () => {
		const credential = buildInternalApiKey({
			internalWorkerToken: "worker-secret",
			userId: "user-1:host-user-2",
		});
		expect(parseInternalApiKey(credential ?? "", "worker-secret")).toEqual({
			userId: "user-1:host-user-2",
			apiKeyId: null,
		});
	});

	it("rejects a wrong worker token and missing identity", () => {
		const credential = buildInternalApiKey({
			internalWorkerToken: "worker-secret",
			userId: "user-1",
			apiKeyId: "key-1",
		});
		expect(parseInternalApiKey(credential ?? "", "wrong-secret")).toBeNull();
		expect(buildInternalApiKey({
			internalWorkerToken: "worker-secret",
			userId: " ",
		})).toBeNull();
	});

	it("rejects tampered and expired credentials", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));
		const credential = buildInternalApiKey({
			internalWorkerToken: "worker-secret",
			userId: "user-1",
			apiKeyId: "key-1",
		});
		expect(credential).not.toBeNull();
		const value = credential ?? "";
		const replacement = value.endsWith("A") ? "B" : "A";
		const tampered = `${value.slice(0, -1)}${replacement}`;
		expect(parseInternalApiKey(tampered, "worker-secret")).toBeNull();

		vi.setSystemTime(new Date("2026-08-17T01:00:00.001Z"));
		expect(parseInternalApiKey(value, "worker-secret")).toBeNull();
	});
});
