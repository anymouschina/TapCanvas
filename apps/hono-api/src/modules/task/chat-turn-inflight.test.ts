import { beforeEach, describe, expect, it } from "vitest";
import {
	CHAT_TURN_BUSY_CODE,
	CHAT_TURN_SYSTEM_RECOVERY_INTERRUPT_REASON,
	CHAT_TURN_USER_INTERRUPT_REASON,
	ChatTurnInflightError,
	__resetInflightChatTurnsForTest,
	anyAbortSignal,
	buildInflightChatTurnKey,
	getInflightChatTurnSnapshot,
	interruptInflightChatTurn,
	registerInflightChatTurn,
} from "./chat-turn-inflight";

describe("chat-turn-inflight", () => {
	beforeEach(() => {
		__resetInflightChatTurnsForTest();
	});

	it("key 需要 userId+sessionKey 同时非空", () => {
		expect(buildInflightChatTurnKey("u1", "project:p:lane:general")).toBe(
			"u1::project:p:lane:general",
		);
		expect(buildInflightChatTurnKey("", "s")).toBeNull();
		expect(buildInflightChatTurnKey("u", "  ")).toBeNull();
		expect(buildInflightChatTurnKey(null, undefined)).toBeNull();
	});

	it("同 key 新普通回合会被拒绝且原回合保持运行", () => {
		const key = buildInflightChatTurnKey("u1", "sess-a");
		const first = registerInflightChatTurn(key, "req-1");
		expect(first).not.toBeNull();
		expect(first!.signal.aborted).toBe(false);

		expect(() => registerInflightChatTurn(key, "req-2")).toThrow(ChatTurnInflightError);
		expect(first!.signal.aborted).toBe(false);
	});

	it("interrupt 只打在飞回合，空表返回 false", () => {
		const key = buildInflightChatTurnKey("u1", "sess-a");
		expect(interruptInflightChatTurn(key, "req-1")).toBe(false);

		const handle = registerInflightChatTurn(key, "req-1");
		expect(interruptInflightChatTurn(key, "req-1")).toBe(true);
		expect(handle!.signal.aborted).toBe(true);
		expect(String((handle!.signal.reason as Error)?.message)).toBe(
			CHAT_TURN_USER_INTERRUPT_REASON,
		);
		// 已中断的回合不能再次被中断
		expect(interruptInflightChatTurn(key, "req-1")).toBe(false);
	});

	it("release 清除自己的登记后允许下一回合注册", () => {
		const key = buildInflightChatTurnKey("u1", "sess-a");
		const first = registerInflightChatTurn(key, "req-1");
		first!.release();
		const second = registerInflightChatTurn(key, "req-2");
		expect(interruptInflightChatTurn(key, "req-2")).toBe(true);
		expect(second!.signal.aborted).toBe(true);
	});

	it("机器物理代际切换不会在本地传输层伪装成用户中断", () => {
		const key = buildInflightChatTurnKey("u1", "workflow-session");
		const handle = registerInflightChatTurn(key, "physical-run-1");
		expect(interruptInflightChatTurn(
			key,
			"physical-run-1",
			CHAT_TURN_SYSTEM_RECOVERY_INTERRUPT_REASON,
		)).toBe(true);
		expect(handle!.signal.aborted).toBe(true);
		expect(String((handle!.signal.reason as Error)?.message)).toBe(
			CHAT_TURN_SYSTEM_RECOVERY_INTERRUPT_REASON,
		);
	});

	it("任意在飞主回合都拒绝新普通回合，autoApprove 不再兼任并发语义", () => {
		const key = buildInflightChatTurnKey("u1", "sess-a");
		const film = registerInflightChatTurn(key, "req-film");
		expect(film!.signal.aborted).toBe(false);

		expect(() => registerInflightChatTurn(key, "req-question")).toThrow(
			ChatTurnInflightError,
		);
		expect(film!.signal.aborted).toBe(false);

		expect(interruptInflightChatTurn(key, "req-film")).toBe(true);
		expect(film!.signal.aborted).toBe(true);
		expect(String((film!.signal.reason as Error)?.message)).toBe(
			CHAT_TURN_USER_INTERRUPT_REASON,
		);
	});

	it("拒绝时带上旧回合 requestId/存活时长，供前端与日志定位", () => {
		const key = buildInflightChatTurnKey("u1", "sess-a");
		registerInflightChatTurn(key, "req-film");
		try {
			registerInflightChatTurn(key, "req-question");
			expect.unreachable("应抛 ChatTurnInflightError");
		} catch (error) {
			expect(error).toBeInstanceOf(ChatTurnInflightError);
			const typed = error as ChatTurnInflightError;
			expect(typed.code).toBe(CHAT_TURN_BUSY_CODE);
			expect(typed.details.priorRequestId).toBe("req-film");
			expect(typed.details.priorAgeMs).toBeGreaterThanOrEqual(0);
			// 文案要能直接给用户看：说清没发出去 + 两条出路。
			expect(typed.message).toContain("中断");
		}
	});

	it("回合结束后（release）新回合可正常注册", () => {
		const key = buildInflightChatTurnKey("u1", "sess-a");
		const film = registerInflightChatTurn(key, "req-film");
		film!.release();
		const next = registerInflightChatTurn(key, "req-question");
		expect(next).not.toBeNull();
		expect(next!.signal.aborted).toBe(false);
	});

	it("在飞回合不跨会话/跨用户拦截（只在同 key 生效）", () => {
		registerInflightChatTurn(buildInflightChatTurnKey("u1", "sess-a"), "req-film");
		// 同用户另一会话、以及另一用户同会话名，都不该被拦。
		expect(
			registerInflightChatTurn(buildInflightChatTurnKey("u1", "sess-b"), "req-other"),
		).not.toBeNull();
		expect(
			registerInflightChatTurn(buildInflightChatTurnKey("u2", "sess-a"), "req-other2"),
		).not.toBeNull();
	});

	it("不同 key 互不影响", () => {
		const a = registerInflightChatTurn(buildInflightChatTurnKey("u1", "sess-a"), "req-a");
		const b = registerInflightChatTurn(buildInflightChatTurnKey("u1", "sess-b"), "req-b");
		registerInflightChatTurn(buildInflightChatTurnKey("u2", "sess-a"), "req-c");
		expect(a!.signal.aborted).toBe(false);
		expect(b!.signal.aborted).toBe(false);
	});

	it("key 为 null（无 sessionKey 场景）时注册/中断都是 no-op", () => {
		expect(registerInflightChatTurn(null, "req-1")).toBeNull();
		expect(interruptInflightChatTurn(null, "req-1")).toBe(false);
	});

	it("状态快照暴露稳定 turnId；带旧 turnId 的迟到中断不会误杀当前回合", () => {
		const key = buildInflightChatTurnKey("u1", "sess-a");
		const handle = registerInflightChatTurn(key, "req-current");
		expect(getInflightChatTurnSnapshot(key)).toMatchObject({
			turnId: "req-current",
			active: true,
		});
		expect(interruptInflightChatTurn(key, "req-stale")).toBe(false);
		expect(handle!.signal.aborted).toBe(false);
		expect(interruptInflightChatTurn(key, "")).toBe(false);
		expect(handle!.signal.aborted).toBe(false);
		expect(interruptInflightChatTurn(key, "req-current")).toBe(true);
		expect(handle!.signal.aborted).toBe(true);
	});

	it("anyAbortSignal 任一信号触发即触发", () => {
		const a = new AbortController();
		const b = new AbortController();
		const merged = anyAbortSignal([a.signal, b.signal]);
		expect(merged!.aborted).toBe(false);
		b.abort(new Error("boom"));
		expect(merged!.aborted).toBe(true);
		expect(anyAbortSignal([])).toBeUndefined();
		expect(anyAbortSignal([a.signal])).toBe(a.signal);
		// 已触发的信号立即生效
		const pre = new AbortController();
		pre.abort(new Error("pre"));
		expect(anyAbortSignal([pre.signal, new AbortController().signal])!.aborted).toBe(true);
	});
});
