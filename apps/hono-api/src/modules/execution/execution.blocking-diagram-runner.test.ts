import { beforeEach, describe, expect, it, vi } from "vitest";

import { createWorkflowCollection } from "@tapcanvas/workflow-kernel-protocol";
import type { WorkerEnv } from "../../types";

const mocks = vi.hoisted(() => ({
	renderBlockingDiagramToCanvas: vi.fn(),
	freshReadFlowRow: vi.fn(),
	persistFlowPatch: vi.fn(),
}));

vi.mock("../task/agents-tool-bridge.blocking-diagram", () => ({
	renderBlockingDiagramToCanvas: mocks.renderBlockingDiagramToCanvas,
}));

vi.mock("../task/video-orchestrator.flow-io", () => ({
	freshReadFlowRow: mocks.freshReadFlowRow,
	persistFlowPatch: mocks.persistFlowPatch,
}));

import { materializeWorkflowBlockingDiagrams } from "./execution.blocking-diagram-runner";

function flowRow(graph: Readonly<{ nodes: readonly unknown[]; edges: readonly unknown[] }>) {
	return {
		id: "flow-1",
		name: "chapter-canvas",
		data: JSON.stringify(graph),
		owner_id: "owner-1",
		project_id: "project-1",
		created_at: "2026-09-14T00:00:00.000Z",
		updated_at: "2026-09-14T00:00:00.000Z",
		canvas_revision: 1,
	};
}

describe("workflow blocking diagram materializer", () => {
	beforeEach(() => {
		mocks.renderBlockingDiagramToCanvas.mockReset();
		mocks.freshReadFlowRow.mockReset();
		mocks.persistFlowPatch.mockReset();
	});

	it.each([false, true])("renders, persists and reuses the exact plan (background=%s)", async (withBackground) => {
		let graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } = { nodes: [], edges: [] };
		mocks.freshReadFlowRow.mockImplementation(async () => flowRow(graph));
		mocks.persistFlowPatch.mockImplementation(async (input: {
			patch: { createNodes?: Array<Record<string, unknown>> };
		}) => {
			graph = { ...graph, nodes: [...graph.nodes, ...(input.patch.createNodes ?? [])] };
		});
		mocks.renderBlockingDiagramToCanvas.mockResolvedValue({
			ok: true,
			imageUrl: "https://assets.example/blocking.png",
			key: "gen/images/blocking.png",
			characterCount: 1,
			bytes: 2048,
			compositionContract: { narrativeTask: "对峙", focusKind: "relationship", focusTargetNames: ["甲", "乙"], focalPoint: [0.5, 0.5], shotScale: "wide", environmentVisualWeight: "secondary", subjects: [] },
			compositionContractHash: "hash-1",
		});
		const blockingPlan = {
			title: "Clip 1 站位",
			sceneName: "大殿",
			durationSeconds: 5,
			characters: [{ name: "甲", at: [0.25, 0.5] }],
			landmarks: [{ kind: "door", label: "正门", at: [0.5, 0.1] }],
			camera: { at: [0.5, 0.9], facingTo: [0.5, 0.5] },
			compositionContract: {},
		};
		const backgroundPlan = { assetId: "scene-floor", displayName: "Scene floor", prompt: "Authored top-down space", negativePrompt: "No people", referenceAssetBindings: [] };
		const authoredPlan = { ...blockingPlan, ...(withBackground ? { backgroundPlan } : {}) };
		const request = {
			executionId: "execution-1",
			executionFamilyId: "family-1",
			runtimeNodeId: "blocking-diagrams",
			ownerId: "owner-1",
			flowId: "flow-1",
			projectId: "project-1",
			chapterId: "chapter-1",
			beatSheetArtifact: { text: JSON.stringify({ beats: [{ clipId: "clip-1", blockingPlan: authoredPlan }] }) },
			...(withBackground ? { backgroundBindings: createWorkflowCollection({ collectionId: "floors", producerNodeId: "image", producerPortId: "asset-bindings", itemIds: ["scene-floor"], values: [{ nodeId: "floor-node", imageUrl: "https://assets.example/floor.png" }] }) } : {}),
		};

		const first = await materializeWorkflowBlockingDiagrams({} as WorkerEnv, request);
		const second = await materializeWorkflowBlockingDiagrams({} as WorkerEnv, request);

		expect(mocks.renderBlockingDiagramToCanvas).toHaveBeenCalledTimes(1);
		if (withBackground) {
			expect(mocks.renderBlockingDiagramToCanvas).toHaveBeenCalledWith(expect.objectContaining({ bodyArgs: { ...authoredPlan, backgroundImageUrl: "https://assets.example/floor.png" } }));
			expect(graph.nodes[0]?.data).toMatchObject({ backgroundNodeId: "floor-node", blockingPlan: authoredPlan });
		}
		expect(mocks.persistFlowPatch).toHaveBeenCalledTimes(1);
		expect(first.bindings[0]).toMatchObject({ clipId: "clip-1", clipIndex: 0, imageUrl: "https://assets.example/blocking.png", reused: false });
		expect(second.bindings[0]).toMatchObject({ nodeId: first.bindings[0]?.nodeId, reused: true });
		const firstBeatSheet = JSON.parse(String(first.beatSheetArtifact.text)) as { beats: Array<Record<string, unknown>> };
		expect(firstBeatSheet.beats[0]).toMatchObject({ blockingFrameNodeId: first.bindings[0]?.nodeId, spatialBlocking: true });
		expect(graph.nodes[0]?.data).toMatchObject({ kind: "image", productionLayer: "blocking_diagram", imageUrl: "https://assets.example/blocking.png" });
	});
});

it('bounds independent renders and preserves clip order despite out-of-order completions', async () => {
  let graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } = { nodes: [], edges: [] };
  mocks.freshReadFlowRow.mockImplementation(async () => flowRow(graph));
  mocks.persistFlowPatch.mockImplementation(async (input: { patch: { createNodes: Array<Record<string, unknown>> } }) => {
    graph.nodes.push(...input.patch.createNodes);
  });
  let active = 0, peak = 0;
  mocks.renderBlockingDiagramToCanvas.mockImplementation(async (input: { bodyArgs: { index: number } }) => {
    active += 1; peak = Math.max(peak, active);
    const index = input.bodyArgs.index;
    await new Promise(resolve => setTimeout(resolve, (4 - index % 4) * 5));
    active -= 1;
    return { imageUrl: `https://assets.example/${index}.png`, compositionContract: {}, compositionContractHash: `hash-${index}` };
  });
  const result = await materializeWorkflowBlockingDiagrams({} as WorkerEnv, {
    executionId: 'parallel', executionFamilyId: 'family', runtimeNodeId: 'diagrams', ownerId: 'owner-1', flowId: 'flow-1', projectId: 'project-1',
    beatSheetArtifact: { beats: Array.from({ length: 6 }, (_, index) => ({ clipId: `clip-${index}`, blockingPlan: { index } })) },
  });
  expect(peak).toBe(4);
  expect(result.bindings.map(item => item.clipIndex)).toEqual([0,1,2,3,4,5]);
  expect(graph.nodes).toHaveLength(6);
});

it('settles and persists other accepted images when a parallel render fails', async () => {
  let graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } = { nodes: [], edges: [] };
  mocks.freshReadFlowRow.mockImplementation(async () => flowRow(graph));
  mocks.persistFlowPatch.mockImplementation(async (input: { patch: { createNodes: Array<Record<string, unknown>> } }) => { graph.nodes.push(...input.patch.createNodes); });
  mocks.renderBlockingDiagramToCanvas.mockImplementation(async (input: { bodyArgs: { index: number } }) => {
    if (input.bodyArgs.index === 1) throw new Error('upload failed');
    await new Promise(resolve => setTimeout(resolve, 10));
    return { imageUrl: `https://assets.example/${input.bodyArgs.index}.png`, compositionContract: {}, compositionContractHash: 'hash' };
  });
  await expect(materializeWorkflowBlockingDiagrams({} as WorkerEnv, {
    executionId: 'parallel-failed', executionFamilyId: 'family', runtimeNodeId: 'diagrams', ownerId: 'owner-1', flowId: 'flow-1', projectId: 'project-1',
    beatSheetArtifact: { beats: Array.from({ length: 3 }, (_, index) => ({ clipId: `clip-${index}`, blockingPlan: { index } })) },
  })).rejects.toThrow('upload failed');
  expect(graph.nodes).toHaveLength(2);
});
