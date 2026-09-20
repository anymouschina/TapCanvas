import { sha256Hex } from "../asset/book-content-hash";

type SourceRecord = Record<string, unknown>;
export type WorkflowSourceIdentity = Readonly<{ sourceId: string; sourceFingerprint: string }>;

function text(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** Canonicalize source metadata at the producer boundary; preserve the source body verbatim. */
export function freezeWorkflowAuthoritativeSource(source: SourceRecord): SourceRecord {
	const sourceId = text(source.sourceId) || text(source.nodeId);
	const content = text(source.content);
	return {
		...source,
		...(sourceId ? { sourceId } : {}),
		...(content ? { sourceFingerprint: text(source.sourceFingerprint) || sha256Hex(content) } : {}),
	};
}

export function workflowSourceSetIdentity(identities: readonly WorkflowSourceIdentity[]): WorkflowSourceIdentity {
	if (identities.length === 0) throw new Error("Authoritative source identity set must be non-empty");
	if (identities.length === 1) return identities[0];
	const sourceSetHash = sha256Hex(JSON.stringify(identities));
	return { sourceId: `source-set:sha256:${sourceSetHash}`, sourceFingerprint: sourceSetHash };
}

/** Existing exact lineage contract shared by BeatSheet output and writer source evidence. */
export function resolveWorkflowAuthoritativeSourceLineage(sources: readonly SourceRecord[]): WorkflowSourceIdentity {
	const identities = sources.map((source, index) => {
		const normalized = freezeWorkflowAuthoritativeSource(source);
		const sourceId = text(normalized.sourceId);
		const sourceFingerprint = text(normalized.sourceFingerprint);
		const content = text(normalized.content);
		if (!sourceId || !content) throw new Error(`authoritativeSources[${index}] requires sourceId and content`);
		if (sourceFingerprint !== sha256Hex(content)) {
			throw new Error(`authoritativeSources[${index}] sourceFingerprint does not match content`);
		}
		return { sourceId, sourceFingerprint };
	});
	return workflowSourceSetIdentity(identities);
}
