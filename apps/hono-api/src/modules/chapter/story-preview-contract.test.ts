import { describe, expect, it } from "vitest";
import {
	getStoryPreviewBoardTimeline,
	normalizeStoryPreviewContract,
	normalizeStoryPreviewNodeContract,
	storyPreviewContractsEqual,
} from "./story-preview-contract";

const contract = {
	schemaVersion: "story-preview-contract/v1",
	storyDurationSeconds: 60,
	previewScope: "user_window",
	previewWindow: { startSeconds: 0, endSeconds: 15 },
	frameIntervalSeconds: 1,
	requiredReferences: [
		{ nodeId: "ajiao", role: "identity", entityKind: "character", entityName: "阿乔" },
		{ nodeId: "youhun", role: "identity", entityKind: "character", entityName: "幽魂" },
		{ nodeId: "black-wind", role: "layout", entityKind: "scene", entityName: "黑风山战场" },
	],
} as const;

function buildNodeData() {
	return buildBoardNodeData(0);
}

function buildCell(cellIndex: number, startSeconds: number, endSeconds: number) {
	return {
		cellIndex,
		startSeconds,
		endSeconds,
		timeRange: `${String(startSeconds).padStart(2, "0")}-${String(endSeconds).padStart(2, "0")}s`,
		narrativeFunction: startSeconds === 0 ? "opening" : "escalation",
		frameDescription: `第 ${startSeconds} 秒结束时，阿乔在左前景举枪，幽魂在右后景抬棒，双方距离继续缩短`,
		visibleAction: `阿乔在 ${startSeconds}-${endSeconds} 秒向右推进，幽魂迎面压近`,
		stateBefore: `阿乔位于左侧 ${startSeconds} 米标记，枪口朝右；幽魂位于右侧`,
		stateAfter: `阿乔推进到左侧 ${endSeconds} 米标记，幽魂抬棒进入攻击距离`,
		causeFromPrevious: cellIndex === 1 ? "开场建立空间关系" : "上一秒的前进惯性与视线锁定延续",
		transitionToNext: "阿乔继续压低重心向右移动，幽魂棒头继续下沉",
		blocking: "阿乔左前景朝右，幽魂右后景朝左，石桥轴线保持不变",
		cameraState: "35mm 中全景平视，摄影机沿石桥轴线右移，焦点锁定双方间距",
		motionTransition: "阿乔左脚蹬地、重心前送、枪托贴肩，摄影机同步右移；幽魂右脚后撤半步抬棒",
		physicalFeedback: "双方尚未接触，阿乔脚下碎石向后滚动，幽魂棒头带起压迫风",
		environmentChange: "桥面尘土向右卷起，竹叶沿双方运动方向掠过画面",
		subjectRefIds: ["node:ajiao", "node:youhun", "node:black-wind"],
	};
}

function buildBoardNodeData(boardIndex: number) {
	const startSeconds = boardIndex * 9;
	const endSeconds = Math.min(15, startSeconds + 9);
	const storyPreviewCells = Array.from(
		{ length: endSeconds - startSeconds },
		(_, index) => buildCell(index + 1, startSeconds + index, startSeconds + index + 1),
	);
	return {
		previewSeriesId: "chapter-1-r75-preview",
		previewBoardIndex: boardIndex,
		previewBoardCount: 2,
		previewShotCount: storyPreviewCells.length,
		storyPreviewContract: contract,
		referenceManifest: contract.requiredReferences,
		storyPreviewCells,
	};
}

describe("story preview contract", () => {
	it("accepts a 60-second story with a 0-15 second preview window", () => {
		const normalized = normalizeStoryPreviewContract(contract);
		expect(normalized?.storyDurationSeconds).toBe(60);
		expect(normalized?.previewScope).toBe("user_window");
		expect(normalized?.previewWindow).toEqual({ startSeconds: 0, endSeconds: 15 });
		expect(normalized?.requiredReferences).toHaveLength(3);
	});

	it("requires an explicit preview scope instead of inferring legacy intent", () => {
		expect(normalizeStoryPreviewContract({
			...contract,
			previewScope: undefined,
		})).toBeNull();
	});

	it("defaults to a full-story preview when the user did not specify a window", () => {
		const normalized = normalizeStoryPreviewContract({
			...contract,
			previewScope: "full_story",
			previewWindow: undefined,
		});
		expect(normalized?.previewScope).toBe("full_story");
		expect(normalized?.previewWindow).toEqual({ startSeconds: 0, endSeconds: 60 });
		expect(normalized && getStoryPreviewBoardTimeline(normalized, 6)?.frames).toHaveLength(6);
	});

	it("requires user_window before a new partial preview can be persisted", () => {
		expect(normalizeStoryPreviewContract({
			...contract,
			previewScope: "full_story",
			previewWindow: { startSeconds: 0, endSeconds: 15 },
		})).toBeNull();
		expect(normalizeStoryPreviewContract({
			...contract,
			previewScope: "user_window",
			previewWindow: { startSeconds: 20, endSeconds: 30 },
		})?.previewWindow).toEqual({ startSeconds: 20, endSeconds: 30 });
	});

	it("rejects a preview window that silently exceeds the story duration", () => {
		expect(normalizeStoryPreviewContract({
			...contract,
			storyDurationSeconds: 15,
			previewWindow: { startSeconds: 0, endSeconds: 60 },
		})).toBeNull();
	});

	it("derives one-second cells and deterministic 3x3 pagination from the contract", () => {
		const firstBoard = buildBoardNodeData(0);
		const secondBoard = buildBoardNodeData(1);
		expect(normalizeStoryPreviewNodeContract(firstBoard)?.cells).toHaveLength(9);
		expect(normalizeStoryPreviewNodeContract(secondBoard)?.cells).toHaveLength(6);
		expect(normalizeStoryPreviewNodeContract({
			...firstBoard,
			previewBoardCount: 1,
			previewShotCount: 1,
			storyPreviewCells: [{ ...firstBoard.storyPreviewCells[0], endSeconds: 15 }],
		})).toBeNull();
	});

	it("plans a sixty-second one-second preview as seven boards with six cells on the last board", () => {
		const fullContract = normalizeStoryPreviewContract({
			...contract,
			previewWindow: { startSeconds: 0, endSeconds: 60 },
		});
		expect(fullContract).not.toBeNull();
		if (!fullContract) throw new Error("expected full preview contract");
		expect(getStoryPreviewBoardTimeline(fullContract, 0)).toMatchObject({
			totalFrameCount: 60,
			boardCount: 7,
			boardIndex: 0,
		});
		const lastBoard = getStoryPreviewBoardTimeline(fullContract, 6);
		expect(lastBoard?.frames).toHaveLength(6);
		expect(lastBoard?.frames[0]).toMatchObject({ startSeconds: 54, endSeconds: 55 });
		expect(lastBoard?.frames[5]).toMatchObject({ startSeconds: 59, endSeconds: 60 });
	});

	it("derives a non-one-second grid from the requested interval without a hidden default", () => {
		const twoSecondContract = normalizeStoryPreviewContract({
			...contract,
			previewWindow: { startSeconds: 0, endSeconds: 15 },
			frameIntervalSeconds: 2,
		});
		expect(twoSecondContract).not.toBeNull();
		if (!twoSecondContract) throw new Error("expected two-second preview contract");
		const timeline = getStoryPreviewBoardTimeline(twoSecondContract, 0);
		expect(timeline).toMatchObject({
			totalFrameCount: 8,
			boardCount: 1,
			boardIndex: 0,
		});
		expect(timeline?.frames).toHaveLength(8);
		expect(timeline?.frames[0]).toMatchObject({ startSeconds: 0, endSeconds: 2 });
		expect(timeline?.frames[7]).toMatchObject({ startSeconds: 14, endSeconds: 15 });
	});

	it("rejects cells that compress content outside the current preview window", () => {
		const data = buildNodeData();
		expect(normalizeStoryPreviewNodeContract(data)).not.toBeNull();
		expect(normalizeStoryPreviewNodeContract({
			...data,
			storyPreviewCells: [
				...data.storyPreviewCells.slice(0, 8),
				{ ...data.storyPreviewCells[8], startSeconds: 15, endSeconds: 60 },
			],
		})).toBeNull();
	});

	it("compares normalized contracts as the persisted source of truth", () => {
		const left = normalizeStoryPreviewContract(contract);
		const right = normalizeStoryPreviewContract(JSON.parse(JSON.stringify(contract)) as unknown);
		expect(left && right && storyPreviewContractsEqual(left, right)).toBe(true);
		const reordered = normalizeStoryPreviewContract({
			...contract,
			requiredReferences: [...contract.requiredReferences].reverse(),
		});
		expect(left && reordered && storyPreviewContractsEqual(left, reordered)).toBe(true);
	});

	it("requires contiguous preview cell indexes", () => {
		const data = buildNodeData();
		expect(normalizeStoryPreviewNodeContract({
			...data,
			storyPreviewCells: data.storyPreviewCells.map((cell, index) => (
				index === 1 ? { ...cell, cellIndex: 3 } : cell
			)),
		})).toBeNull();
	});

	it("requires complete authored cell fields and canonical reference IDs", () => {
		const data = buildNodeData();
		expect(normalizeStoryPreviewNodeContract({
			...data,
			storyPreviewCells: data.storyPreviewCells.map((cell, index) => (
				index === 0 ? { ...cell, narrativeFunction: "" } : cell
			)),
		})).toBeNull();
		expect(normalizeStoryPreviewNodeContract({
			...data,
			storyPreviewCells: data.storyPreviewCells.map((cell, index) => (
				index === 0 ? { ...cell, subjectRefIds: ["ajiao"] } : cell
			)),
		})).toBeNull();
		expect(normalizeStoryPreviewNodeContract({
			...data,
			storyPreviewCells: data.storyPreviewCells.map((cell, index) => (
				index === 0 ? { ...cell, subjectRefIds: ["node:ajiao", "node:ajiao"] } : cell
			)),
		})).toBeNull();
	});
});
