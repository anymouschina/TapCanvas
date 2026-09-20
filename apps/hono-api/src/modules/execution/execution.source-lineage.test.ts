import { describe, expect, it } from "vitest";
import { sha256Hex } from "../asset/book-content-hash";
import { freezeWorkflowAuthoritativeSource, resolveWorkflowAuthoritativeSourceLineage } from "./execution.source-lineage";

describe("canonical Workflow source lineage", () => {
	it("freezes canvas and chapter identities without altering source text or version metadata", () => {
		const source = { nodeId: "chapter-seed-1", content: "  原文章节\n", sourceRevision: 7, sourceHash: "book-version-hash" };
		const frozen = freezeWorkflowAuthoritativeSource(source);
		expect(frozen).toEqual({ ...source, sourceId: source.nodeId, sourceFingerprint: sha256Hex("原文章节") });
		expect(resolveWorkflowAuthoritativeSourceLineage([frozen])).toEqual({ sourceId: source.nodeId, sourceFingerprint: sha256Hex("原文章节") });
		expect(source).not.toHaveProperty("sourceFingerprint");
	});

	it("uses the same ordered collection identity for every source consumer", () => {
		const sources = [{ sourceId: "a", content: "第一段" }, { sourceId: "b", content: "第二段" }];
		const identities = sources.map((source) => ({ sourceId: source.sourceId, sourceFingerprint: sha256Hex(source.content) }));
		const fingerprint = sha256Hex(JSON.stringify(identities));
		expect(resolveWorkflowAuthoritativeSourceLineage(sources.map(freezeWorkflowAuthoritativeSource))).toEqual({
			sourceId: `source-set:sha256:${fingerprint}`, sourceFingerprint: fingerprint,
		});
	});

	it("does not overwrite an invalid declared fingerprint to conceal a source mismatch", () => {
		const frozen = freezeWorkflowAuthoritativeSource({ sourceId: "a", content: "原文", sourceFingerprint: "incorrect" });
		expect(frozen.sourceFingerprint).toBe("incorrect");
		expect(() => resolveWorkflowAuthoritativeSourceLineage([frozen])).toThrow("sourceFingerprint does not match content");
	});

	it("does not create a legitimate source identity for an empty set", () => {
		expect(() => resolveWorkflowAuthoritativeSourceLineage([])).toThrow("must be non-empty");
	});
});
