import { describe, expect, it } from "vitest";

import { AppError } from "../../middleware/error";
import {
	ASYNC_AGENT_CONTINUATION_MAX_ATTEMPTS,
	isAsyncAgentContinuationAttemptDue,
	planAsyncAgentContinuationRetry,
} from "./async-agent-continuation-retry";

describe("planAsyncAgentContinuationRetry", () => {
	it("requeues a structurally proven upstream 503 without changing models", () => {
		const error = new AppError("Agents bridge 调用失败", {
			status: 502,
			code: "agents_bridge_failed",
			details: {
				status: 502,
				body: JSON.stringify({
					code: "newapi_request_failed",
					details: { upstreamStatus: 503 },
				}),
			},
		});
		const now = new Date("2026-08-01T01:00:00.000Z");

		const plan = planAsyncAgentContinuationRetry({
			error,
			currentAttempt: 0,
			now,
		});

		expect(plan).toMatchObject({
			shouldRetry: true,
			attempt: 1,
			nextAttemptAt: "2026-08-01T01:00:15.000Z",
			failure: {
				code: "agents_bridge_failed",
				status: 502,
				upstreamStatus: 503,
				retryable: true,
			},
		});
	});

	it("never replays an ambiguous network failure after possible admission", () => {
		const error = new AppError("network closed", {
			status: 502,
			code: "agents_bridge_fetch_failed",
		});

		expect(
			planAsyncAgentContinuationRetry({ error, currentAttempt: 0 }),
		).toMatchObject({ shouldRetry: false, attempt: 1, nextAttemptAt: null });
	});

	it("requeues a classified stream interruption on the same durable continuation", () => {
		const error = new AppError("Agents bridge 流在返回终态结果前中断", {
			status: 502,
			code: "agents_bridge_stream_interrupted",
		});
		const now = new Date("2026-08-01T01:00:00.000Z");

		expect(planAsyncAgentContinuationRetry({ error, currentAttempt: 0, now })).toMatchObject({
			shouldRetry: true,
			attempt: 1,
			nextAttemptAt: "2026-08-01T01:00:15.000Z",
			failure: {
				code: "agents_bridge_stream_interrupted",
				status: 502,
				retryable: true,
			},
		});
	});

	it("requeues a bridge error event on the same durable continuation", () => {
		const error = new AppError(
			'Schema for "tapcanvas_video_orchestrate" not found. Available: none',
			{
				status: 502,
				code: "agents_bridge_stream_failed",
			},
		);
		const now = new Date("2026-08-01T01:00:00.000Z");

		expect(planAsyncAgentContinuationRetry({ error, currentAttempt: 0, now })).toMatchObject({
			shouldRetry: true,
			attempt: 1,
			nextAttemptAt: "2026-08-01T01:00:15.000Z",
			failure: {
				code: "agents_bridge_stream_failed",
				status: 502,
				retryable: true,
			},
		});
	});

	it("stops with an explicit failure after the bounded same-model attempts", () => {
		const error = new AppError("upstream unavailable", {
			status: 503,
			code: "newapi_request_failed",
		});

		const plan = planAsyncAgentContinuationRetry({
			error,
			currentAttempt: ASYNC_AGENT_CONTINUATION_MAX_ATTEMPTS - 1,
		});

		expect(plan).toMatchObject({
			shouldRetry: false,
			attempt: ASYNC_AGENT_CONTINUATION_MAX_ATTEMPTS,
			nextAttemptAt: null,
		});
	});
});

describe("isAsyncAgentContinuationAttemptDue", () => {
	it("honors the persisted retry deadline", () => {
		const now = Date.parse("2026-08-01T01:00:00.000Z");
		expect(isAsyncAgentContinuationAttemptDue(null, now)).toBe(true);
		expect(
			isAsyncAgentContinuationAttemptDue("2026-08-01T00:59:59.000Z", now),
		).toBe(true);
		expect(
			isAsyncAgentContinuationAttemptDue("2026-08-01T01:00:01.000Z", now),
		).toBe(false);
	});
});
