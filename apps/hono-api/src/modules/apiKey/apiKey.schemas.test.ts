import { describe, expect, it } from "vitest";
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
	AgentsChatRequestSchema,
	AgentsChatResponseSchema,
	PUBLIC_CHAT_CANVAS_NODE_ID_MAX_LENGTH,
} from "./apiKey.schemas";

describe("AgentsChatRequestSchema", () => {
	it("preserves the requested workflow execution variant as structured chat context", () => {
		const parsed = AgentsChatRequestSchema.parse({
			prompt: "完成当前章节的完整成片",
			chatContext: { requestedWorkflowExecutionVariant: "full_video" },
		});

		expect(parsed.chatContext?.requestedWorkflowExecutionVariant).toBe("full_video");
		expect(AgentsChatRequestSchema.safeParse({
			prompt: "完成当前章节的完整成片",
			chatContext: { requestedWorkflowExecutionVariant: "preview_video" },
		}).success).toBe(false);
	});

	it("accepts an explicit overwrite for the canonical project conversation", () => {
		const parsed = AgentsChatRequestSchema.parse({
			prompt: "从当前项目的唯一会话源重新开始",
			sessionKey: "project:p1:chapter:c1:lane:general:skill:default",
			resetSession: true,
		});

		expect(parsed.resetSession).toBe(true);
	});

	it("requires a session key and rejects overwrite on a queued control message", () => {
		expect(AgentsChatRequestSchema.safeParse({
			prompt: "重新开始",
			resetSession: true,
		}).success).toBe(false);
		expect(AgentsChatRequestSchema.safeParse({
			prompt: "不要把旧消息带进来",
			sessionKey: "project:p1:chapter:c1:lane:general:skill:default",
			resetSession: true,
			queueMode: "follow_up",
		}).success).toBe(false);
	});

	it("accepts explicit durable steering and follow-up queue modes", () => {
		for (const queueMode of ["steering", "follow_up"] as const) {
			const parsed = AgentsChatRequestSchema.parse({
				prompt: "把服装改成深青色，但继续当前任务",
				sessionKey: "project:p1:conversation:c1",
				queueMode,
			});
			expect(parsed.queueMode).toBe(queueMode);
		}
	});

	it("normalizes non-empty required Skill keys and rejects an empty declaration", () => {
		const parsed = AgentsChatRequestSchema.parse({
			prompt: "把视频事实整理成分镜表",
			requiredSkills: ["  tapcanvas-storyboard-expert  "],
		});

		expect(parsed.requiredSkills).toEqual(["tapcanvas-storyboard-expert"]);
		const emptyRequiredSkills = AgentsChatRequestSchema.safeParse({
			prompt: "把视频事实整理成分镜表",
			requiredSkills: [],
		});

		expect(emptyRequiredSkills.success).toBe(false);
	});

	it("preserves an explicit restricted Agents tool policy", () => {
		const parsed = AgentsChatRequestSchema.parse({
			prompt: "生成并独立审查文本分镜",
			executionToolPolicy: {
				mode: "restricted",
				allowedTools: ["read_file", "tapcanvas_shot_table_critic"],
			},
		});

		expect(parsed.executionToolPolicy).toEqual({
			mode: "restricted",
			allowedTools: ["read_file", "tapcanvas_shot_table_critic"],
		});
	});

	it("rejects duplicate tools in the restricted policy", () => {
		const parsed = AgentsChatRequestSchema.safeParse({
			prompt: "生成文本分镜",
			executionToolPolicy: {
				mode: "restricted",
				allowedTools: ["read_file", "read_file"],
			},
		});

		expect(parsed.success).toBe(false);
	});

	it("rejects queue mode without a durable session key", () => {
		const parsed = AgentsChatRequestSchema.safeParse({
			prompt: "继续",
			queueMode: "follow_up",
		});
		expect(parsed.success).toBe(false);
		if (!parsed.success) {
			expect(parsed.error.issues.some((issue) => issue.path.join(".") === "sessionKey")).toBe(true);
		}
	});

	it("accepts single_video chat context with selected reference metadata", () => {
		const parsed = AgentsChatRequestSchema.parse({
			prompt: "帮我快捷创作一个单视频",
			chatContext: {
				currentProjectName: "项目A",
				selectedNodeLabel: "已确认关键帧",
				selectedNodeKind: "image",
				selectedReference: {
					nodeId: "node-1",
					label: "已确认关键帧",
					kind: "image",
					anchorBindings: [
						{
							kind: "character",
							refId: "card-1",
							label: "方源",
							imageUrl: "https://example.com/role.png",
							referenceView: "three_view",
						},
					],
					imageUrl: "https://example.com/keyframe.png",
					sourceUrl: "/project-data/books/book-1/chapter-1.md",
					bookId: "book-1",
					chapterId: "chapter-1",
					shotNo: 7,
					productionLayer: "anchors",
					creationStage: "shot_anchor_lock",
					approvalStatus: "approved",
				},
			},
		});

		expect(parsed.chatContext?.selectedReference?.shotNo).toBe(7);
		expect(parsed.chatContext?.selectedReference?.anchorBindings?.[0]).toMatchObject({
			kind: "character",
			refId: "card-1",
			label: "方源",
		});
		expect(parsed.chatContext?.selectedReference?.productionLayer).toBe("anchors");
		expect(parsed.chatContext?.selectedReference?.creationStage).toBe("shot_anchor_lock");
		expect(parsed.chatContext?.selectedReference?.approvalStatus).toBe("approved");
	});

	it("accepts compositional workflow node identities consistently across chat anchors", () => {
		const workflowNodeId = [
			"video-workflow-852f5557-904a-4efb-920f-fbcaabe3cfe1",
			"video-submit::item::clip-0",
			"execution::6f5e7c12-b6e8-43df-b703-9600ee35f1cd",
			"output::video",
		].join(":");
		expect(workflowNodeId.length).toBeGreaterThan(120);

		const parsed = AgentsChatRequestSchema.parse({
			prompt: "读取当前工作流节点事实",
			canvasNodeId: workflowNodeId,
			chatContext: {
				selectedReference: { nodeId: workflowNodeId },
			},
		});

		expect(parsed.canvasNodeId).toBe(workflowNodeId);
		expect(parsed.chatContext?.selectedReference?.nodeId).toBe(workflowNodeId);
	});

	it("accepts a compact versioned canvas reference without copying node facts", () => {
		const workflowNodeId = `video-workflow:${"w".repeat(170)}`;
		const parsed = AgentsChatRequestSchema.parse({
			prompt: "基于当前画布继续创作",
			canvasNodeId: workflowNodeId,
			chatContext: {
				chapterCanvasReference: {
					version: 1,
					scopeKey: "flow:flow-1",
					nodeCount: 1,
					edgeCount: 0,
					selectedNodeId: workflowNodeId,
				},
			},
		});

		expect(parsed.chatContext?.chapterCanvasReference).toEqual({
			version: 1,
			scopeKey: "flow:flow-1",
			nodeCount: 1,
			edgeCount: 0,
			selectedNodeId: workflowNodeId,
		});
	});

	it("rejects canvas node identities beyond the shared protocol bound", () => {
		const oversizedNodeId = "n".repeat(PUBLIC_CHAT_CANVAS_NODE_ID_MAX_LENGTH + 1);
		expect(AgentsChatRequestSchema.safeParse({
			prompt: "读取节点",
			canvasNodeId: oversizedNodeId,
		}).success).toBe(false);
		expect(AgentsChatRequestSchema.safeParse({
			prompt: "读取节点",
			chatContext: { selectedReference: { nodeId: oversizedNodeId } },
		}).success).toBe(false);
		expect(AgentsChatRequestSchema.safeParse({
			prompt: "读取节点",
			chatContext: {
				chapterCanvasReference: {
					version: 1,
					scopeKey: "flow:flow-1",
					nodeCount: 1,
					edgeCount: 0,
					selectedNodeId: oversizedNodeId,
				},
			},
		}).success).toBe(false);
	});

	it("accepts thin generation contract payload", () => {
		const parsed = AgentsChatRequestSchema.parse({
			prompt: "继续基于当前关键帧生成",
			generationContract: {
				version: "v1",
				lockedAnchors: ["角色外观", "机位构图"],
				editableVariable: "环境光线",
				forbiddenChanges: ["禁止换脸", "禁止改机位"],
				approvedKeyframeId: "keyframe-7",
			},
		});

		expect(parsed.generationContract).toEqual({
			version: "v1",
			lockedAnchors: ["角色外观", "机位构图"],
			editableVariable: "环境光线",
			forbiddenChanges: ["禁止换脸", "禁止改机位"],
			approvedKeyframeId: "keyframe-7",
		});
	});

	it("accepts named asset inputs for stable @ references", () => {
		const parsed = AgentsChatRequestSchema.parse({
			prompt: "基于角色卡继续出图",
			assetInputs: [
				{
					assetId: "asset-1",
					assetRefId: "hero_ref",
					url: "https://example.com/hero.png",
					role: "character",
					note: "保持主角造型",
					name: "女主角色卡",
				},
			],
		});

		expect(parsed.assetInputs?.[0]).toMatchObject({
			assetId: "asset-1",
			assetRefId: "hero_ref",
			url: "https://example.com/hero.png",
			role: "character",
			note: "保持主角造型",
			name: "女主角色卡",
		});
	});

	it("accepts workflow-projected node identities in asset inputs", () => {
		const projectedNodeId = [
			"video-workflow-852f5557-904a-4efb-920f-fbcaabe3cfe1",
			"asset-image-generate::item::asset-plan%3Acharacter%3Aspirit-zhangsan",
			"family::workflow-execution-d07b72e455dc70bd5435f2e58ef2cd18d764a3cb",
			"output::image",
		].join(":");

		const parsed = AgentsChatRequestSchema.parse({
			prompt: "从当前章节启动一键成片",
			canvasNodeId: projectedNodeId,
			chatContext: {
				selectedReference: { nodeId: projectedNodeId },
				chapterCanvasReference: {
					version: 1,
					scopeKey: "chapter:book-demo-ch1",
					nodeCount: 1,
					edgeCount: 0,
					selectedNodeId: projectedNodeId,
				},
			},
			assetInputs: [{ nodeId: projectedNodeId, assetId: "asset-1", role: "reference" }],
		});

		expect(projectedNodeId.length).toBeGreaterThan(160);
		expect(parsed.assetInputs?.[0]?.nodeId).toBe(projectedNodeId);
	});

	it("rejects unsupported generation contract keys", () => {
		expect(() =>
			AgentsChatRequestSchema.parse({
				prompt: "继续生成",
				generationContract: {
					version: "v1",
					lockedAnchors: ["角色外观"],
					editableVariable: null,
					forbiddenChanges: [],
					approvedKeyframeId: null,
					motionBudget: "fast",
				},
			}),
		).toThrow();
	});

	it("rejects caller-forged continuation intent contracts", () => {
		const parsed = AgentsChatRequestSchema.safeParse({
			prompt: "继续",
			userIntentContract: { version: 1, contractHash: "forged" },
			userIntentContractLocked: true,
		});

		expect(parsed.success).toBe(false);
	});

	it("remains serializable as OpenAPI while forbidden continuation fields stay impossible", () => {
		const app = new OpenAPIHono();
		app.openapi(
			createRoute({
				method: "post",
				path: "/agents/chat",
				request: {
					body: {
						required: true,
						content: { "application/json": { schema: AgentsChatRequestSchema } },
					},
				},
				responses: { 200: { description: "ok" } },
			}),
			(c) => c.json({ ok: true }),
		);

		const document = app.getOpenAPI31Document({
			openapi: "3.1.0",
			info: { title: "schema test", version: "1" },
		});
		const requestBody = document.paths?.["/agents/chat"]?.post?.requestBody;
		expect(requestBody).toMatchObject({
			content: {
				"application/json": {
					schema: {
						properties: {
							userIntentContract: { type: "null", not: {} },
							userIntentContractLocked: { type: "null", not: {} },
						},
					},
				},
			},
		});
	});
});

describe("AgentsChatResponseSchema", () => {
	it("accepts the canonical agents-cli verification envelope", () => {
		const parsed = AgentsChatResponseSchema.parse({
			id: "response-1",
			vendor: "agents-cli",
			text: "异步任务已受理，等待真实资产证据。",
			trace: {
				logicalTaskState: {
					version: 1,
					logicalTaskId: "response-1",
					status: "waiting_external",
					reasonCode: "managed_async_submission",
					physicalRunStatus: "handed_off",
					deliveryStatus: "pending",
					taskNodeId: "root",
					taskRevision: 1,
					updatedAt: "2026-08-10T01:02:03.000Z",
					continuationTicket: null,
				},
				deliveryVerification: {
					version: 2,
					contractHash: "sha256:video-contract",
					status: "unsatisfied",
					criteria: [
						{
							requirementId: "video-materialized",
							status: "unresolved",
							evidenceIds: ["artifact:video-run-1"],
							reason: "The provider accepted the run but no materialized URL exists yet.",
						},
					],
					verifiedAt: "2026-08-10T01:02:03.000Z",
				},
			},
		});

		expect(parsed.trace?.deliveryVerification?.status).toBe("unsatisfied");
	});
});

describe("AgentsChatRequestSchema Phase 2 intent 分支", () => {
    it("无 intent 时保留原有 chat 行为（仅 prompt 可过）", () => {
        const r = AgentsChatRequestSchema.safeParse({ prompt: "hi" });
        expect(r.success).toBe(true);
    });

    it("intent='extract_roles' 必须带 chapterContext", () => {
        const r = AgentsChatRequestSchema.safeParse({
            intent: "extract_roles",
            prompt: "hi",
        });
        expect(r.success).toBe(false);
    });

    it("intent='extract_roles' + 完整 chapterContext 解析成功", () => {
        const r = AgentsChatRequestSchema.safeParse({
            intent: "extract_roles",
            chapterIntentSourceNodeId: "chapter-seed-c1",
            chapterContext: {
                projectId: "p1",
                bookId: null,
                chapterId: "c1",
                flowSnapshot: { nodes: [], edges: [] },
            },
            prompt: "ignored",
        });
        expect(r.success).toBe(true);
    });

    it("未知 intent 被拒", () => {
        const r = AgentsChatRequestSchema.safeParse({
            intent: "not_in_whitelist",
            chapterIntentSourceNodeId: "s",
            chapterContext: {
                projectId: "p",
                bookId: null,
                chapterId: "c",
                flowSnapshot: { nodes: [], edges: [] },
            },
        });
        expect(r.success).toBe(false);
    });
});
