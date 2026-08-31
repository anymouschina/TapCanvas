import { describe, it, expect, vi } from "vitest";

const { requireSufficientTeamCredits } = vi.hoisted(() => ({
	requireSufficientTeamCredits: vi.fn(),
}));
vi.mock("../team/team.service", () => ({
	requireSufficientTeamCredits,
	settleTeamCreditsOnSuccess: vi.fn(),
	releaseTeamCreditsOnFailure: vi.fn(),
}));

import {
	quotaToCredits,
	deriveChatConversationId,
	isChatBillingEnabled,
	chatReservationTargetCredits,
	beginChatBilling,
} from "./chat-billing";
import type { WorkerEnv } from "../../types";

const env = (over: Record<string, unknown> = {}) => over as unknown as WorkerEnv;

describe("quotaToCredits", () => {
	const std = { quotaPerUnit: 500_000, usdExchangeRate: 7.3, creditsPerCny: 100 };

	it("500000 quota (= $1 = ¥7.3) → 730 积分 (×100)", () => {
		expect(quotaToCredits(500_000, std)).toBe(730);
	});

	it("0 / 负 quota → 0（不计费）", () => {
		expect(quotaToCredits(0, std)).toBe(0);
		expect(quotaToCredits(-100, std)).toBe(0);
		expect(quotaToCredits(Number.NaN, std)).toBe(0);
	});

	it("极小消耗向上取整到最低 1 积分", () => {
		// 1000/500000=0.002 USD ×7.3=0.0146 ¥ ×100=1.46 → ceil = 2
		expect(quotaToCredits(1000, std)).toBe(2);
	});

	it("非整结果向上取整（不少收，避免资损）", () => {
		// 100000/500000=0.2 ×7.3=1.46 ×100=146
		expect(quotaToCredits(100_000, std)).toBe(146);
	});

	it("换算因子非法时使用默认 100 积分/元", () => {
		expect(quotaToCredits(500_000, { quotaPerUnit: 0, usdExchangeRate: 0, creditsPerCny: 0 })).toBe(730);
	});

	it("可配置汇率 / 积分比生效", () => {
		// 500000/500000=1 ×7=7 ×20=140
		expect(quotaToCredits(500_000, { quotaPerUnit: 500_000, usdExchangeRate: 7, creditsPerCny: 20 })).toBe(140);
	});
});

describe("deriveChatConversationId", () => {
	it("同 (userId, sessionKey) 稳定一致", () => {
		const a = deriveChatConversationId("u1", "project:p:lane:general:skill:default");
		const b = deriveChatConversationId("u1", "project:p:lane:general:skill:default");
		expect(a).toBe(b);
		expect(a.startsWith("tc-")).toBe(true);
	});

	it("不同会话/用户隔离", () => {
		const a = deriveChatConversationId("u1", "s1");
		expect(deriveChatConversationId("u1", "s2")).not.toBe(a);
		expect(deriveChatConversationId("u2", "s1")).not.toBe(a);
	});
});

describe("isChatBillingEnabled", () => {
	it("默认开启", () => {
		expect(isChatBillingEnabled(env())).toBe(true);
		expect(isChatBillingEnabled(env({ TAP_CHAT_BILLING_ENABLED: "true" }))).toBe(true);
	});
	it("仅 'false' 关闭（kill-switch，大小写不敏感）", () => {
		expect(isChatBillingEnabled(env({ TAP_CHAT_BILLING_ENABLED: "false" }))).toBe(false);
		expect(isChatBillingEnabled(env({ TAP_CHAT_BILLING_ENABLED: "FALSE" }))).toBe(false);
	});
});

describe("chatReservationTargetCredits", () => {
	it("默认优先冻结 500", () => {
		expect(chatReservationTargetCredits(env())).toBe(500);
	});
	it("env 覆盖", () => {
		expect(chatReservationTargetCredits(env({ TAP_CHAT_RESERVATION_CREDITS: "100" }))).toBe(100);
	});
	it("非法值回退默认", () => {
		expect(chatReservationTargetCredits(env({ TAP_CHAT_RESERVATION_CREDITS: "abc" }))).toBe(500);
	});
});

describe("beginChatBilling", () => {
	it("以同一 effectId 创建可结算的 reservation handle", async () => {
		requireSufficientTeamCredits.mockResolvedValueOnce({
			teamId: "team-1",
			reservationTaskId: "turn-1",
			amount: 500,
			taskKind: "agents_chat",
		});
		const handle = await beginChatBilling(
			{
				env: env(),
				get: (() => undefined) as never,
				req: {} as never,
			} as never,
			"user-1",
			{
				conversationId: "conversation-1",
				sinceMs: 12.8,
				modelKey: "gpt-5",
				effectId: "turn-1",
			},
		);
		expect(requireSufficientTeamCredits).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
			expect.objectContaining({
				required: 500,
				minimumRequired: 1,
				reservationTaskId: "turn-1",
				taskKind: "agents_chat",
			}),
		);
		expect(handle).toEqual({
			effectId: "turn-1",
			reservationTaskId: "turn-1",
			reservedCredits: 500,
			conversationId: "conversation-1",
			sinceMs: 12,
			modelKey: "gpt-5",
		});
	});

	it("preserves a partial reservation amount in the settlement handle", async () => {
		requireSufficientTeamCredits.mockResolvedValueOnce({
			teamId: "team-1",
			reservationTaskId: "turn-low-balance",
			amount: 3,
			taskKind: "agents_chat",
		});

		const handle = await beginChatBilling(
			{
				env: env(),
				get: (() => undefined) as never,
				req: {} as never,
			} as never,
			"user-1",
			{
				conversationId: "conversation-1",
				sinceMs: 50,
				modelKey: "deepseek-v4-flash",
				effectId: "turn-low-balance",
			},
		);

		expect(handle?.reservedCredits).toBe(3);
	});

	it("only requests existing-freeze adoption when durable recovery explicitly enables it", async () => {
		requireSufficientTeamCredits.mockResolvedValueOnce({
			teamId: "team-1",
			reservationTaskId: "recovered-run",
			amount: 81,
			taskKind: "agents_chat",
		});

		const handle = await beginChatBilling(
			{
				env: env(),
				get: (() => undefined) as never,
				req: {} as never,
			} as never,
			"user-1",
			{
				conversationId: "conversation-1",
				sinceMs: 70,
				modelKey: "gpt-5",
				effectId: "recovered-run",
				allowExistingReservation: true,
			},
		);

		expect(handle?.reservedCredits).toBe(81);
		expect(requireSufficientTeamCredits).toHaveBeenCalledWith(
			expect.anything(),
			"user-1",
			expect.objectContaining({ allowExistingReservation: true }),
		);
	});
});
