import { describe, expect, it } from "vitest";

import {
	sanitizeExecutionTraceEventPayload,
	sanitizeExecutionTraceEventPayloadWithMeta,
} from "./execution-trace-event-sanitizer";

describe("execution trace event payload sanitizer", () => {
	it("keeps inspectable prompt and tool data while redacting credential fields", () => {
		expect(sanitizeExecutionTraceEventPayload({
			prompt: "生成当前章节整片",
			tool: { name: "Skill", apiKey: "private", output: "reference loaded" },
		})).toEqual({
			prompt: "生成当前章节整片",
			tool: { name: "Skill", apiKey: "[REDACTED]", output: "reference loaded" },
		});
	});

	it("reports structural truncation instead of making a full-payload claim", () => {
		const sanitized = sanitizeExecutionTraceEventPayloadWithMeta({ text: "x".repeat(64_001) });
		expect(sanitized.truncated).toBe(true);
		expect(String(sanitized.payload.text)).toContain("[TRUNCATED:1]");
	});
});
