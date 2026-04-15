import { describe, expect, it } from "vitest";
import { appendTraceEvent, ensureRequestId, getTraceSnapshot, initTrace, setTraceStage } from "./trace";
import type { AppContext } from "./types";

function createMockContext(): AppContext {
	const store = new Map<string, unknown>();
	const ctx = {
		get(key: string) {
			return store.get(key);
		},
		set(key: string, value: unknown) {
			store.set(key, value);
		},
	};
	return ctx as unknown as AppContext;
}

describe("trace helpers", () => {
	it("creates and reuses request id", () => {
		const c = createMockContext();
		const first = ensureRequestId(c);
		const second = ensureRequestId(c);

		expect(first).toBeTruthy();
		expect(second).toBe(first);
	});

	it("stores sanitized meta and normalizes empty stage", () => {
		const c = createMockContext();
		initTrace(c, Date.now() - 5);
		setTraceStage(c, "   ", {
			token: "secret",
			nested: { authorization: "Bearer abc" },
		});

		const snapshot = getTraceSnapshot(c);
		const event = snapshot.events[snapshot.events.length - 1];
		const meta = event.meta as Record<string, unknown>;
		const nested = meta.nested as Record<string, unknown>;

		expect(snapshot.stage).toBe("unknown");
		expect(meta.token).toBe("***");
		expect(nested.authorization).toBe("***");
	});

	it("keeps only latest 120 trace events", () => {
		const c = createMockContext();
		initTrace(c, Date.now() - 5);

		for (let i = 0; i < 140; i += 1) {
			appendTraceEvent(c, `step:${i}`);
		}

		const snapshot = getTraceSnapshot(c);
		expect(snapshot.events).toHaveLength(120);
		expect(snapshot.events[0]?.stage).toBe("step:20");
		expect(snapshot.events[119]?.stage).toBe("step:139");
	});
});
