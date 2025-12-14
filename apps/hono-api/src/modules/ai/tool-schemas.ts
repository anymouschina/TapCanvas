import { z } from "zod";

// Worker / 后端共享的画布工具 contracts。
// 仅描述工具名称、用途和输入参数结构，实际执行在前端（clientToolExecution）。
export const canvasToolSchemas = {
		createNode: {
			description:
				"创建一个新的画布节点（主要为 taskNode）。仅支持 image / textToImage / composeVideo（或 video）；其他类型已禁用。必要时会自动补全默认标签与位置。",
			inputSchema: z
				.object({
					type: z
						.string()
						.min(1)
						.describe(
							"节点类型/逻辑 kind。仅支持：image、textToImage、composeVideo（或 video）。其他类型已禁用。",
						),
					label: z
						.string()
						.min(1)
						.describe("可选：节点标签名称；留空时将自动生成。")
						.optional(),
					config: z
						.record(z.any())
						.describe(
							"可选：节点配置参数，将合并到默认数据中。写入 prompt/negativePrompt/keywords 时必须是自然英文。",
						)
						.optional(),
					remixFromNodeId: z
						.string()
						.describe(
							"可选：指定一个已成功生成的视频节点 ID（kind=composeVideo|video），自动建立 Remix 关联并继承部分 prompt。",
						)
						.optional(),
					position: z
						.object({
							x: z.number(),
							y: z.number(),
						})
						.describe("可选：节点初始位置坐标。")
						.optional(),
				})
				.strict(),
		},

		updateNode: {
			description:
				"更新现有节点的标签与配置（增量合并）。用于写入 prompt、模型选择、时长、图片参考等参数。未提供的字段会保持原样。",
			inputSchema: z
				.object({
					nodeId: z.string().min(1).describe("要更新的节点 ID。"),
					label: z
						.string()
						.describe("可选：新的节点标签；未提供时保持原值。")
						.optional(),
					config: z
						.record(z.any())
						.describe(
							"可选：新的节点配置，将合并到现有配置中。写入 prompt/negativePrompt/keywords 时必须为自然英文。",
						)
						.optional(),
				})
				.strict(),
		},

	deleteNode: {
		description: "删除指定节点及其相关连接。",
		inputSchema: z
			.object({
				nodeId: z.string().min(1).describe("要删除的节点 ID。"),
			})
			.strict(),
	},

		connectNodes: {
			description:
				"在两个节点之间创建连接边。默认会按节点 kind 推断合适的端口；需要指定时可传 sourceHandle/targetHandle（如 out-image / in-video）。",
			inputSchema: z
				.object({
					sourceNodeId: z.string().min(1).describe("源节点 ID。"),
					targetNodeId: z.string().min(1).describe("目标节点 ID。"),
					sourceHandle: z
						.string()
						.describe("可选：源节点输出端口名称。")
						.optional(),
					targetHandle: z
						.string()
						.describe("可选：目标节点输入端口名称。")
						.optional(),
				})
				.strict(),
		},

	disconnectNodes: {
		description: "根据边 ID 删除两个节点之间的连接。",
		inputSchema: z
			.object({
				edgeId: z.string().min(1).describe("要删除的连接边 ID。"),
			})
			.strict(),
	},

	getNodes: {
		description: "获取当前画布中的所有节点信息，用于观察全局状态。",
		inputSchema: z.object({}).strict(),
	},

	banana_ai_search: {
		description:
			"使用 Cloudflare AI Search 检索 Nano Banana 提示词案例，返回最相关的片段，用于参考生成/编辑提示词。",
		inputSchema: z
			.object({
				query: z.string().min(2, "query 过短"),
				topK: z.number().int().min(1).max(8).default(4).optional(),
			})
			.strict(),
	},

	findNodes: {
			description:
				"根据标签或 kind 查找节点，支持模糊匹配 label。type 参数指节点 kind（如 image、textToImage、composeVideo）。其他类型已禁用。",
			inputSchema: z
				.object({
					label: z
						.string()
						.describe("可选：节点标签（支持模糊匹配）。")
						.optional(),
					type: z
						.string()
						.describe(
							"可选：节点 kind，例如 image / textToImage / composeVideo / video。其他类型已禁用。",
						)
						.optional(),
				})
				.strict(),
		},

		autoLayout: {
			description:
				"对画布节点进行自动布局排列。grid/hierarchical 会整理全画布；horizontal 会对当前选中节点水平排布。",
			inputSchema: z
				.object({
					layoutType: z
						.enum(["grid", "horizontal", "hierarchical"])
						.describe("布局类型：grid(网格)、horizontal(水平)、hierarchical(层级)。"),
				})
				.strict(),
		},

		runNode: {
			description:
				"执行指定节点，避免不必要的全局运行，可结合 getNodes/findNodes 精准选取目标。会返回该节点最新的图片/视频预览信息（如 imageUrl/videoUrl）。",
			inputSchema: z
				.object({
					nodeId: z.string().min(1).describe("要执行的节点 ID。"),
				})
				.strict(),
		},

		runDag: {
			description:
				"按依赖顺序执行整个工作流（DAG），仅在用户明确要求“跑完整个流程”等场景下使用。",
			inputSchema: z
				.object({
					concurrency: z
						.number()
						.int()
						.min(1)
						.max(8)
						.describe("可选：并发执行度，默认 1。")
						.optional(),
				})
				.strict(),
		},

		formatAll: {
			description:
				"全选当前画布中的节点并应用 DAG 布局，用于在长对话后快速整理画布结构。",
			inputSchema: z.object({}).strict(),
		},

		canvas_node_operation: {
			description:
				"高级节点批量操作入口：支持 create/update/delete/duplicate 一组节点。适用于需要一次性处理多个节点的场景，避免重复调用单节点工具。",
			inputSchema: z
				.object({
					action: z
						.enum(["create", "update", "delete", "duplicate"])
						.describe("要执行的节点操作类型。"),
					nodeType: z
						.string()
						.describe("可选：create 时的新节点类型/kind。")
						.optional(),
					position: z
						.object({
							x: z.number(),
							y: z.number(),
						})
						.describe("可选：新建节点的初始位置。")
						.optional(),
					config: z
						.record(z.any())
						.describe("可选：批量写入的节点配置数据（增量合并）。")
						.optional(),
					nodeIds: z
						.array(z.string())
						.describe("可选：要操作的目标节点 ID 列表。")
						.optional(),
				operations: z
					.array(z.record(z.any()))
					.describe("可选：更细粒度的批量节点操作描述。")
					.optional(),
			})
			.strict(),
	},

		canvas_connection_operation: {
			description:
				"高级连线操作入口：connect/disconnect/reconnect 多个节点对，支持一次性处理多条边。edgeId 不可用时，可用 sourceNodeId/targetNodeId 定位连接。",
			inputSchema: z
				.object({
					action: z
						.enum(["connect", "disconnect", "reconnect"])
						.describe("要执行的连接操作类型。")
						.optional(),
				sourceNodeId: z
					.string()
					.describe("可选：单条连接的源节点 ID。")
					.optional(),
				targetNodeId: z
					.string()
					.describe("可选：单条连接的目标节点 ID。")
					.optional(),
				edgeId: z
					.string()
					.describe("可选：要断开/调整的边 ID。")
					.optional(),
				connections: z
					.array(
						z.object({
							sourceNodeId: z.string().min(1),
							targetNodeId: z.string().min(1),
						}),
					)
					.describe("可选：批量连接/断开时的节点对列表。")
					.optional(),
			})
			.strict(),
	},

	} satisfies Record<
		string,
		{
			description: string;
			inputSchema: ReturnType<typeof z.object>;
		}
	>;
