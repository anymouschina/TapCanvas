import { describe, expect, it } from "vitest";
import {
	isDeepSeekHarnessHealthPayload,
	parseLocalAgentsBridgeEndpoint,
} from "./agents-bridge-autostart";

describe("agents bridge autostart endpoint", () => {
	it("preserves the exact configured loopback port for local recovery", () => {
		expect(parseLocalAgentsBridgeEndpoint("http://127.0.0.1:8800/")).toEqual({
			host: "127.0.0.1",
			port: 8800,
			baseUrl: "http://127.0.0.1:8800",
		});
		expect(parseLocalAgentsBridgeEndpoint("http://localhost:8799")).toEqual({
			host: "localhost",
			port: 8799,
			baseUrl: "http://localhost:8799",
		});
	});

	it("does not claim ownership of remote, credentialed, or path-scoped bridges", () => {
		expect(parseLocalAgentsBridgeEndpoint("https://agents.example.com")).toBeNull();
		expect(parseLocalAgentsBridgeEndpoint("http://agents.example.com:8800")).toBeNull();
		expect(parseLocalAgentsBridgeEndpoint("http://user:secret@127.0.0.1:8800")).toBeNull();
		expect(parseLocalAgentsBridgeEndpoint("http://127.0.0.1:8800/api")).toBeNull();
	});
});

describe("agents bridge runtime identity", () => {
	it("accepts only the pinned DeepSeek Harness SDK health contract", () => {
		expect(isDeepSeekHarnessHealthPayload({
			ok: true,
			runtime: "deepseek-harness",
			profile: "sdk",
			upstreamVersion: "0.1.2-alpha.2",
		})).toBe(true);
		expect(isDeepSeekHarnessHealthPayload({ ok: true })).toBe(false);
		expect(isDeepSeekHarnessHealthPayload({
			ok: true,
			runtime: "agents-cli",
			profile: "code",
			upstreamVersion: "0.1.2-alpha.2",
		})).toBe(false);
		expect(isDeepSeekHarnessHealthPayload({
			ok: true,
			runtime: "deepseek-harness",
			profile: "sdk",
			upstreamVersion: "0.1.1",
		})).toBe(false);
	});
});
