import { describe, expect, it } from "vitest";

import { AppError } from "../../middleware/error";
import { assertAgentsRemoteToolCallbackBase } from "./task.agents-bridge";

describe("agents bridge remote tool callback configuration", () => {
	it("fails closed when remote tools exist without an explicit internal API base", () => {
		expect(() => assertAgentsRemoteToolCallbackBase({
			baseUrl: "",
			remoteToolCount: 1,
		})).toThrowError(expect.objectContaining<Partial<AppError>>({
			status: 503,
			code: "agents_remote_tool_callback_base_missing",
		}));
	});

	it("accepts an explicit callback base and requests without remote tools", () => {
		expect(() => assertAgentsRemoteToolCallbackBase({
			baseUrl: "http://api:8788",
			remoteToolCount: 1,
		})).not.toThrow();
		expect(() => assertAgentsRemoteToolCallbackBase({
			baseUrl: "",
			remoteToolCount: 0,
		})).not.toThrow();
	});
});
