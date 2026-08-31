import { createHash } from "node:crypto";
import {
	canonicalizeSbaStoryBasis,
	parseSbaMomentBoardData,
	type SbaMomentBoardData,
} from "@tapcanvas/storyboard-adventure-protocol";
import { AppError } from "../../middleware/error";

type NodeLike = Record<string, unknown> & { id?: unknown; data?: unknown };
type EdgeLike = Record<string, unknown> & { source?: unknown; target?: unknown };

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function readId(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function isSbaContractData(value: unknown): boolean {
	return asRecord(value)?.sbaContractVersion === 1;
}

export function computeSbaBasisFingerprint(data: SbaMomentBoardData): string {
	return createHash("sha256")
		.update(canonicalizeSbaStoryBasis(data.sbaStoryBasis))
		.digest("hex");
}

function invalidContract(nodeId: string, reason: string, details?: Record<string, unknown>): never {
	throw new AppError(`故事板冒险节点合同不合法: ${reason}`, {
		status: 400,
		code: "invalid_storyboard_adventure_contract",
		details: {
			nodeId,
			reason,
			...details,
			requiredAction:
				"在同一条 tapcanvas_flow_patch 修复链中补齐结构字段与真实节点引用；不要删除已生成节点或资产。",
		},
	});
}

export function finalizeStoryboardAdventureContracts(options: {
	nodeById: Map<string, NodeLike>;
	edges: readonly unknown[];
	touchedNodeIds: ReadonlySet<string>;
}): void {
	const selectionEventOwners = new Map<string, Set<string>>();
	for (const [candidateNodeId, candidateNode] of options.nodeById) {
		const candidateData = asRecord(candidateNode.data);
		if (candidateData?.sbaContractVersion !== 1 || !Array.isArray(candidateData.sbaSelectionEvents)) continue;
		for (const rawEvent of candidateData.sbaSelectionEvents) {
			const eventId = readId(asRecord(rawEvent)?.eventId);
			if (!eventId) continue;
			const owners = selectionEventOwners.get(eventId) ?? new Set<string>();
			owners.add(candidateNodeId);
			selectionEventOwners.set(eventId, owners);
		}
	}

	for (const nodeId of options.touchedNodeIds) {
		const node = options.nodeById.get(nodeId);
		if (!node || !isSbaContractData(node.data)) continue;
		const parsed = parseSbaMomentBoardData(node.data);
		if (!parsed) invalidContract(nodeId, "字段缺失、类型错误或枚举值非法");

		const fingerprint = computeSbaBasisFingerprint(parsed);
		if (parsed.basisFingerprint && parsed.basisFingerprint !== fingerprint) {
			invalidContract(nodeId, "basisFingerprint 与当前 sbaStoryBasis 不一致", {
				expectedFingerprint: fingerprint,
				actualFingerprint: parsed.basisFingerprint,
			});
		}

		const parentId = parsed.sbaParentNodeId;
		if (parentId === null) {
			if (parsed.sbaDepth !== 1) invalidContract(nodeId, "根候选的 sbaDepth 必须为 1");
		} else {
			const parent = options.nodeById.get(parentId);
			const parentData = asRecord(parent?.data);
			if (!parent || parentData?.sbaRole !== "moment-board") {
				invalidContract(nodeId, "sbaParentNodeId 未指向真实 moment-board 节点", { parentId });
			}
			const parentDepth = parentData && typeof parentData.sbaDepth === "number"
				? parentData.sbaDepth
				: null;
			if (parentDepth === null || parsed.sbaDepth !== parentDepth + 1) {
				invalidContract(nodeId, "sbaDepth 与真实父节点层级不一致", {
					parentId,
					parentDepth,
					childDepth: parsed.sbaDepth,
				});
			}
			const hasParentEdge = options.edges.some((raw) => {
				const edge = asRecord(raw) as EdgeLike | null;
				return readId(edge?.source) === parentId && readId(edge?.target) === nodeId;
			});
			if (!hasParentEdge) {
				invalidContract(nodeId, "缺少真实父节点到当前分支的画布连线", { parentId });
			}
		}

		const events = parsed.sbaSelectionEvents ?? [];
		const eventIds = new Set<string>();
		for (const event of events) {
			if (eventIds.has(event.eventId)) invalidContract(nodeId, "sbaSelectionEvents.eventId 重复");
			eventIds.add(event.eventId);
			const owners = selectionEventOwners.get(event.eventId);
			if (owners && (owners.size !== 1 || !owners.has(nodeId))) {
				invalidContract(nodeId, "selectionEventId 已被其他分支占用", {
					eventId: event.eventId,
					ownerNodeIds: [...owners],
				});
			}
			if (
				event.branchNodeId !== nodeId
				|| event.parentNodeId !== parentId
				|| event.sbaPath !== parsed.sbaPath
				|| event.basisFingerprint !== fingerprint
			) {
				invalidContract(nodeId, "选择事件与真实分支身份不一致", { eventId: event.eventId });
			}
		}
		if (parsed.sbaSelectionStatus === "selected" && events.length === 0) {
			invalidContract(nodeId, "selected 分支缺少追加式选择事件");
		}
		if (parsed.sbaSelectionStatus === "candidate" && events.length > 0) {
			invalidContract(nodeId, "candidate 分支不能携带已发生的选择事件");
		}

		options.nodeById.set(nodeId, {
			...node,
			data: {
				...(asRecord(node.data) ?? {}),
				basisFingerprint: fingerprint,
			},
		});
	}
}
