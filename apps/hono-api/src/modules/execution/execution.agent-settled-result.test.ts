import { beforeEach, expect, it, vi } from "vitest";
import type { PrismaClient } from "../../types";
const { queryOne } = vi.hoisted(() => ({ queryOne: vi.fn() }));
vi.mock("../../db/db", () => ({ queryOne }));
import { readWorkflowAgentSettledResult } from "./execution.agent-settled-result";
beforeEach(() => queryOne.mockReset());
const input = { ownerId: "owner", sessionKey: "stable-session", publicTurnIds: ["exact-physical-turn"],
	outputContract: { kind: "json", jsonSchema: { type: "object" } } };
it("binds settled continuation text to the exact owner/session/turn and frozen contract", async () => {
	queryOne.mockResolvedValueOnce({ trace_id: "immutable-continuation", public_turn_id: "exact-physical-turn", response_text: '{"result":"original"}',
		meta_json: '{"requestTerminal":{"status":"succeeded"}}',
		output_contract: { jsonSchema: { type: "object" }, kind: "json" } });
	expect(await readWorkflowAgentSettledResult({} as PrismaClient, input)).toMatchObject({
		traceId: "immutable-continuation", publicTurnId: "exact-physical-turn", text: '{"result":"original"}' });
	expect(queryOne.mock.calls[0]?.[2]).toEqual(["owner", "stable-session", "exact-physical-turn"]);
	const sql = queryOne.mock.calls[0]?.[1] as string;
	expect(sql).toContain("event.payload_truncated = false");
	expect(sql).toContain("trace.status = 'succeeded'");
});
it.each([null, { kind: "json", jsonSchema: { type: "array" } }])("does not reuse a different frozen contract (%s)", async output_contract => {
	queryOne.mockResolvedValueOnce({ trace_id: "other-contract", response_text: "original", meta_json: "{}", output_contract });
	expect(await readWorkflowAgentSettledResult({} as PrismaClient, input)).toBeNull();
});
