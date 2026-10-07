import { describe, expect, it } from "vitest";

import type { ClipProductionPacket } from "../../../../../packages/schemas/clip-production-packet/index.mjs";
import { planClipStagingDiagrams } from "./execution.clip-staging-diagram";

const stage = {
	sceneId: "scene-1", setting: "酒楼雅间",
	landmarks: [{ kind: "door", label: "房门", at: [0.95, 0.5] }, { kind: "furniture", label: "茶桌", at: [0.4, 0.5] }],
	marks: [{ mark: "主位", where: "茶桌东侧", at: [0.5, 0.5] }],
	characters: [
		{ name: "顾观棋", mark: "主位", posture: "sit", at: [0.5, 0.5], endMark: "门内", endPosture: "stand", moveTo: [0.85, 0.5], enters: false, exits: false },
		{ name: "林嫣儿", mark: "门内", posture: "stand", at: [0.9, 0.45], endMark: null, endPosture: null, moveTo: null, enters: true, exits: false },
	],
};
const packet = (clipIndex: number, blockingPlan: unknown) => ({ clipId: `clip-${clipIndex}`, clipIndex, durationSeconds: 30, blockingPlan }) as unknown as ClipProductionPacket;

describe("Clip staging diagrams", () => {
	it("draws one diagram per scene from the frozen staging plan", () => {
		const plans = planClipStagingDiagrams("family-1", [packet(0, { protocol: "tapcanvas.clip-staging/v2", stages: [stage] })]);
		expect(plans).toHaveLength(1);
		expect(plans[0]!.label).toBe("站位图｜Clip 1");
		expect(plans[0]!.nodeId).toMatch(/^staging-diagram-[0-9a-f]{24}$/);
		expect(plans[0]!.diagram.landmarks).toEqual([
			{ kind: "door", at: [0.95, 0.5], orient: "v", lengthN: 0.12, swing: "in", label: "房门" },
			{ kind: "area", at: [0.4, 0.5], label: "茶桌" },
		]);
		expect(plans[0]!.diagram.characters).toEqual([
			{ name: "顾观棋（坐）", at: [0.5, 0.5], moveTo: [0.85, 0.5], color: "#1f6feb" },
			{ name: "林嫣儿（站·入场）", at: [0.9, 0.45], color: "#1f6feb" },
		]);
		// The identity is stable for the same family, Clip and scene.
		expect(planClipStagingDiagrams("family-1", [packet(0, { protocol: "tapcanvas.clip-staging/v2", stages: [stage] })])[0]!.nodeId).toBe(plans[0]!.nodeId);
	});

	it("separates people sharing a mark and labels crowding one line", () => {
		const crowded = { ...stage,
			landmarks: [{ kind: "door", label: "房门", at: [0.1, 0.5] }, { kind: "area", label: "入口空地", at: [0.2, 0.5] },
				{ kind: "furniture", label: "八仙红木大茶桌与茶具", at: [0.4, 0.5] }, { kind: "window", label: "临街窗", at: [0.95, 0.5] }],
			characters: [
				{ ...stage.characters[1]!, name: "林嫣儿", at: [0.2, 0.5] },
				{ ...stage.characters[1]!, name: "沈清秋", at: [0.2, 0.5] },
			] };
		const [plan] = planClipStagingDiagrams("family-1", [packet(0, { protocol: "tapcanvas.clip-staging/v2", stages: [crowded] })]);
		expect(plan!.diagram.characters.map((character) => character.at)).toEqual([[0.2, 0.44], [0.2, 0.56]]);
		expect(plan!.diagram.landmarks).toEqual([
			{ kind: "door", at: [0.1, 0.5], orient: "v", lengthN: 0.12, swing: "in", label: "房门" },
			{ kind: "area", at: [0.2, 0.41], label: "入口空地" },
			{ kind: "area", at: [0.4, 0.59], label: "八仙红木大茶桌与…" },
			{ kind: "area", at: [0.86, 0.5], label: "临街窗" },
		]);
	});

	it("draws one diagram for consecutive Clips whose staging does not change", () => {
		const seated = { protocol: "tapcanvas.clip-staging/v2", stages: [stage] };
		const moved = { protocol: "tapcanvas.clip-staging/v2", stages: [{ ...stage, characters: [stage.characters[0]!] }] };
		const plans = planClipStagingDiagrams("family-1", [packet(2, seated), packet(0, seated), packet(1, seated), packet(3, moved), packet(5, moved)]);
		expect(plans.map((plan) => [plan.label, plan.clipIds])).toEqual([
			["站位图｜Clip 1–3", ["clip-0", "clip-1", "clip-2"]],
			["站位图｜Clip 4", ["clip-3"]],
			// A gap in the Clips starts a new diagram even when the staging matches.
			["站位图｜Clip 6", ["clip-5"]],
		]);
		expect(plans[0]!.diagram.title).toBe("站位图｜Clip 1–3（90s）");
		// The merged diagram keeps the identity of its first Clip, so a single-Clip run draws the same node.
		expect(plans[0]!.nodeId).toBe(planClipStagingDiagrams("family-1", [packet(0, seated)])[0]!.nodeId);
	});

	it("skips packets whose blocking was authored without a staging ledger", () => {
		expect(planClipStagingDiagrams("family-1", [packet(0, { title: "旧式站位", characters: [] })])).toEqual([]);
	});

	it("needs no diagram when a packet omits staging", () => {
		expect(planClipStagingDiagrams("family-1", [{ clipId: "clip-0", clipIndex: 0, durationSeconds: 30 } as ClipProductionPacket])).toEqual([]);
	});
});
