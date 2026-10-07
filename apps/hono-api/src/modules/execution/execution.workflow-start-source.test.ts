import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { sha256Hex } from "../asset/book-content-hash";
import { projectWorkflowStartSourceEnvelope } from "./execution.workflow-start-source";

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	return Object.fromEntries(
		Object.keys(record)
			.filter((key) => key !== "contractHash" && !(key === "promptMediaType" && record[key] === null))
			.sort()
			.map((key) => [key, canonicalize(record[key])]),
	);
}

function userIntentContract(referenceId: string): Record<string, unknown> {
	const base: Record<string, unknown> = {
		version: 2,
		referenceResolution: { mode: "derived", referenceId },
		must: [{ id: "keep-source", statement: "沿用已确认剧本", source: "user", evidence: ["上轮交付"] }],
		forbid: [],
		prefer: [],
		confirmedFacts: [],
		unresolved: [],
		precedence: ["provider_protocol_limits", "user_must"],
		delivery: {
			mode: "async_artifact",
			mediaType: "video",
			kind: "short_film",
			output: "基于已确认剧本的短片",
		},
	};
	const contractHash = createHash("sha256")
		.update(JSON.stringify(canonicalize(base)))
		.digest("hex");
	return { ...base, contractHash };
}

function parentDeliveryReference(referenceId: string, content = "已确认的完整剧本") {
	return {
		mode: "actionable",
		version: 1,
		referenceId,
		publicTurnId: "public-chat-turn:approved",
		deliveredAt: "2026-09-26T03:15:15.000Z",
		content,
		contentHash: `sha256:${sha256Hex(content)}`,
		artifactKind: "screenplay",
	};
}

describe("workflow start source envelope projection", () => {
	it("freezes the exact authenticated intent and selected body while preserving trigger facts", () => {
		const reference = parentDeliveryReference("delivery_ref_selected_1");
		const contract = userIntentContract(reference.referenceId);
		const result = projectWorkflowStartSourceEnvelope({
			ownerId: "owner-1",
			modelArgs: { triggerPayload: { source: "model-authored args" } },
			triggerPayload: { source: "model-authored args", targetDurationSeconds: 60 },
			parentUserIntentContract: contract,
			parentDeliveryReference: reference,
			expectedContractHash: String(contract.contractHash),
		});

		expect(result.workflowUserIntent).toMatchObject({ ownerId: "owner-1", contract });
		expect(result.actionableDeliverySource).toMatchObject({
			ownerId: "owner-1",
			reference: {
				referenceId: "delivery_ref_selected_1",
				content: reference.content,
				contentHash: reference.contentHash,
			},
		});
		expect(result.triggerPayload).toMatchObject({
			source: "model-authored args",
			targetDurationSeconds: 60,
			workflowUserIntent: result.workflowUserIntent,
			workflowActionableDeliverySource: result.actionableDeliverySource,
		});
	});

	it("leaves ordinary starts without a parent envelope unchanged", () => {
		const triggerPayload = { source: "direct manual input" };
		const result = projectWorkflowStartSourceEnvelope({
			ownerId: "owner-1",
			modelArgs: { triggerPayload },
			triggerPayload,
			parentUserIntentContract: undefined,
			parentDeliveryReference: undefined,
		});

		expect(result.workflowUserIntent).toBeNull();
		expect(result.actionableDeliverySource).toBeNull();
		expect(result.triggerPayload).toBe(triggerPayload);
	});

	it("validates parent provenance and requires the selected delivery reference", () => {
		const reference = parentDeliveryReference("delivery_ref_selected_2");
		const contract = userIntentContract(reference.referenceId);
		const envelope = {
			ownerId: "owner-1",
			modelArgs: {},
			triggerPayload: undefined,
			parentUserIntentContract: contract,
			parentDeliveryReference: undefined,
		};

		expect(() => projectWorkflowStartSourceEnvelope({
			...envelope,
			expectedContractHash: "different-parent-hash",
		})).toThrowError(expect.objectContaining({ code: "workflow_user_intent_provenance_mismatch" }));
		expect(() => projectWorkflowStartSourceEnvelope({
			...envelope,
			expectedContractHash: String(contract.contractHash),
		})).toThrowError(expect.objectContaining({ code: "workflow_actionable_delivery_source_missing" }));
	});

	it.each([
		{ modelArgs: { workflowUserIntent: {} }, triggerPayload: undefined },
		{ modelArgs: { triggerPayload: {} }, triggerPayload: { workflowActionableDeliverySource: {} } },
	])("rejects model-supplied source authority", ({ modelArgs, triggerPayload }) => {
		expect(() => projectWorkflowStartSourceEnvelope({
			ownerId: "owner-1",
			modelArgs,
			triggerPayload,
			parentUserIntentContract: undefined,
			parentDeliveryReference: undefined,
		})).toThrowError(expect.objectContaining({ code: "workflow_source_authority_reserved" }));
	});
});
