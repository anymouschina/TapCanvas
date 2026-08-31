import { describe, expect, it, vi } from "vitest";
import { AgentsBridgeAdmissionScheduler } from "./agents-bridge-admission";

const limits = Object.freeze({
	maxConcurrency: 8,
	maxQueueDepth: 16,
	maxPerUser: 1,
});

describe("AgentsBridgeAdmissionScheduler", () => {
	it("queues same-user work until capacity is released instead of rejecting it", async () => {
		const scheduler = new AgentsBridgeAdmissionScheduler();
		let releaseFirst: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const started: string[] = [];
		const first = scheduler.run({
			userId: "user-1",
			limits,
			task: async () => {
				started.push("first");
				await firstGate;
				return "first-result";
			},
		});
		await vi.waitFor(() => expect(started).toEqual(["first"]));
		const second = scheduler.run({
			userId: "user-1",
			limits,
			task: async () => {
				started.push("second");
				return "second-result";
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(started).toEqual(["first"]);
		releaseFirst();
		await expect(Promise.all([first, second])).resolves.toEqual(["first-result", "second-result"]);
		expect(started).toEqual(["first", "second"]);
	});

	it("uses free global capacity for another user when the first user is saturated", async () => {
		const scheduler = new AgentsBridgeAdmissionScheduler();
		let releaseFirst: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const started: string[] = [];
		const first = scheduler.run({
			userId: "user-1",
			limits: { ...limits, maxConcurrency: 2 },
			task: async () => {
				started.push("user-1-first");
				await firstGate;
			},
		});
		await vi.waitFor(() => expect(started).toEqual(["user-1-first"]));
		const sameUserQueued = scheduler.run({
			userId: "user-1",
			limits: { ...limits, maxConcurrency: 2 },
			task: async () => {
				started.push("user-1-second");
			},
		});
		const otherUser = scheduler.run({
			userId: "user-2",
			limits: { ...limits, maxConcurrency: 2 },
			task: async () => {
				started.push("user-2");
			},
		});
		await otherUser;
		expect(started).toEqual(["user-1-first", "user-2"]);
		releaseFirst();
		await Promise.all([first, sameUserQueued]);
		expect(started).toEqual(["user-1-first", "user-2", "user-1-second"]);
	});

	it("removes an aborted waiter without consuming a later slot", async () => {
		const scheduler = new AgentsBridgeAdmissionScheduler();
		let releaseFirst: () => void = () => undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const first = scheduler.run({
			userId: "user-1",
			limits,
			task: async () => firstGate,
		});
		const abortController = new AbortController();
		const queued = scheduler.run({
			userId: "user-1",
			limits,
			signal: abortController.signal,
			task: async () => undefined,
		});
		abortController.abort(new Error("queued-request-aborted"));
		await expect(queued).rejects.toThrow("queued-request-aborted");
		releaseFirst();
		await first;
		await expect(scheduler.run({
			userId: "user-1",
			limits,
			task: async () => "after-abort",
		})).resolves.toBe("after-abort");
	});

	it("admits a production-deadline waiter before earlier standard background work", async () => {
		const scheduler = new AgentsBridgeAdmissionScheduler();
		const singleSlotLimits = { ...limits, maxConcurrency: 1, maxPerUser: 4 };
		let releaseBlocker: () => void = () => undefined;
		const blockerGate = new Promise<void>((resolve) => {
			releaseBlocker = resolve;
		});
		const started: string[] = [];
		const blocker = scheduler.run({
			userId: "user-1",
			limits: singleSlotLimits,
			task: async () => {
				started.push("blocker");
				await blockerGate;
			},
		});
		await vi.waitFor(() => expect(started).toEqual(["blocker"]));
		const background = scheduler.run({
			userId: "user-1",
			priority: "standard",
			limits: singleSlotLimits,
			task: async () => {
				started.push("background");
			},
		});
		const production = scheduler.run({
			userId: "user-1",
			priority: "production_deadline",
			limits: singleSlotLimits,
			task: async () => {
				started.push("production");
			},
		});
		releaseBlocker();
		await Promise.all([blocker, background, production]);
		expect(started).toEqual(["blocker", "production", "background"]);
	});
});
