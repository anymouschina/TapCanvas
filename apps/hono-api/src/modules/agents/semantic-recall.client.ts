/**
 * Semantic recall (Palace) request/response contract.
 *
 * The caller supplies a closed candidate set (`documents`) and a `scope`; the
 * recall service only ranks inside that set and must echo the scope back so
 * callers can reject cross-scope answers. Channel readiness is reported
 * explicitly so a degraded vector channel is never mistaken for "no match".
 */
export type SemanticRecallChannelStatus = "ready" | "failed" | "skipped";

export type SemanticRecallDocument = Readonly<{
	id: string;
	text: string;
}>;

export type SemanticRecallRequest = Readonly<{
	scope: string;
	query: string;
	documents: SemanticRecallDocument[];
	limit?: number;
}>;

export type SemanticRecallResult = Readonly<{
	id: string;
	score: number;
}>;

export type SemanticRecallFailure = Readonly<{
	channel: "vector" | "sparse";
	reason: string;
	blocking: boolean;
}>;

export type SemanticRecallResponse = Readonly<{
	scope: string;
	results: readonly SemanticRecallResult[];
	diagnostics: Readonly<{
		embeddingModel: string;
		documents: number;
		channels: Readonly<{
			vector: SemanticRecallChannelStatus;
			sparse: SemanticRecallChannelStatus;
		}>;
		failures: readonly SemanticRecallFailure[];
	}>;
}>;
