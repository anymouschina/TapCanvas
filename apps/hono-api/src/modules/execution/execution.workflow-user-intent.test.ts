import { describe, expect, it } from "vitest";
import { bindWorkflowUserIntentToTrigger, freezeWorkflowUserIntent, readWorkflowUserIntent } from "./execution.workflow-user-intent";
import { workflowIntentFixture as intent } from "./test-fixtures/workflow-user-intent";

describe("workflow user intent handoff", () => {
	it.each(["沿用已确认的解说内容和产品参考", "文档保留已确认引用与受众", "演示使用原始设备和讲解步骤"])("preserves the whole contract independent of subject: %s", (statement) => {
		const contract = intent(statement);
		const frozen = freezeWorkflowUserIntent({ ownerId: "owner", contract, expectedContractHash: String(contract.contractHash) });
		expect(frozen).toEqual({ version: 1, ownerId: "owner", contract });
		expect(frozen?.contract).not.toBe(contract);
		expect(readWorkflowUserIntent(JSON.parse(JSON.stringify(frozen)), "owner")?.contract).toEqual(contract);
	});
	it("does not invent absent intent or silently drop a declared intent payload", () => {
		expect(freezeWorkflowUserIntent({ ownerId: "owner", contract: undefined })).toBeNull();
		expect(readWorkflowUserIntent(undefined, "owner")).toBeNull();
		expect(() => freezeWorkflowUserIntent({ ownerId: "owner", contract: undefined, expectedContractHash: "declared" })).toThrow("workflow_user_intent_payload_missing");
	});
	it("rejects changed semantic payload, mismatched provenance and owner", () => {
		const contract = intent();
		expect(() => freezeWorkflowUserIntent({ ownerId: "owner", contract: { ...contract, confirmedFacts: [] } })).toThrow("完整性校验失败");
		expect(() => freezeWorkflowUserIntent({ ownerId: "owner", contract, expectedContractHash: "other" })).toThrow("workflow_user_intent_provenance_mismatch");
		const frozen = freezeWorkflowUserIntent({ ownerId: "owner", contract });
		expect(() => readWorkflowUserIntent(frozen, "different-owner")).toThrow("workflow_user_intent_invalid");
		expect(() => readWorkflowUserIntent({ version: 1, ownerId: "owner" }, "owner")).toThrow("workflow_user_intent_invalid");
	});
});


describe("bridge machine contract admission", () => {
	it("binds authenticated ownership and preserves trigger facts", () => {
		const contract = intent();
		expect(bindWorkflowUserIntentToTrigger({ ownerId: "owner", contract,
			expectedContractHash: String(contract.contractHash), args: {}, triggerPayload: { text: "source" },
		})).toEqual({ text: "source", workflowUserIntent: { version: 1, ownerId: "owner", contract } });
	});
	it("rejects incomplete machine fields, tampering and model-authored overrides", () => {
		const contract = intent();
		const input = { ownerId: "owner", contract, expectedContractHash: String(contract.contractHash), args: {} };
		expect(() => bindWorkflowUserIntentToTrigger({ ...input, expectedContractHash: undefined }))
			.toThrow("machine_fields_incomplete");
		expect(() => bindWorkflowUserIntentToTrigger({ ...input, expectedContractHash: "changed" }))
			.toThrow("provenance_mismatch");
		expect(() => bindWorkflowUserIntentToTrigger({ ...input, args: { userIntentContract: contract } }))
			.toThrow("machine_field_override");
		expect(() => bindWorkflowUserIntentToTrigger({ ...input, triggerPayload: { workflowUserIntent: {} } }))
			.toThrow("machine_field_override");
	});
});
