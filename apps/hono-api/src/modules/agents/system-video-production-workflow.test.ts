import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compileWorkflowGraph } from "../execution/execution.recovery";
import { buildWorkflowCapabilityDescriptor } from "./capability-bay.descriptor";
import { inspectVideoWorkflowCanvasDefinition } from "../execution/execution.video-workflow-definition-authority";
import { BUILTIN_VIDEO_PRODUCTION_WORKFLOW as identity, builtInVideoProductionWorkflowSql, createBuiltInVideoProductionWorkflowDefinition } from "./system-video-production-workflow";

describe("system video production workflow", () => {
	it("compiles the current canonical graph and declares real execution dependencies", () => {
		const definition = createBuiltInVideoProductionWorkflowDefinition();
		const graph = JSON.parse(definition.flowData) as Parameters<typeof compileWorkflowGraph>[0];
		expect(() => compileWorkflowGraph(graph)).not.toThrow();
		expect(inspectVideoWorkflowCanvasDefinition(definition.flowData)).toMatchObject({ applicable: true, current: true });
		const descriptor = buildWorkflowCapabilityDescriptor({
			flow: { id: identity.flowId, name: definition.flowName, data: definition.flowData, project_id: identity.projectId, canvas_revision: 0 },
			version: { id: identity.flowVersionId, data: definition.flowData },
		});
		expect(descriptor.invocation?.sourceMode).toBe("project_context");
		expect(descriptor.invocation?.requiredTriggerPayloadFields).toContain("videoModelKey");
		expect(descriptor.requiredSkills).toContain("tapcanvas-video-authoring-stages");
		expect(definition.flowData).toContain("chapter-assets-agent");
		expect(definition.flowData).toContain("clip-design-agent");
		expect(definition.flowData).toContain("tapcanvas.video.prepare/v1");
	});
	it("publishes a new immutable release without rewriting executions or the character-splitting workflow", () => {
		const sql = builtInVideoProductionWorkflowSql();
		expect(readFileSync("sql/releases/20260920_video_production_v90.sql", "utf8")).toBe(sql);
		expect(sql).toContain(identity.flowVersionId);
		expect(sql).toContain("ON CONFLICT (id) DO NOTHING");
		expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE)\s+(?:flows|flow_versions|executions|agent_capability_attachments)\b/u);
		expect(sql).not.toContain("00000000-0000-4000-8000-000000000112");
	});
});
