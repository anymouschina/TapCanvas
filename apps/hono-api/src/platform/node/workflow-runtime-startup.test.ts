import { describe, expect, it } from "vitest";
import { assertWorkflowRuntimeStartupReady } from "./workflow-runtime-startup";

describe("workflow runtime startup preflight", () => {
	it("accepts explicit bridge and callback origins", () => {
		expect(assertWorkflowRuntimeStartupReady({
			AGENTS_BRIDGE_BASE_URL: "http://127.0.0.1:8800/",
			TAPCANVAS_API_INTERNAL_BASE: "http://127.0.0.1:8789/",
			TAPCANVAS_API_BASE_URL: undefined,
		})).toEqual({
			agentsBridgeOrigin: "http://127.0.0.1:8800",
			callbackOrigin: "http://127.0.0.1:8789",
		});
	});

	it("refuses recovery ownership before a callback base is configured", () => {
		expect(() => assertWorkflowRuntimeStartupReady({
			AGENTS_BRIDGE_BASE_URL: "http://127.0.0.1:8800",
			TAPCANVAS_API_INTERNAL_BASE: undefined,
			TAPCANVAS_API_BASE_URL: undefined,
		})).toThrow("TAPCANVAS_API_INTERNAL_BASE or TAPCANVAS_API_BASE_URL");
	});

	it("refuses a non-http transport origin", () => {
		expect(() => assertWorkflowRuntimeStartupReady({
			AGENTS_BRIDGE_BASE_URL: "redis://127.0.0.1:8800",
			TAPCANVAS_API_INTERNAL_BASE: "http://127.0.0.1:8789",
			TAPCANVAS_API_BASE_URL: undefined,
		})).toThrow("must use http or https");
	});
});
