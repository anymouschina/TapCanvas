import { describe, expect, it } from "vitest";
import {
	readRemoteToolCapabilityRegistryEntry,
	resolveAgentsBridgeRemoteToolSurface,
} from "./agents-bridge-remote-tool-surface";

describe("agents bridge capability registry", () => {
	it("projects auth, capability, execution and endpoint metadata from one entry", () => {
		const read = readRemoteToolCapabilityRegistryEntry("tapcanvas_flow_get");
		expect(read).toMatchObject({
			capability: "canvas_core",
			requiredScope: ["project", "canvas"],
			execution: {
				sideEffect: "none",
				retrySafety: "safe",
				executionMode: "parallel_safe",
			},
			endpoint: { method: "POST", path: "/agent-tools/:toolName" },
			schemaSource: "remote_tool_definition",
		});

		const generated = readRemoteToolCapabilityRegistryEntry("tapcanvas_image_generate_to_canvas");
		expect(generated.execution.sideEffect).toBe("paid_generation");
		expect(generated.execution.executionMode).toBe("exclusive");
	});

	it("uses the same registry metadata for direct and deferred catalog projections", () => {
		const tools = [
			{ name: "tapcanvas_flow_get", description: "read", parameters: { type: "object" } },
			{ name: "tapcanvas_image_generate_to_canvas", description: "generate", parameters: { type: "object" } },
		];
		const surface = resolveAgentsBridgeRemoteToolSurface({
			scope: {
				publicAgentsRequest: true,
				projectId: "project-1",
				flowId: "flow-1",
				bookId: null,
				chapterId: null,
				nodeId: null,
				executionId: null,
			},
			tools,
		});
		expect(surface.tools.map((tool) => tool.name)).toContain("tapcanvas_flow_get");
		expect(surface.catalog).toContainEqual(expect.objectContaining({
			name: "tapcanvas_image_generate_to_canvas",
			capability: "paid_media_generation",
			requiredScope: ["project", "canvas"],
		}));
	});
});
