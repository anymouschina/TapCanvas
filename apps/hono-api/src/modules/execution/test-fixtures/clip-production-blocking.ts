import type { ClipProductionBlockingPlan } from "../../../../../../packages/schemas/clip-production-packet/index.mjs";

/** Structural Clip blocking facts for contract tests; no generated URL or provider input. */
export function clipProductionBlockingFixture(backgroundObjectId = "background-main"): ClipProductionBlockingPlan {
	return {
		title: "门口对峙",
		sceneName: "大厅",
		backgroundObjectId,
		landmarks: [{ kind: "area", at: [0.5, 0.5], label: "大厅中央" }],
		characters: [{ name: "张羽", at: [0.3, 0.5], facingTo: [0.7, 0.5], moveTo: null }],
		camera: { at: [0.5, 0.9], lookAt: [0.5, 0.5] },
		compositionContract: {
			narrativeTask: "交代双方的空间关系",
			focusKind: "relationship",
			focusTargetNames: ["张羽"],
			focalPoint: [0.5, 0.5],
			shotScale: "wide",
			environmentVisualWeight: "secondary",
			subjects: [{ name: "张羽", visualWeight: "primary", depthLayer: "midground",
				centerPlacement: "allowed", maxFrameHeightRatio: 0.6 }],
		},
		axisLine: { from: [0.3, 0.5], to: [0.7, 0.5] },
	};
}
