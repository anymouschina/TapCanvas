import { describe, expect, it } from "vitest";
import type { TaskResultDto } from "../task/task.schemas";
import {
	buildMcpAgentTaskRequest,
	formatMcpAgentTaskResult,
} from "./public-mcp-agent-adapter";

function taskResult(
	overrides: Partial<TaskResultDto> = {},
): TaskResultDto {
	return {
		id: "task-1",
		kind: "chat",
		status: "succeeded",
		assets: [],
		raw: { text: "小T 回复" },
		...overrides,
	};
}

describe("buildMcpAgentTaskRequest", () => {
	it("把文本映射到 canonical chat task", () => {
		expect(buildMcpAgentTaskRequest({ message: " 你好 " })).toEqual({
			kind: "chat",
			prompt: "你好",
			extras: {
				diagnosticsLabel: "public_mcp.ask_tapcanvas",
			},
		});
	});

	it("把画布作用域映射到同一 project/flow session", () => {
		expect(
			buildMcpAgentTaskRequest({
				message: "画一只猫",
				canvasProjectId: " project-1 ",
				canvasFlowId: " flow-1 ",
			}),
		).toEqual({
			kind: "chat",
			prompt: "画一只猫",
			extras: {
				diagnosticsLabel: "public_mcp.ask_tapcanvas",
				canvasProjectId: "project-1",
				canvasFlowId: "flow-1",
				sessionKey: "project:project-1:flow:flow-1",
			},
		});
	});

	it("只有 project 时使用明确的 default flow session", () => {
		const request = buildMcpAgentTaskRequest({
			message: "继续",
			canvasProjectId: "project-1",
		});
		expect(request.extras?.sessionKey).toBe(
			"project:project-1:flow:default",
		);
	});

	it("拒绝空指令", () => {
		expect(() => buildMcpAgentTaskRequest({ message: "   " })).toThrow(
			"message 必须是非空字符串",
		);
	});

	it("拒绝没有 project 的孤立 flow", () => {
		expect(() =>
			buildMcpAgentTaskRequest({
				message: "继续",
				canvasFlowId: "flow-1",
			}),
		).toThrow("必须与 canvasProjectId 一起提供");
	});
});

describe("formatMcpAgentTaskResult", () => {
	it("呈现真实文本与去重后的真实资产", () => {
		const result = formatMcpAgentTaskResult(
			taskResult({
				assets: [
					{ type: "image", url: "https://oss.test/a.png" },
					{ type: "image", url: "https://oss.test/a.png" },
					{ type: "video", url: "https://oss.test/a.mp4" },
				],
			}),
		);
		expect(result).toEqual({
			text:
				"小T 回复\n\n" +
				"图片资产：https://oss.test/a.png\n\n" +
				"视频资产：https://oss.test/a.mp4",
		});
	});

	it("失败状态显式标记 MCP tool error", () => {
		expect(
			formatMcpAgentTaskResult(
				taskResult({ status: "failed", raw: { text: "不可交付" } }),
			),
		).toEqual({
			text: "agents bridge 任务未成功，状态：failed",
			isError: true,
		});
	});

	it("成功信封没有文本或资产时显式失败", () => {
		expect(() =>
			formatMcpAgentTaskResult(taskResult({ raw: {} })),
		).toThrow("没有可交付的文本或资产");
	});

	it("拒绝非 HTTP(S) 资产 URL", () => {
		expect(() =>
			formatMcpAgentTaskResult(
				taskResult({
					assets: [
						{ type: "image", url: "data:image/png;base64,abc" },
					],
				}),
			),
		).toThrow("不受支持的资产 URL 协议");
	});
});
