import { createHash } from "node:crypto";

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
}

export function workflowIntentFixture(statement = "沿用已确认的解说内容和产品参考"): Record<string, unknown> {
	const body = {
		version: 2, referenceResolution: { mode: "continuation" },
		delivery: { mode: "async_artifact", mediaType: "video", kind: "成片", output: "完整成片" },
		must: [{ id: "m1", source: "user", statement, evidence: ["prior-turn:1"] }],
		forbid: [{ id: "f1", source: "user", statement: "不得虚构产品承诺", evidence: ["prior-turn:1"] }],
		prefer: [], confirmedFacts: [{ id: "fact1", source: "asset", statement: "采用的视觉观察", evidence: ["asset:original-1", "analysis:receipt-1"] }],
		unresolved: [], precedence: ["user_must"],
	};
	return { ...body, contractHash: createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex") };
}
