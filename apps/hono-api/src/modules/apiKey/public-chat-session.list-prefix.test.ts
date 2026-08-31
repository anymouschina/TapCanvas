import { describe, it, expect, vi, beforeEach } from "vitest";

// 锁定「列会话前缀」的 SQL 行为：
// - 默认只按前缀 LIKE；
// - 传 excludeSessionKeyContains 时追加 NOT LIKE，用于把章节会话挡在项目/flow 级列表外
//   （裸前缀 project:<pid> 的 LIKE 会贪婪命中 project:<pid>:chapter:<cid>，否则项目首页串入章节会话）。

const queryAll = vi.fn(async (..._args: unknown[]) => [] as unknown[]);
const execute = vi.fn(async (..._args: unknown[]) => undefined);
const queryOne = vi.fn(async (..._args: unknown[]) => null);

vi.mock("../../db/db", () => ({
	queryAll: (...args: unknown[]) => queryAll(...args),
	execute: (...args: unknown[]) => execute(...args),
	queryOne: (...args: unknown[]) => queryOne(...args),
}));

import { buildPublicChatTurnEntityId, listPublicChatSessionsByPrefix } from "./public-chat-session.repo";

const db = {} as never;

describe("listPublicChatSessionsByPrefix", () => {
	beforeEach(() => {
		queryAll.mockClear();
	});

	it("默认只按前缀 LIKE，不带 NOT LIKE", async () => {
		await listPublicChatSessionsByPrefix(db, {
			userId: "u1",
			sessionKeyPrefix: "project:pid:chapter:ch7",
			limit: 5,
		});
		const [, sql, params] = queryAll.mock.calls.at(-1)!;
		expect(String(sql)).toContain("session_key LIKE ?");
		expect(String(sql)).not.toContain("NOT LIKE");
		expect(params).toEqual(["u1", "project:pid:chapter:ch7%", 5]);
	});

	it("传 excludeSessionKeyContains 时追加 NOT LIKE，章节会话被排除在项目级列表外", async () => {
		await listPublicChatSessionsByPrefix(db, {
			userId: "u1",
			sessionKeyPrefix: "project:pid",
			limit: 15,
			excludeSessionKeyContains: ":chapter:",
		});
		const [, sql, params] = queryAll.mock.calls.at(-1)!;
		expect(String(sql)).toContain("session_key LIKE ? AND session_key NOT LIKE ?");
		expect(params).toEqual(["u1", "project:pid%", "%:chapter:%", 15]);
	});

	it("空 userId / 空前缀直接返回空、不查库", async () => {
		const a = await listPublicChatSessionsByPrefix(db, { userId: "", sessionKeyPrefix: "project:pid" });
		const b = await listPublicChatSessionsByPrefix(db, { userId: "u1", sessionKeyPrefix: "" });
		expect(a).toEqual([]);
		expect(b).toEqual([]);
		expect(queryAll).not.toHaveBeenCalled();
	});
});

describe("public chat turn entity identity", () => {
	it("is stable per user, normalized session, turn and entity kind", () => {
		const first = buildPublicChatTurnEntityId({
			kind: "assistant_message",
			userId: "user-1",
			sessionKey: "Project:ABC",
			turnId: "turn-1",
		});
		expect(buildPublicChatTurnEntityId({
			kind: "assistant_message",
			userId: "user-1",
			sessionKey: "project:abc",
			turnId: "turn-1",
		})).toBe(first);
		expect(buildPublicChatTurnEntityId({
			kind: "turn_run",
			userId: "user-1",
			sessionKey: "project:abc",
			turnId: "turn-1",
		})).not.toBe(first);
		expect(first).toMatch(/^public-chat-assistant_message:[a-f0-9]{64}$/);
	});
});
