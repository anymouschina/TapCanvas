import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
	resolve: {
		alias: {
			"@tapcanvas/image-operation-protocol": path.resolve(
				__dirname,
				"../../packages/schemas/image-operation-protocol/index.ts",
			),
			"@tapcanvas/project-directory-protocol": path.resolve(
				__dirname,
				"./src/modules/project-directory/project-directory.contract.ts",
			),
			"@tapcanvas/codex-task-protocol": path.resolve(
				__dirname,
				"../../packages/schemas/codex-task-protocol/index.ts",
			),
			"@tapcanvas/chapter-canvas-intents": path.resolve(
				__dirname,
				"../../packages/schemas/chapter-canvas-intents/index.ts",
			),
			"@tapcanvas/canvas-edge-semantics": path.resolve(
				__dirname,
				"../../packages/schemas/canvas-edge-semantics/index.ts",
			),
			"@tapcanvas/canvas-plan-protocol": path.resolve(
				__dirname,
				"../../packages/schemas/canvas-plan-protocol/index.ts",
			),
			"@tapcanvas/storyboard-selection-protocol": path.resolve(
				__dirname,
				"../../packages/schemas/storyboard-selection-protocol/index.ts",
			),
			"@tapcanvas/storyboard-adventure-protocol": path.resolve(
				__dirname,
				"../../packages/schemas/storyboard-adventure-protocol/index.ts",
			),
			"@tapcanvas/character-bible-protocol": path.resolve(
				__dirname,
				"../../packages/schemas/character-bible-protocol/index.ts",
			),
			"@tapcanvas/script-structure-protocol": path.resolve(
				__dirname,
				"../../packages/schemas/script-structure-protocol/index.ts",
			),
			"@tapcanvas/shot-table-protocol": path.resolve(
				__dirname,
				"../../packages/schemas/shot-table-protocol/index.ts",
			),
			"@tapcanvas/video-orchestrator-protocol": path.resolve(
				__dirname,
				"../../packages/schemas/video-orchestrator-protocol/index.ts",
			),
			"@tapcanvas/workflow-kernel-protocol": path.resolve(
				__dirname,
				"../../packages/schemas/workflow-kernel-protocol/index.ts",
			),
			"@tapcanvas/flow-anchor-bindings": path.resolve(
				__dirname,
				"./src/modules/flow/flow.anchor-bindings.ts",
			),
		},
	},
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
