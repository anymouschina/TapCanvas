import { describe, expect, it } from "vitest";
import { bindWorkflowVideoSourceEvidence } from "./execution.video-source-evidence";
import { workflowSourceSetIdentity } from "./execution.source-lineage";
import { sha256Hex } from "../asset/book-content-hash";

const original = "  爬升再俯冲。\n卸力翻滚踩稳。  ";
const receipt = { sourceId: "source-a", sourceFingerprint: sha256Hex(original.trim()) };
const source = { ...receipt, content: original };
const bind = (sources: unknown, sourceReceipt: unknown = receipt) => bindWorkflowVideoSourceEvidence({
	sourceReceipt,
	deliveryContract: { canvasFacts: { authoritativeSources: sources } },
});

describe("frozen video source evidence", () => {
	it("binds exactly one frozen identity and preserves its complete original wording", () => {
		const sources = [
			{ ...source, sourceId: "unrelated", content: "其他来源" },
			{ ...source, sourceFingerprint: "previous-version", content: "旧版本" },
			source,
		];
		const snapshot = structuredClone(sources);
		expect(bind(sources)).toEqual({
			protocolVersion: "tapcanvas.source-evidence/v1",
			origin: "delivery-contract.canvasFacts.authoritativeSources",
			...receipt,
			status: "matched",
			sources: [source],
		});
		expect(sources).toEqual(snapshot);
	});

	it("preserves an exact ordered multi-source identity without concatenation or unrelated sources", () => {
		const second = { sourceId: "source-b", sourceFingerprint: sha256Hex("第二份原文"), content: "第二份原文" };
		const sources = [source, second];
		const setReceipt = workflowSourceSetIdentity(sources.map(({ sourceId, sourceFingerprint }) => ({ sourceId, sourceFingerprint })));
		expect(bind(sources, setReceipt)).toMatchObject({ status: "matched", sources });
		expect(bind([...sources].reverse(), setReceipt)).toMatchObject({ status: "unavailable" });
		expect(bind([...sources, { ...second, sourceId: "unrelated" }], setReceipt)).toMatchObject({ status: "unavailable" });
	});

	it.each([
		{ sources: [], reason: "authoritative_sources_unavailable" },
		{ sources: [{ ...source, sourceId: "unrelated" }], reason: "source_identity_not_found" },
		{ sources: [{ nodeId: receipt.sourceId, sourceFingerprint: receipt.sourceFingerprint, content: original }], reason: "source_identity_not_found" },
		{ sources: [{ ...source, sourceFingerprint: "other" }], reason: "source_fingerprint_mismatch" },
		{ sources: [source, source], reason: "source_identity_ambiguous" },
		{ sources: [{ ...source, content: " \n " }], reason: "source_content_unavailable" },
		{ sources: [{ ...receipt, summary: original }], reason: "source_content_unavailable" },
		{ sources: [{ ...source, content: "内容被覆盖" }], reason: "source_content_fingerprint_mismatch" },
	])("reports $reason without fabricating source text or terminating authoring", ({ sources, reason }) => {
		const evidence = bind(sources);
		expect(evidence).toMatchObject({ status: "unavailable", diagnostic: { reason, blocking: false } });
		expect(evidence).not.toHaveProperty("content");
		expect(evidence).not.toHaveProperty("sources");
	});

	it("never infers the requested identity from the only available source", () => {
		expect(bind([source], {})).toMatchObject({
			status: "unavailable",
			diagnostic: { reason: "source_receipt_invalid", blocking: false },
		});
	});
});
