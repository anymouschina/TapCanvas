import { z } from "zod";

// Worker / 后端共享的画布工具 contracts。
// 仅描述工具名称、用途和输入参数结构，实际执行在前端（clientToolExecution）。
export const canvasToolSchemas = {
	createNode: {
		description:
			"创建一个新的 AI 工作流节点（图像/视频/音频/字幕等），必要时会自动补全默认标签与位置。",
		inputSchema: z
			.object({
				type: z
					.string()
					.describe(
						"节点类型，例如 image / composeVideo / video / audio / subtitle / character。",
					),
				label: z
					.string()
					.min(1)
					.describe("可选：节点标签名称；留空时将自动生成。")
					.optional(),
				config: z
					.record(z.any())
					.describe("节点配置参数，根据 type 不同而不同。")
					.optional(),
				remixFromNodeId: z
					.string()
					.describe(
						"可选：指定一个已有视频/分镜节点 ID，自动设置 Remix 关联并继承部分 Prompt。",
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
		description: "更新现有节点的标签和配置。",
		inputSchema: z
			.object({
				nodeId: z.string().min(1).describe("要更新的节点 ID。"),
				label: z
					.string()
					.describe("可选：新的节点标签；未提供时保持原值。")
					.optional(),
				config: z
					.record(z.any())
					.describe("可选：新的节点配置，将合并到现有配置中。")
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
		description: "在两个节点之间创建连接边。",
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

	findNodes: {
		description:
			"根据标签或类型查找节点，支持模糊匹配标签，用于定位或批量操作目标节点。",
		inputSchema: z
			.object({
				label: z
					.string()
					.describe("可选：节点标签（支持模糊匹配）。")
					.optional(),
				type: z
					.string()
					.describe(
						"可选：节点类型，例如 image / composeVideo / video / audio / subtitle。",
					)
					.optional(),
			})
			.strict(),
	},

	autoLayout: {
		description: "对当前选中节点进行自动布局排列。",
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
			"执行指定节点，避免不必要的全局运行，可结合 getNodes/findNodes 精准选取目标。",
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

	"canvas.node.operation": {
		description:
			"高级节点批量操作入口：支持创建/更新/删除/复制一组节点，通常由助手根据上下文自行选择具体操作。",
		inputSchema: z
			.object({
				action: z
					.enum(["create", "update", "delete", "duplicate"])
					.describe("要执行的节点操作类型。"),
				nodeType: z
					.string()
					.describe("可选：新建节点时使用的类型。")
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
					.describe("可选：节点配置数据，取决于节点类型。")
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

	"canvas.connection.operation": {
		description:
			"高级连线操作入口：连接、断开或重新连接多个节点对，支持一次性处理多条边。",
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

	"canvas.layout.apply": {
		description:
			"应用指定的布局算法到当前画布，通常结合智能规划结果使用，例如“按时间线从左到右排布镜头”。",
		inputSchema: z
			.object({
				layoutType: z
					.string()
					.describe(
						"布局算法名称，例如 grid / horizontal / hierarchical / timeline 等。",
					)
					.optional(),
				focusNodeId: z
					.string()
					.describe("可选：布局后希望视图聚焦的节点 ID。")
					.optional(),
			})
			.strict(),
	},

	"canvas.optimization.analyze": {
		description:
			"分析当前画布结构与资源占用情况，给出可能的优化建议（如合并节点、清理冗余、整理布局等）。",
		inputSchema: z
			.object({
				analysisType: z
					.string()
					.describe("可选：分析类型，例如 layout / performance / redundancy 等。")
					.optional(),
				scope: z
					.string()
					.describe("可选：分析范围，例如 all / selection / viewport。")
					.optional(),
			})
			.strict(),
	},

	"canvas.view.navigate": {
		description:
			"根据节点 ID 或关键字在画布上移动视图与选中节点，用于长画布上的快速导航。",
		inputSchema: z
			.object({
				nodeId: z
					.string()
					.describe("可选：要聚焦的单个节点 ID。")
					.optional(),
				nodeIds: z
					.array(z.string())
					.describe("可选：希望一起聚焦的一组节点 ID。")
					.optional(),
				query: z
					.string()
					.describe("可选：根据标签/内容搜索节点的关键字。")
					.optional(),
			})
			.strict(),
	},

	"project.operation": {
		description:
			"与当前画布/项目相关的高层操作，例如保存当前场景、切换项目、管理资产绑定等。",
		inputSchema: z
			.object({
				action: z.string().describe("要执行的项目操作类型，例如 save / rename 等。"),
				projectId: z
					.string()
					.describe("可选：目标项目 ID，缺省时使用当前项目。")
					.optional(),
				payload: z
					.record(z.any())
					.describe("可选：与具体项目操作相关的参数。")
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

