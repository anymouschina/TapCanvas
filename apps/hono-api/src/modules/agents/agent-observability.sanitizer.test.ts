import { describe, expect, it } from "vitest";

import { sanitizeAgentObservabilityRecord } from "./agent-observability.sanitizer";

describe("agent observability attribute sanitization", () => {
	it("preserves correlation fields and hashes free text", () => {
		const result = sanitizeAgentObservabilityRecord({
			traceId: "a".repeat(32),
			label: "public_chat",
			workflowKey: "public_chat.general",
			modelKey: "gpt-5",
			taskGoal: "private user goal",
		});
		expect(result.traceId).toBe("a".repeat(32));
		expect(result.label).toBe("public_chat");
		expect(result.workflowKey).toBe("public_chat.general");
		expect(result.modelKey).toBe("gpt-5");
		expect(result.taskGoal).toEqual(expect.objectContaining({
			type: "string",
			chars: 17,
		}));
	});

	it("retains only URL origin and a one-way value hash", () => {
		const result = sanitizeAgentObservabilityRecord({
			assetUrl: "https://cdn.example.com/a.png?token=private",
		});
		expect(result.assetUrl).toEqual(expect.objectContaining({
			present: true,
			origin: "https://cdn.example.com",
		}));
		expect(JSON.stringify(result)).not.toContain("private");
	});

	it("redacts credential-shaped keys under every nesting level", () => {
		const result = sanitizeAgentObservabilityRecord({ nested: { apiKey: "secret" } });
		expect(result).toEqual({ nested: { apiKey: "[REDACTED]" } });
	});

	it("makes the legacy execution audit structurally safe at its persistence boundary", () => {
		const result = sanitizeAgentObservabilityRecord({
			assistantTextPreview: "private assistant answer",
			responseTrace: {
				output: {
					preview: "private output preview",
					head: "private output head",
					tail: "private output tail",
				},
			},
			toolCall: {
				toolCallId: "call_1",
				toolName: "tapcanvas_call_tool",
				input: { prompt: "private tool prompt", assetUrl: "https://cdn.example/a?token=secret" },
				outputJson: { message: "private tool output", authorization: "Bearer secret" },
			},
		});
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("private");
		expect(serialized).not.toContain("Bearer");
		expect(serialized).not.toContain("?token=");
		expect(result.toolCall).toEqual(expect.objectContaining({
			toolCallId: "call_1",
			toolName: "tapcanvas_call_tool",
		}));
	});
});
