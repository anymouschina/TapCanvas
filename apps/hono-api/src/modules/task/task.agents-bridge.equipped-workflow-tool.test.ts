import { describe, expect, it } from "vitest";

import {
	buildAgentsBridgeRemoteTools,
	buildEquippedWorkflowPrimaryCapabilityRoutes,
	equippedWorkflowRequiresImageModel,
	equippedWorkflowRequiresVideoModel,
	filterEquippedWorkflowsByExecutionVariant,
} from "./task.agents-bridge";

type JsonSchemaNode = {
	type?: string;
	description?: string;
	minimum?: number;
	minItems?: number;
	maxItems?: number;
	const?: string;
	enum?: readonly string[];
	properties?: Record<string, JsonSchemaNode>;
	required?: readonly string[];
	additionalProperties?: boolean;
	oneOf?: readonly JsonSchemaNode[];
	items?: JsonSchemaNode;
};

describe("equipped workflow remote tool contract", () => {
	it("filters equipped workflows by the request's structural execution variant", () => {
		const workflows = [
			{
				id: "full",
				descriptor: { invocation: { executionVariant: "full_video" as const } },
				primaryForCapabilities: [{ capabilityId: "builtin:one_click_video" }],
			},
			{
				id: "first",
				descriptor: { invocation: { executionVariant: "first_video" as const } },
			},
			{
				id: "undeclared",
				descriptor: {},
			},
		];

		expect(filterEquippedWorkflowsByExecutionVariant(workflows, "full_video").map((item) => item.id))
			.toEqual(["full"]);
		expect(filterEquippedWorkflowsByExecutionVariant(workflows, "first_video").map((item) => item.id))
			.toEqual(["first"]);
		expect(filterEquippedWorkflowsByExecutionVariant(workflows, null).map((item) => item.id))
			.toEqual(["full", "undeclared"]);
	});

	it("projects the equipped workflow as the one-click video primary route", () => {
		expect(buildEquippedWorkflowPrimaryCapabilityRoutes([{
			attachmentId: "attachment-video",
			name: "Video workflow",
			summary: "",
			primaryForCapabilities: [{
				capabilityId: "builtin:one_click_video",
				name: "一键成片",
				description: "",
			}],
		}])).toEqual([{
			capabilityId: "builtin:one_click_video",
			toolName: "tapcanvas_equipped_workflow_run",
			attachmentId: "attachment-video",
		}]);
	});
	it("keeps the tool absent until the user equips a workflow", () => {
		const tools = buildAgentsBridgeRemoteTools({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
		});

		expect(tools.some((tool) => tool.name === "tapcanvas_equipped_workflow_run")).toBe(false);
	});

	it("pins selectable attachment ids and requires an idempotency key", () => {
		const tools = buildAgentsBridgeRemoteTools({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			equippedWorkflows: [
				{ attachmentId: "attachment-a", name: "一键成片", summary: "从主题生成完整视频" },
				{ attachmentId: "attachment-b", name: "分镜审查", summary: "审查当前分镜" },
			],
		});
		const tool = tools.find((candidate) => candidate.name === "tapcanvas_equipped_workflow_run");
		const schema = tool?.parameters as JsonSchemaNode | undefined;

		expect(tool?.execution).toEqual({
			sideEffect: "external_mutation",
			retrySafety: "idempotency_key_required",
			executionMode: "sequential",
			idempotencyKeyField: "idempotencyKey",
			resultLookupSupported: true,
		});
		expect(schema?.properties?.attachmentId?.enum).toEqual(["attachment-a", "attachment-b"]);
		expect(schema?.properties?.concurrency).toBeUndefined();
		expect(schema?.required).toEqual(["attachmentId", "idempotencyKey"]);
		expect(schema?.additionalProperties).toBe(false);
		expect(tool?.description).toContain("一键成片");
		expect(tool?.description).toContain("pins the saved workflow version");
		expect(tool?.description).toContain("已装配的 Workflow IR");
		expect(tool?.description).not.toContain("tapcanvas_video_orchestrate");
		expect(schema?.properties?.triggerPayload?.properties?.preparedBeatSheet).toBeUndefined();
	});

	it("exposes caller source-group binding and asset reuse in the trigger payload contract", () => {
		const tools = buildAgentsBridgeRemoteTools({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			equippedWorkflows: [
				{ attachmentId: "attachment-a", name: "一键成片", summary: "从主题生成完整视频" },
			],
		});
		const tool = tools.find((candidate) => candidate.name === "tapcanvas_equipped_workflow_run");
		const payload = (tool?.parameters as JsonSchemaNode | undefined)?.properties?.triggerPayload as JsonSchemaNode | undefined;
		const fields = payload?.properties;

		expect(fields?.sourceGroupId).toBeDefined();
		expect(fields?.source).toBeDefined();
		expect(fields?.requestedClipCount).toMatchObject({
			type: "number",
			minimum: 1,
		});
		expect(fields?.requestedClipCount?.description).toContain("用户明确指定");
		expect(fields?.requestedClipDurationsSeconds).toMatchObject({
			type: "array",
			minItems: 1,
			maxItems: 64,
			items: { type: "number", minimum: 1 },
		});
		expect(fields?.requestedClipDurationsSeconds?.description).toContain("总和必须等于 targetDurationSeconds");
		expect(payload?.additionalProperties).toBe(false);
		expect(tool?.description).toContain("sourceGroupId");
		expect(tool?.description).toContain("requestedClipCount");
		expect(tool?.description).toContain("requestedClipDurationsSeconds");
		expect(tool?.description).toContain("不得从题材或总时长推断");
	});

	it("requires the input field derived from the only equipped workflow", () => {
		const tools = buildAgentsBridgeRemoteTools({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			equippedWorkflows: [{
				attachmentId: "attachment-inline",
				name: "一键成片",
				summary: "接收源文本并交付完整视频",
				invocation: { sourceMode: "inline_text", requiredTriggerPayloadFields: ["source"] },
			}],
		});
		const tool = tools.find((candidate) => candidate.name === "tapcanvas_equipped_workflow_run");
		const schema = tool?.parameters as JsonSchemaNode | undefined;
		const payload = schema?.properties?.triggerPayload;

		expect(schema?.properties?.attachmentId).toBeUndefined();
		expect(schema?.required).toEqual(["idempotencyKey", "triggerPayload"]);
		expect(payload?.required).toEqual(["source"]);
		expect(tool?.description).toContain("server binds its exact attachment ID");
		expect(tool?.description).toContain("do not submit attachmentId");
		expect(tool?.description).toContain("sourceMode=inline_text");
		expect(tool?.description).toContain("triggerPayload 必须提供 source");
	});

	it("keeps BeatSheet authoring inside the equipped workflow", () => {
		const tools = buildAgentsBridgeRemoteTools({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			equippedWorkflows: [{
				attachmentId: "attachment-video",
				name: "一键成片",
				summary: "完整成片",
			}],
		});
		const tool = tools.find((candidate) => candidate.name === "tapcanvas_equipped_workflow_run");
		const schema = tool?.parameters as JsonSchemaNode | undefined;
		const branch = schema?.oneOf?.[0];

		expect(schema?.properties?.attachmentId).toBeUndefined();
		expect(branch?.properties?.attachmentId).toBeUndefined();
		expect(branch?.required).toEqual([]);
		expect(schema?.properties?.triggerPayload?.properties?.preparedBeatSheet).toBeUndefined();
		expect(tool?.description).not.toContain("preparedBeatSheet");
	});

	it("describes a confirmed one-click replacement as the video delivery authority", () => {
		const tools = buildAgentsBridgeRemoteTools({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			enabledVideoModelKeys: ["veo-3.1", "doubao-seedance-2.5", "veo-3.1"],
			equippedWorkflows: [{
				attachmentId: "attachment-a",
				name: "一键成片工作流",
				summary: "从当前项目交付完整视频",
				invocation: {
					sourceMode: "project_context",
					requiredTriggerPayloadFields: ["videoModelKey"],
				},
				primaryForCapabilities: [{
					capabilityId: "builtin:one_click_video",
					name: "一键成片",
					description: "从创作目标规划并交付完整成片。",
				}],
			}],
		});
		const tool = tools.find((candidate) => candidate.name === "tapcanvas_equipped_workflow_run");
		const schema = tool?.parameters as JsonSchemaNode | undefined;
		const branch = schema?.oneOf?.[0];

		expect(tool?.description).toContain("用户已确认该工作流是这些能力的主路径替代")
		expect(tool?.description).toContain("builtin:one_click_video（一键成片）")
		expect(tool?.description).toContain("videoModelKey、videoResolution、videoAspectRatio")
		expect(schema?.required).toEqual(["idempotencyKey", "triggerPayload"]);
		expect(schema?.properties?.triggerPayload?.required).toEqual(["videoModelKey"]);
		expect(schema?.properties?.triggerPayload?.properties?.videoModelKey?.enum).toEqual([
			"doubao-seedance-2.5",
			"veo-3.1",
		]);
		expect(schema?.properties?.triggerPayload?.properties?.videoModelKey?.enum).not.toContain(
			"doubao-seedance-2-0-pro",
		);
		expect(branch?.required).toEqual(["triggerPayload"]);
		expect(branch?.properties?.triggerPayload?.required).toEqual(["videoModelKey"]);
	});

	it("classifies the one-click capability as requiring an explicit video model", () => {
		expect(equippedWorkflowRequiresVideoModel({
			invocation: { requiredTriggerPayloadFields: ["videoModelKey"] },
		})).toBe(true);
		expect(equippedWorkflowRequiresVideoModel({
			invocation: { requiredTriggerPayloadFields: ["source"] },
		})).toBe(false);
	});

	it("projects the live image model enum and image execution fields for unpinned image nodes", () => {
		const tools = buildAgentsBridgeRemoteTools({
			publicAgentsRequest: true,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			enabledImageModelKeys: ["gpt-image-2", "nano-banana-pro", "gpt-image-2"],
			equippedWorkflows: [{
				attachmentId: "attachment-image",
				name: "补图工作流",
				summary: "补齐真实参考图",
				invocation: {
					sourceMode: "project_context",
					requiredTriggerPayloadFields: ["imageModelKey", "imageAspectRatio", "imageSize"],
				},
			}],
		});
		const tool = tools.find((candidate) => candidate.name === "tapcanvas_equipped_workflow_run");
		const payload = (tool?.parameters as JsonSchemaNode | undefined)?.properties?.triggerPayload;

		expect(payload?.required).toEqual(["imageModelKey", "imageAspectRatio", "imageSize"]);
		expect(payload?.properties?.imageModelKey?.enum).toEqual(["gpt-image-2", "nano-banana-pro"]);
		expect(payload?.properties?.imageSize).toMatchObject({ type: "string" });
		expect(payload?.properties?.imageAspectRatio).toMatchObject({ type: "string" });
		expect(tool?.description).toContain("imageModelKey、imageAspectRatio、imageSize");
		expect(equippedWorkflowRequiresImageModel({
			invocation: { requiredTriggerPayloadFields: ["imageModelKey"] },
		})).toBe(true);
		expect(equippedWorkflowRequiresImageModel({
			invocation: { requiredTriggerPayloadFields: ["videoModelKey"] },
		})).toBe(false);
	});
});
