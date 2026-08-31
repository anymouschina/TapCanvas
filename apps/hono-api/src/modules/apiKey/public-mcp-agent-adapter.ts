import type {
	TaskRequestDto,
	TaskResultDto,
} from "../task/task.schemas";

export type McpAgentToolResult = {
	text: string;
	isError?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalString(
	record: Record<string, unknown>,
	key: string,
): string {
	const value = record[key];
	return typeof value === "string" ? value.trim() : "";
}

function requireHttpAssetUrl(raw: string): string {
	const value = raw.trim();
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`agents bridge 返回了非法资产 URL：${value || "(empty)"}`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`agents bridge 返回了不受支持的资产 URL 协议：${parsed.protocol}`);
	}
	return value;
}

/**
 * MCP 仅负责把工具参数适配成 canonical agents bridge chat 请求。
 * 意图识别、工具选择、completion gate 与 delivery verifier 均由 /chat 主链处理。
 */
export function buildMcpAgentTaskRequest(
	args: Record<string, unknown>,
): TaskRequestDto {
	const prompt = readOptionalString(args, "message");
	if (!prompt) {
		throw new Error("ask_tapcanvas.message 必须是非空字符串");
	}

	const canvasProjectId = readOptionalString(args, "canvasProjectId");
	const canvasFlowId = readOptionalString(args, "canvasFlowId");
	if (canvasFlowId && !canvasProjectId) {
		throw new Error(
			"ask_tapcanvas.canvasFlowId 必须与 canvasProjectId 一起提供",
		);
	}

	const extras: Record<string, unknown> = {
		diagnosticsLabel: "public_mcp.ask_tapcanvas",
	};
	if (canvasProjectId) {
		extras.canvasProjectId = canvasProjectId;
		extras.sessionKey = `project:${canvasProjectId}:flow:${canvasFlowId || "default"}`;
	}
	if (canvasFlowId) {
		extras.canvasFlowId = canvasFlowId;
	}

	return {
		kind: "chat",
		prompt,
		extras,
	};
}

/**
 * 把 canonical TaskResultDto 投影成 MCP text content。
 * 这里只呈现真实文本与真实 HTTP(S) 资产，不推断任务语义或伪造完成态。
 */
export function formatMcpAgentTaskResult(
	result: TaskResultDto,
): McpAgentToolResult {
	if (result.status !== "succeeded") {
		return {
			text: `agents bridge 任务未成功，状态：${result.status}`,
			isError: true,
		};
	}

	const raw = isRecord(result.raw) ? result.raw : null;
	const responseText =
		raw && typeof raw.text === "string" ? raw.text.trim() : "";
	const sections: string[] = responseText ? [responseText] : [];
	const seenAssets = new Set<string>();

	for (const asset of result.assets) {
		const url = requireHttpAssetUrl(asset.url);
		const dedupeKey = `${asset.type}:${url}`;
		if (seenAssets.has(dedupeKey)) continue;
		seenAssets.add(dedupeKey);
		const label =
			asset.type === "image"
				? "图片资产"
				: asset.type === "video"
					? "视频资产"
					: "音频资产";
		sections.push(`${label}：${url}`);
	}

	if (sections.length === 0) {
		throw new Error(
			"agents bridge 已返回成功状态，但没有可交付的文本或资产",
		);
	}

	return { text: sections.join("\n\n") };
}
