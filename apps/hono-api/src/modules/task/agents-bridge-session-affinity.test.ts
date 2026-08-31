import { describe, expect, it } from "vitest";
import {
	AGENTS_BRIDGE_SESSION_AFFINITY_HEADER,
	buildAgentsBridgeSessionAffinity,
	buildAgentsBridgeSessionAffinityHeader,
} from "./agents-bridge-session-affinity";

describe("agents bridge session affinity", () => {
	it("binds every physical route for one user session to one opaque key", () => {
		const first = buildAgentsBridgeSessionAffinity({
			userId: "user-1",
			sessionId: "agent-api:job-1",
		});
		const repeated = buildAgentsBridgeSessionAffinity({
			userId: " user-1 ",
			sessionId: " agent-api:job-1 ",
		});

		expect(first).toBe(repeated);
		expect(first).toMatch(/^v1-[a-f0-9]{64}$/u);
		expect(first).not.toContain("user-1");
		expect(first).not.toContain("job-1");
	});

	it("separates identical session labels owned by different users", () => {
		expect(buildAgentsBridgeSessionAffinity({
			userId: "user-1",
			sessionId: "canvas-main",
		})).not.toBe(buildAgentsBridgeSessionAffinity({
			userId: "user-2",
			sessionId: "canvas-main",
		}));
	});

	it("leaves stateless requests unbound and rejects an ownerless stateful key", () => {
		expect(buildAgentsBridgeSessionAffinityHeader({
			userId: "user-1",
			sessionId: " ",
		})).toEqual({});
		expect(() => buildAgentsBridgeSessionAffinity({
			userId: " ",
			sessionId: "session-1",
		})).toThrow("agents_bridge_session_affinity_user_required");
	});

	it("uses the single load-balancer protocol header", () => {
		const headers = buildAgentsBridgeSessionAffinityHeader({
			userId: "user-1",
			sessionId: "session-1",
		});
		expect(Object.keys(headers)).toEqual([
			AGENTS_BRIDGE_SESSION_AFFINITY_HEADER,
		]);
	});
});
