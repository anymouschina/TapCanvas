import { execFileSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryAll } = vi.hoisted(() => ({ queryAll: vi.fn() }));
vi.mock("../../db/db", () => ({
	queryAll,
	execute: vi.fn(async () => undefined),
	queryOne: vi.fn(async () => null),
}));

import { listPublicChatMessages } from "./public-chat-session.repo";

// Execute the actual repository SQL against an isolated, in-memory database.
// No application data or running API is involved.
const queryFixture = `
import json, sqlite3, sys
request = json.load(sys.stdin)
db = sqlite3.connect(':memory:')
db.row_factory = sqlite3.Row
db.execute('CREATE TABLE public_chat_messages (id TEXT, user_id TEXT, session_id TEXT, role TEXT, created_at TEXT)')
rows = [
 ('u1', 'user', '2026-09-07T10:31:00.000Z'),
 ('a1', 'assistant', '2026-09-07T10:31:00.000Z'),
 ('u2', 'user', '2026-09-07T10:32:00.000Z'),
 ('a2', 'assistant', '2026-09-07T10:32:00.000Z'),
]
if request['reverseInsertion']: rows.reverse()
for id, role, timestamp in rows:
 db.execute('INSERT INTO public_chat_messages VALUES (?, ?, ?, ?, ?)', (id, 'user-1', 'session-1', role, timestamp))
print(json.dumps([dict(row) for row in db.execute(request['sql'], request['params'])]))
`;

describe("public chat history chronology", () => {
	beforeEach(() => { queryAll.mockReset(); });

	it.each([false, true])("keeps requests before replies sharing a timestamp (reverse insertion: %s)", async (reverseInsertion) => {
		queryAll.mockImplementation(async (_db: unknown, sql: string, params: unknown[]) =>
			JSON.parse(execFileSync("python3", ["-c", queryFixture], {
				input: JSON.stringify({ sql, params, reverseInsertion }), encoding: "utf8",
			})) as unknown);
		const messages = await listPublicChatMessages({} as never, {
			userId: "user-1", sessionId: "session-1", limit: 20,
		});
		expect(messages.map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2"]);
		const latest = await listPublicChatMessages({} as never, {
			userId: "user-1", sessionId: "session-1", limit: 1,
		});
		expect(latest.map((message) => message.id)).toEqual(["a2"]);
	});
});
