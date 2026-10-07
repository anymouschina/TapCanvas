import { describe, expect, it } from "vitest";
import { sha256Hex } from "../asset/book-content-hash";
import {
	freezeWorkflowActionableDeliverySource,
	parseWorkflowActionableDeliverySource,
	WORKFLOW_ACTIONABLE_DELIVERY_SOURCE_FIELD,
} from "./execution.workflow-source-authority";

function deliveryReference(content = "\n已确认的剧本原文\n"): Record<string, unknown> {
	return {
		mode: "actionable",
		version: 1,
		referenceId: "delivery_ref_exact_001",
		publicTurnId: "public-turn-original",
		deliveredAt: "2026-09-26T03:15:15.000Z",
		content,
		contentHash: `sha256:${sha256Hex(content)}`,
		artifactKind: "screenplay",
		label: "《下次》",
		summary: "足浴店母女与退卡青年之间的一分钟短片剧本",
		executionTarget: {
			mode: "async_artifact",
			mediaType: "video",
			kind: "short_film",
			output: "60秒短片",
			durationSeconds: 60,
		},
		allowedNextActions: ["按原剧本制作视频", "在用户明确修改时改编"],
		originalUserRequest: "创作一条关于遗憾的60秒短片",
	};
}

describe("workflow actionable delivery source", () => {
	it("freezes only the exact reference selected by the owner-scoped parent intent", () => {
		const reference = deliveryReference();
		const source = freezeWorkflowActionableDeliverySource({
			ownerId: "owner-1",
			userIntentContract: { referenceResolution: { mode: "selected_exact", referenceId: reference.referenceId } },
			parentDeliveryReference: reference,
		});

		expect(source).toMatchObject({
			protocolVersion: "tapcanvas.workflow-actionable-delivery-source/v1",
			sourceType: "actionable_delivery",
			ownerId: "owner-1",
			reference: {
				referenceId: "delivery_ref_exact_001",
				content: reference.content,
				contentHash: reference.contentHash,
			},
		});
		expect(parseWorkflowActionableDeliverySource(source, "owner-1")).toEqual(source);
	});

	it("requires the selected reference on a workflow start, without blocking ordinary requests", () => {
		const selectedIntent = { referenceResolution: { mode: "derived", referenceId: "delivery_ref_exact_001" } };
		expect(() => freezeWorkflowActionableDeliverySource({
			ownerId: "owner-1",
			userIntentContract: selectedIntent,
			parentDeliveryReference: undefined,
		})).toThrowError(expect.objectContaining({ code: "workflow_actionable_delivery_source_missing" }));
		expect(freezeWorkflowActionableDeliverySource({
			ownerId: "owner-1",
			userIntentContract: { referenceResolution: { mode: "continuation" } },
			parentDeliveryReference: undefined,
		})).toBeNull();
	});

	it("rejects tampered content, a different reference id, and an unselected payload", () => {
		const reference = deliveryReference();
		const selectedIntent = { referenceResolution: { mode: "selected_exact", referenceId: reference.referenceId } };
		expect(() => freezeWorkflowActionableDeliverySource({
			ownerId: "owner-1",
			userIntentContract: selectedIntent,
			parentDeliveryReference: { ...reference, content: "被改写的原文" },
		})).toThrowError(expect.objectContaining({ code: "workflow_actionable_delivery_source_invalid" }));
		expect(() => freezeWorkflowActionableDeliverySource({
			ownerId: "owner-1",
			userIntentContract: selectedIntent,
			parentDeliveryReference: { ...reference, referenceId: "another-delivery" },
		})).toThrowError(expect.objectContaining({ code: "workflow_actionable_delivery_reference_mismatch" }));
		expect(() => freezeWorkflowActionableDeliverySource({
			ownerId: "owner-1",
			userIntentContract: { referenceResolution: { mode: "new_task" } },
			parentDeliveryReference: reference,
		})).toThrowError(expect.objectContaining({ code: "workflow_actionable_delivery_reference_unselected" }));
	});

	it("keeps the server-owned trigger fact separate from accepted public-chat turns", () => {
		const reference = deliveryReference();
		const source = freezeWorkflowActionableDeliverySource({
			ownerId: "owner-1",
			userIntentContract: { referenceResolution: { mode: "selected_exact", referenceId: reference.referenceId } },
			parentDeliveryReference: reference,
		});
		expect(WORKFLOW_ACTIONABLE_DELIVERY_SOURCE_FIELD).toBe("workflowActionableDeliverySource");
		expect(source?.sourceType).toBe("actionable_delivery");
		expect(source?.sourceType).not.toBe("public_chat_turn");
	});
});
