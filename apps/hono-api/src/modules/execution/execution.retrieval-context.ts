export const RETRIEVAL_CONTEXT_PROTOCOL = "retrieval-context/v1" as const;

export type RetrievalContextFactV1 = Readonly<{
	id: string;
	text: string;
	source: "instruction" | "delivery" | "input" | "scope";
}>;

export type RetrievalContextV1 = Readonly<{
	protocolVersion: typeof RETRIEVAL_CONTEXT_PROTOCOL;
	facts: readonly RetrievalContextFactV1[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeRetrievalContextV1(value: unknown): RetrievalContextV1 | null {
	if (!isRecord(value) || value.protocolVersion !== RETRIEVAL_CONTEXT_PROTOCOL || !Array.isArray(value.facts)) {
		return null;
	}
	const facts = value.facts.slice(0, 8).flatMap((item): RetrievalContextFactV1[] => {
		if (!isRecord(item)) return [];
		const id = typeof item.id === "string" ? item.id.trim().slice(0, 160) : "";
		const text = typeof item.text === "string" ? item.text.trim().slice(0, 4_000) : "";
		const source = item.source;
		if (
			!id
			|| !text
			|| (source !== "instruction" && source !== "delivery" && source !== "input" && source !== "scope")
		) return [];
		return [{ id, text, source }];
	});
	return { protocolVersion: RETRIEVAL_CONTEXT_PROTOCOL, facts };
}
