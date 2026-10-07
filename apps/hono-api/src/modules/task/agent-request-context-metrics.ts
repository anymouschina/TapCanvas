import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const message = z.object({
	index: count,
	role: z.enum(["system", "user", "assistant", "tool", "other"]),
	contentType: z.enum(["string", "array", "null", "other", "absent"]),
	contentChars: count,
	toolCallCount: count,
	toolCallParameterChars: count,
	reasoningContentType: z.enum(["absent", "string", "array", "null", "other"]),
	reasoningContentChars: count,
	providerResponseItemCount: count,
	providerResponseItemSerializedChars: count,
	serializedChars: count,
});
const metrics = z.object({
	version: z.literal(1),
	records: z.array(z.object({
		sequence: count,
		messageCount: count,
		providerMessageChars: count,
		systemChars: count,
		totalMessageChars: count,
		messages: z.array(message),
	})).max(16),
});

export type AgentRequestContextMetrics = z.infer<typeof metrics>;

/** Only numeric shape measurements cross the bridge; never raw message fields. */
export function projectAgentRequestContextMetrics(value: unknown): {
	metrics?: AgentRequestContextMetrics;
	issue?: "invalid_request_context_metrics";
} {
	if (value === undefined) return {};
	const result = metrics.safeParse(value);
	return result.success ? { metrics: result.data } : { issue: "invalid_request_context_metrics" };
}
