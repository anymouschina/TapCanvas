import { isDeepStrictEqual } from "node:util";

import {
	isClipProductionStagingPlan,
	type ClipProductionPacket,
	type ClipProductionStagingPlan,
} from "../../../../../packages/schemas/clip-production-packet/index.mjs";
import { REFERENCE_ONLY_EXECUTION_ROLE } from "@tapcanvas/canvas-edge-semantics";
import type { WorkerEnv } from "../../types";
import { sha256Hex } from "../asset/book-content-hash";
import { storeBlockingDiagram, type BlockingDiagram, type BlockingLandmark } from "../task/agents-tool-bridge.blocking-diagram";
import { freshReadFlowRow, persistFlowPatch } from "../task/video-orchestrator.flow-io";
import { buildWorkflowVideoEffectV2Identity } from "../task/workflow-video-effect-claim";
import { createWorkflowInternalContext } from "./execution.video-runner";
import { stagingCharacterDiagramFacts } from "./execution.chapter-staging";

type JsonRecord = Record<string, unknown>;
type StagingStage = ClipProductionStagingPlan["stages"][number];

export type WorkflowClipStagingDiagramRequest = Readonly<{
	executionId: string;
	executionFamilyId: string;
	runtimeNodeId: string;
	ownerId: string;
	flowId: string;
	chapterId?: string | null;
	packets: readonly ClipProductionPacket[];
}>;

export type ClipStagingDiagramPlan = Readonly<{
	nodeId: string;
	clipId: string;
	clipIndex: number;
	/** Every Clip this diagram stands for: consecutive Clips whose staging does not change share one diagram. */
	clipIds: readonly string[];
	label: string;
	stage: StagingStage;
	diagram: BlockingDiagram;
}>;

function record(value: unknown): value is JsonRecord {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function landmark(value: StagingStage["landmarks"][number]): BlockingLandmark {
	const at: [number, number] = [value.at[0], value.at[1]];
	if (value.kind !== "door") return { kind: "area", at, label: short(value.label) };
	// A door on a side wall runs along the depth axis.
	return { kind: "door", at, orient: at[0] < 0.15 || at[0] > 0.85 ? "v" : "h", lengthN: 0.12, swing: "in", label: short(value.label) };
}

const clamp = (value: number) => Math.round(Math.min(0.94, Math.max(0.06, value)) * 100) / 100;
const LABEL_OFFSETS = [0, -0.09, 0.09, -0.18, 0.18] as const;
const LABEL_MAX = 8;

/**
 * Staging marks are points, so people sharing a mark and labels along one wall
 * would be drawn on top of each other. People on the same point fan out across
 * the depth axis; text labels crowding one line step above and below it.
 */
function fanOut<T extends { at: [number, number] }>(items: readonly T[], step: number): T[] {
	const groups = new Map<string, number[]>();
	items.forEach((item, index) => {
		const key = `${item.at[0].toFixed(2)}:${item.at[1].toFixed(2)}`;
		groups.set(key, [...(groups.get(key) ?? []), index]);
	});
	return items.map((item, index) => {
		const group = groups.get(`${item.at[0].toFixed(2)}:${item.at[1].toFixed(2)}`)!;
		if (group.length === 1) return item;
		return { ...item, at: [item.at[0], clamp(item.at[1] + (group.indexOf(index) - (group.length - 1) / 2) * step)] as [number, number] };
	});
}

function stagger(landmarks: readonly BlockingLandmark[]): BlockingLandmark[] {
	// Doors keep their place but still crowd the labels next to them.
	const points = landmarks.flatMap((item, index) => item.kind === "wall" ? [] : [{ index, at: item.at, fixed: item.kind === "door" }])
		.sort((left, right) => left.at[0] - right.at[0]);
	const shifted = new Map<number, number>();
	let run = 0;
	points.forEach((point, order) => {
		const previous = points[order - 1];
		run = previous && point.at[0] - previous.at[0] < 0.24 && Math.abs(point.at[1] - previous.at[1]) < 0.05 ? run + 1 : 0;
		if (!point.fixed) shifted.set(point.index, clamp(point.at[1] + LABEL_OFFSETS[run % LABEL_OFFSETS.length]!));
	});
	// A centred label near a side wall would run off the sheet.
	return landmarks.map((item, index) => item.kind === "area"
		? { ...item, at: [Math.min(0.86, Math.max(0.14, item.at[0])), shifted.get(index)!] as [number, number] } : item);
}

const short = (label: string) => label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX)}…` : label;

/**
 * One top-down diagram per scene a Clip plays, drawn from the frozen chapter
 * staging: the floor plan's landmarks, where everyone starts and where they
 * move. The staging ledger is the only source; nothing is inferred from prose.
 *
 * A seated conversation keeps everyone on their marks for several Clips, and one
 * diagram per Clip drew the same picture five times in a row (ch1 Clips 16–20).
 * Consecutive Clips whose staging is identical share one diagram, labelled with
 * the range and linked to each of them.
 */
export function planClipStagingDiagrams(executionFamilyId: string, packets: readonly ClipProductionPacket[]): readonly ClipStagingDiagramPlan[] {
	type Group = { packet: ClipProductionPacket; stage: StagingStage; suffix: string; clipIds: string[]; lastClipIndex: number; durationSeconds: number };
	const groups: Group[] = [];
	for (const packet of [...packets].sort((left, right) => left.clipIndex - right.clipIndex)) {
		if (!isClipProductionStagingPlan(packet.blockingPlan)) continue;
		const { stages } = packet.blockingPlan;
		stages.forEach((stage, stageIndex) => {
			const previous = groups.at(-1);
			if (stages.length === 1 && previous && previous.suffix === "" && previous.lastClipIndex === packet.clipIndex - 1 && isDeepStrictEqual(previous.stage, stage)) {
				previous.clipIds.push(packet.clipId);
				previous.lastClipIndex = packet.clipIndex;
				previous.durationSeconds += packet.durationSeconds;
				return;
			}
			groups.push({ packet, stage, suffix: stages.length > 1 ? `·场景 ${stageIndex + 1}` : "", clipIds: [packet.clipId],
				lastClipIndex: packet.clipIndex, durationSeconds: packet.durationSeconds });
		});
	}
	return groups.map(({ packet, stage, suffix, clipIds, lastClipIndex, durationSeconds }): ClipStagingDiagramPlan => {
		const range = lastClipIndex > packet.clipIndex ? `Clip ${packet.clipIndex + 1}–${lastClipIndex + 1}` : `Clip ${packet.clipIndex + 1}`;
		const label = `站位图｜${range}${suffix}`;
		return {
			nodeId: `staging-diagram-${sha256Hex(`${executionFamilyId}:${packet.clipId}:${stage.sceneId}`).slice(0, 24)}`,
			clipId: packet.clipId,
			clipIndex: packet.clipIndex,
			clipIds,
			label,
			stage,
			diagram: {
				title: `${label}（${durationSeconds}s）`,
				durationSeconds,
				bg: "#f6f4ef",
				width: 800,
				height: 600,
				landmarks: stagger(stage.landmarks.map(landmark)),
				characters: fanOut(stage.characters.map((character) => ({
					...stagingCharacterDiagramFacts(character, stage.transitions),
					color: "#1f6feb",
				})), 0.12),
			},
		};
	});
}

function flowEdges(rowData: string): JsonRecord[] {
	const parsed = JSON.parse(rowData) as unknown;
	return record(parsed) && Array.isArray(parsed.edges) ? parsed.edges.filter(record) : [];
}

function flowNodes(rowData: string): JsonRecord[] {
	const parsed = JSON.parse(rowData) as unknown;
	return record(parsed) && Array.isArray(parsed.nodes) ? parsed.nodes.filter(record) : [];
}

/** Draw every Clip's staging diagram onto the canvas once; a diagram already persisted for the same plan is kept. */
export async function materializeWorkflowClipStagingDiagrams(
	env: WorkerEnv,
	request: WorkflowClipStagingDiagramRequest,
): Promise<Readonly<{ nodeIds: readonly string[]; createdNodeIds: readonly string[] }>> {
	const plans = planClipStagingDiagrams(request.executionFamilyId, request.packets);
	if (plans.length === 0) return { nodeIds: [], createdNodeIds: [] };
	const context = createWorkflowInternalContext(env, request);
	const readRow = () => freshReadFlowRow({ c: context, flowId: request.flowId, requestUserId: request.ownerId,
		devBypass: false, ...(request.chapterId ? { chapterId: request.chapterId } : {}) });
	const row = await readRow();
	const existing = new Map(flowNodes(row.data).map((node) => [String(node.id), node]));
	const createNodes: JsonRecord[] = [];
	const existingEdgeIds = new Set(flowEdges(row.data).map((edge) => String(edge.id)));
	const createEdges: JsonRecord[] = [];
	for (const plan of plans) {
		const blockingPlan = { protocol: "tapcanvas.clip-staging/v2", stages: [plan.stage] };
		// The diagram belongs to its Clips; reference_only keeps it out of their provider references.
		for (const clipId of plan.clipIds) {
			const clipNodeId = buildWorkflowVideoEffectV2Identity({ executionFamilyId: request.executionFamilyId, clipId }).canvasNodeId;
			const edgeId = `e-staging-${plan.nodeId}-${clipNodeId}`;
			if (existing.has(clipNodeId) && !existingEdgeIds.has(edgeId)) {
				createEdges.push({ id: edgeId, source: plan.nodeId, target: clipNodeId, sourceHandle: "out-image", targetHandle: "in-any",
					label: "站位", data: { executionRole: REFERENCE_ONLY_EXECUTION_ROLE, relationKind: "staging_diagram", label: "站位" } });
			}
		}
		const persisted = existing.get(plan.nodeId);
		if (persisted) {
			if (!record(persisted.data) || !isDeepStrictEqual(persisted.data.blockingPlan, blockingPlan)) {
				throw new Error(`Staging diagram ${plan.nodeId} conflicts with the frozen staging plan`);
			}
			continue;
		}
		const { imageUrl } = await storeBlockingDiagram({ c: context, requestUserId: request.ownerId, plan: plan.diagram,
			contentHash: sha256Hex(JSON.stringify(plan.diagram)).slice(0, 32) });
		createNodes.push({
			id: plan.nodeId, type: "taskNode", position: { x: 960, y: 120 + plan.clipIndex * 360 },
			data: {
				kind: "image", label: plan.label, status: "success", imageUrl, imageResults: [{ url: imageUrl }],
				referenceType: "blocking", productionLayer: "blocking_diagram",
				clipId: plan.clipId, clipIndex: plan.clipIndex, clipIds: plan.clipIds, sceneName: plan.stage.setting, blockingPlan,
				workflowObjectId: `staging:${plan.clipId}:${plan.stage.sceneId}`,
				workflowExecutionId: request.executionId, workflowExecutionFamilyId: request.executionFamilyId,
				workflowRuntimeNodeId: request.runtimeNodeId,
			},
		});
	}
	if (createNodes.length > 0 || createEdges.length > 0) {
		await persistFlowPatch({ c: context, row, flowId: request.flowId, requestUserId: request.ownerId, devBypass: false,
			...(request.chapterId ? { chapterId: request.chapterId } : {}),
			patch: { createNodes, createEdges }, affectedNodeIds: createNodes.map((node) => String(node.id)) });
		const saved = new Set(flowNodes((await readRow()).data).map((node) => String(node.id)));
		for (const node of createNodes) if (!saved.has(String(node.id))) throw new Error(`Staging diagram ${String(node.id)} was not persisted`);
	}
	return { nodeIds: plans.map((plan) => plan.nodeId), createdNodeIds: createNodes.map((node) => String(node.id)) };
}
