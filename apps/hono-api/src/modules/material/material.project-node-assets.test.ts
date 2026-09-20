import { describe, expect, it } from "vitest";
import { reconcileCanvasMembership } from "@tapcanvas/workflow-kernel-protocol";
import { createWorkflowCallerCanvasSnapshot } from "../execution/execution.project-context";
import { projectNodeAssetsFromCanvases } from "./material.project-node-assets";

describe("project node material projection", () => {
	it("keeps display names distinct from internal identities when projecting the asset catalog", () => {
		const assets = projectNodeAssetsFromCanvases([{ projectId: "project", ownerType: "chapter", ownerId: "chapter",
			flowId: "chapter:chapter", canvasRevision: 1, createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-20T00:00:00Z",
			data: JSON.stringify({ nodes: [{ id: "person", type: "taskNode", data: {
				kind: "image", imageUrl: "https://assets.test/person.png", referenceType: "character",
				displayName: "张羽", roleName: "zhangyu_boy_student", physicalIdentityKey: "zhangyu_boy_student",
				identityAnchors: ["作者确认的外观"], prohibitedDrift: ["作者指定的连续性约束"],
				characterProfileVersion: "character-card/v3", characterAssetRole: "identity_anchor",
				prompt: "原始作者提示词", workflowExecutionId: "source-run",
			} }], edges: [] }),
		}]);
		expect(assets[0]?.name).toBe("张羽");
		expect(assets[0]?.latestVersion?.data).toMatchObject({ displayName: "张羽", physicalIdentityKey: "zhangyu_boy_student",
			identityAnchors: ["作者确认的外观"], prohibitedDrift: ["作者指定的连续性约束"],
			characterProfileVersion: "character-card/v3", characterAssetRole: "identity_anchor", prompt: "原始作者提示词", workflowExecutionId: "source-run" });
	});

	it("excludes deleted settlement records from discovery and new caller snapshots without removing receipts", () => {
		const retained = { id: "old-output", type: "taskNode", data: {
			kind: "image", taskId: "paid-task", imageUrl: "https://assets.test/old.png",
		} };
		const visible = { id: "input", type: "taskNode", data: { kind: "image", imageUrl: "https://assets.test/input.png" } };
		const graph = reconcileCanvasMembership({ nodes: [visible, retained], edges: [] },
			{ nodes: [visible], edges: [] }, { deletedNodeIds: [retained.id] });
		const persisted = JSON.stringify(graph);
		const assets = projectNodeAssetsFromCanvases([{ projectId: "project-1", ownerType: "project", ownerId: "project-1",
			flowId: "flow-1", canvasRevision: 2, createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:01:00Z", data: persisted }]);
		expect(assets.map((asset) => asset.origin?.nodeId)).toEqual(["input"]);
		expect(createWorkflowCallerCanvasSnapshot(persisted).nodes).toEqual([visible]);
		expect(JSON.stringify(graph)).toBe(persisted);
		expect(persisted).toContain("paid-task");
	});
	it("projects every durable project/chapter node without creating a second material identity", () => {
		const result = projectNodeAssetsFromCanvases([
			{
				projectId: "project-1",
				ownerType: "chapter",
				ownerId: "chapter-2",
				flowId: "chapter:chapter-2",
				canvasRevision: 7,
				createdAt: "2026-08-08T10:00:00.000Z",
				updatedAt: "2026-08-08T11:00:00.000Z",
				data: JSON.stringify({
					nodes: [
						{
							id: "role-hcy",
							type: "taskNode",
							data: {
								roleName: "霍春燕",
								materialKind: "character",
								materialProjectId: "project-1",
								approvalStatus: "rejected",
								sourceMaterialAssetId: "source-role-card",
								sourceProjectId: "source-project",
								imageResults: [{ url: "https://assets.tapcanvas.test/hcy-v2.png" }],
							},
						},
						{
							id: "chapter-script",
							type: "textNode",
							data: { label: "第二章正文", text: "真实章节文本" },
						},
					],
				}),
			},
		]);

		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({
			id: "project-node:chapter:chapter-2:role-hcy",
			projectId: "project-1",
			scope: "project",
			kind: "character",
			name: "霍春燕",
			currentVersion: 8,
			origin: {
				type: "project_node",
				ownerType: "chapter",
				ownerId: "chapter-2",
				nodeId: "role-hcy",
			},
			latestVersion: {
				data: {
					source: "project_node",
					imageUrl: "https://assets.tapcanvas.test/hcy-v2.png",
					materialKind: "character",
					materialProjectId: "project-1",
					approvalStatus: "rejected",
					sourceMaterialAssetId: "source-role-card",
					sourceProjectId: "source-project",
				},
			},
		});
		expect(result[1]).toMatchObject({
			id: "project-node:chapter:chapter-2:chapter-script",
			kind: "text",
			name: "第二章正文",
		});
	});

	it("filters by structurally resolved material kind", () => {
		const result = projectNodeAssetsFromCanvases(
			[
				{
					projectId: "project-1",
					ownerType: "project",
					ownerId: "project-1",
					flowId: "flow-1",
					canvasRevision: 0,
					createdAt: "2026-08-08T10:00:00.000Z",
					updatedAt: "2026-08-08T10:00:00.000Z",
					data: {
						nodes: [
							{ id: "scene-1", data: { sceneName: "山巅" } },
							{ id: "prop-1", data: { propName: "佩剑" } },
						],
					},
				},
			],
			{ kind: "scene" },
		);

		expect(result.map((asset) => asset.id)).toEqual(["project-node:project:project-1:scene-1"]);
	});

	it("uses an explicit referenceType when a manually created card has no legacy name field", () => {
		const [asset] = projectNodeAssetsFromCanvases([
			{
				projectId: "project-1",
				ownerType: "chapter",
				ownerId: "chapter-1",
				flowId: "chapter:chapter-1",
				canvasRevision: 3,
				createdAt: "2026-08-08T10:00:00.000Z",
				updatedAt: "2026-08-08T11:00:00.000Z",
				data: {
					nodes: [
						{
							id: "manual-role-card",
							data: {
								referenceType: "character",
								label: "沈知夏",
								imageUrl: "https://assets.tapcanvas.test/shen-zhixia.png",
							},
						},
					],
				},
			},
		]);

		expect(asset).toMatchObject({
			id: "project-node:chapter:chapter-1:manual-role-card",
			kind: "character",
			name: "沈知夏",
		});
	});
});
