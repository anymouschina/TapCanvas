import { randomUUID } from "node:crypto";
import { streamSSE } from "hono/streaming";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
	buildAgentsChatResponseFromTaskResult,
	persistAgentsChatConversationTurn,
} from "../apiKey/public-agents-chat-response";
import {
	AgentsChatRequestSchema,
	type AgentsChatRequestDto,
} from "../apiKey/apiKey.schemas";
import type { TaskRequestDto, TaskResultDto } from "./task.schemas";
import { runAgentsBridgeChatTask } from "./task.agents-bridge";

type ResponsesInputPromptResolution = {
	prompt: string;
	referenceImages: string[];
};

type StreamWritable = {
	writeSSE: (input: { event: string; data: string }) => Promise<void>;
};

type StreamErrorPayload = {
	message: string;
	code?: string;
	details?: unknown;
};

const FORWARDED_STREAM_EVENTS = new Set([
	"content",
	"tool",
	"todo_list",
	"thread.started",
	"turn.started",
	"item.started",
	"item.updated",
	"item.completed",
	"turn.completed",
]);

function normalizeHttpUrl(raw: unknown): string {
	return typeof raw === "string" && /^https?:\/\//i.test(raw.trim()) ? raw.trim() : "";
}

function mergeUniqueUrls(primary: string[], secondary: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of [...primary, ...secondary]) {
		const url = normalizeHttpUrl(item);
		if (!url || seen.has(url)) continue;
		seen.add(url);
		out.push(url);
	}
	return out;
}

function normalizeResponsesInputToPromptAndImages(inputValue: unknown): ResponsesInputPromptResolution {
	if (typeof inputValue === "string") {
		return { prompt: inputValue.trim(), referenceImages: [] };
	}
	if (!Array.isArray(inputValue)) {
		return { prompt: "", referenceImages: [] };
	}

	const textChunks: string[] = [];
	const latestUserTexts: string[] = [];
	const imageCandidates: string[] = [];
	const toolOutputs: string[] = [];

	for (const item of inputValue) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const entry = item as Record<string, unknown>;
		const entryType =
			typeof entry.type === "string" ? entry.type.trim().toLowerCase() : "";
		if (entryType === "function_call_output" || entryType === "tool_result") {
			const output =
				typeof entry.output === "string"
					? entry.output.trim()
					: typeof entry.content === "string"
						? entry.content.trim()
						: "";
			if (output) toolOutputs.push(output);
			continue;
		}

		const role =
			typeof entry.role === "string" ? entry.role.trim().toLowerCase() : "";
		const content = entry.content;
		if (typeof content === "string") {
			const text = content.trim();
			if (!text) continue;
			textChunks.push(text);
			if (role === "user") latestUserTexts.push(text);
			continue;
		}
		if (!Array.isArray(content)) continue;
		for (const part of content) {
			if (!part || typeof part !== "object" || Array.isArray(part)) continue;
			const piece = part as Record<string, unknown>;
			const pieceType =
				typeof piece.type === "string" ? piece.type.trim().toLowerCase() : "";
			if (pieceType === "input_text" || pieceType === "text") {
				const text = typeof piece.text === "string" ? piece.text.trim() : "";
				if (!text) continue;
				textChunks.push(text);
				if (role === "user") latestUserTexts.push(text);
				continue;
			}
			if (pieceType === "input_image" || pieceType === "image_url") {
				const imageUrl =
					typeof piece.image_url === "string"
						? piece.image_url.trim()
						: piece.image_url &&
							  typeof piece.image_url === "object" &&
							  !Array.isArray(piece.image_url) &&
							  typeof (piece.image_url as Record<string, unknown>).url === "string"
							? String((piece.image_url as Record<string, unknown>).url).trim()
							: "";
				const normalizedImageUrl = normalizeHttpUrl(imageUrl);
				if (normalizedImageUrl) imageCandidates.push(normalizedImageUrl);
			}
		}
	}

	const latestUserText = latestUserTexts.length
		? latestUserTexts[latestUserTexts.length - 1] || ""
		: "";
	const basePrompt =
		latestUserText || (textChunks.length ? textChunks[textChunks.length - 1] || "" : "");
	const toolContext =
		toolOutputs.length > 0
			? `\n\n[Tool Outputs]\n${toolOutputs.map((text, index) => `#${index + 1}\n${text}`).join("\n\n")}`
			: "";
	return {
		prompt: `${basePrompt}${toolContext}`.trim(),
		referenceImages: mergeUniqueUrls(imageCandidates, []),
	};
}

function buildTaskRequest(input: AgentsChatRequestDto): TaskRequestDto {
	const resolvedFromInput = normalizeResponsesInputToPromptAndImages(input.input);
	const prompt =
		typeof input.prompt === "string" && input.prompt.trim()
			? input.prompt.trim()
			: resolvedFromInput.prompt;
	if (!prompt) {
		throw new AppError("prompt 不能为空", {
			status: 400,
			code: "invalid_request",
		});
	}

	const referenceImages = mergeUniqueUrls(
		Array.isArray(input.referenceImages) ? input.referenceImages : [],
		resolvedFromInput.referenceImages,
	);
	const assetInputs = Array.isArray(input.assetInputs)
		? input.assetInputs.map((item) => ({ ...item }))
		: [];
	const extras: Record<string, unknown> = {
		...(typeof input.systemPrompt === "string" && input.systemPrompt.trim()
			? { systemPrompt: input.systemPrompt.trim() }
			: typeof input.instructions === "string" && input.instructions.trim()
				? { systemPrompt: input.instructions.trim() }
				: {}),
		...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
		...(typeof input.modelAlias === "string" && input.modelAlias.trim()
			? { modelAlias: input.modelAlias.trim() }
			: {}),
		...(typeof input.modelKey === "string" && input.modelKey.trim()
			? { modelKey: input.modelKey.trim() }
			: {}),
		...(typeof input.model === "string" && input.model.trim()
			? { modelAlias: input.model.trim() }
			: {}),
		...(typeof input.response_format !== "undefined"
			? { response_format: input.response_format }
			: {}),
		...(typeof input.mode === "string" ? { mode: input.mode } : {}),
		...(typeof input.sessionKey === "string" && input.sessionKey.trim()
			? { sessionKey: input.sessionKey.trim() }
			: {}),
		...(typeof input.canvasProjectId === "string" && input.canvasProjectId.trim()
			? { canvasProjectId: input.canvasProjectId.trim() }
			: {}),
		...(typeof input.canvasFlowId === "string" && input.canvasFlowId.trim()
			? { canvasFlowId: input.canvasFlowId.trim() }
			: {}),
		...(typeof input.canvasNodeId === "string" && input.canvasNodeId.trim()
			? { canvasNodeId: input.canvasNodeId.trim() }
			: {}),
		...(input.chatContext ? { chatContext: input.chatContext } : {}),
		...(typeof input.bookId === "string" && input.bookId.trim()
			? { bookId: input.bookId.trim() }
			: {}),
		...(typeof input.chapterId === "string" && input.chapterId.trim()
			? { chapterId: input.chapterId.trim() }
			: {}),
		...(typeof input.planOnly === "boolean" ? { planOnly: input.planOnly } : {}),
		...(typeof input.forceAssetGeneration === "boolean"
			? { forceAssetGeneration: input.forceAssetGeneration }
			: {}),
		...(referenceImages.length ? { referenceImages } : {}),
		...(assetInputs.length ? { assetInputs } : {}),
		...(input.generationContract ? { generationContract: input.generationContract } : {}),
		...(typeof input.debug === "boolean" ? { debug: input.debug } : {}),
	};
	return {
		kind: "chat",
		prompt,
		extras,
	};
}

function toErrorMessage(error: unknown): string {
	if (error instanceof AppError) return error.message;
	if (error instanceof Error && error.message.trim()) return error.message;
	return "agents chat failed";
}

function toStreamErrorPayload(error: unknown): StreamErrorPayload {
	if (error instanceof AppError) {
		return {
			message: error.message,
			code: error.code,
			...(typeof error.details !== "undefined" ? { details: error.details } : {}),
		};
	}
	if (error instanceof Error && error.message.trim()) {
		return { message: error.message.trim() };
	}
	return { message: toErrorMessage(error) };
}

async function writeStreamError(
	stream: StreamWritable,
	payload: StreamErrorPayload,
	reason: string,
): Promise<void> {
	await stream.writeSSE({
		event: "error",
		data: JSON.stringify(payload),
	});
	await stream.writeSSE({
		event: "done",
		data: JSON.stringify({ reason }),
	});
}

async function writeFinalResult(stream: StreamWritable, result: TaskResultDto): Promise<void> {
	const response = buildAgentsChatResponseFromTaskResult(result);
	await stream.writeSSE({
		event: "result",
		data: JSON.stringify({ response }),
	});
	await stream.writeSSE({
		event: "done",
		data: JSON.stringify({ reason: "finished" }),
	});
}

export async function handlePublicAgentsChatRoute(c: AppContext): Promise<Response> {
	const userId = String(c.get("userId") || "").trim();
	if (!userId) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: "unauthorized",
		});
	}

	const rawBody = await c.req.json().catch(() => ({}));
	const input = AgentsChatRequestSchema.parse(rawBody);
	const taskRequest = buildTaskRequest(input);

	if (input.stream === true) {
		return streamSSE(c, async (stream) => {
			const requestId = String(c.get("requestId") || "").trim() || randomUUID();
			const sessionId =
				typeof input.sessionKey === "string" && input.sessionKey.trim()
					? input.sessionKey.trim()
					: "";
			await stream.writeSSE({
				event: "initial",
				data: JSON.stringify({
					requestId,
					messageId: `msg_${randomUUID()}`,
				}),
			});
			if (sessionId) {
				await stream.writeSSE({
					event: "session",
					data: JSON.stringify({ sessionId }),
				});
			}
			await stream.writeSSE({
				event: "thinking",
				data: JSON.stringify({ text: "已接收请求，开始调用 agents" }),
			});
			try {
				const result = await runAgentsBridgeChatTask(c, userId, taskRequest, {
					abortSignal: c.req.raw.signal,
					onStreamEvent: async (event) => {
						if (!FORWARDED_STREAM_EVENTS.has(event.event)) return;
						await stream.writeSSE({
							event: event.event,
							data: JSON.stringify(event.data),
						});
					},
				});
				if (c.req.raw.signal.aborted) return;
				const response = buildAgentsChatResponseFromTaskResult(result);
				await persistAgentsChatConversationTurn({
					c,
					userId,
					requestInput: input,
					response,
					result,
				});
				await writeFinalResult(stream, result);
			} catch (error) {
				if (c.req.raw.signal.aborted) return;
				await writeStreamError(stream, toStreamErrorPayload(error), "error");
			}
		});
	}

	const result = await runAgentsBridgeChatTask(c, userId, taskRequest, {
		abortSignal: c.req.raw.signal,
	});
	const response = buildAgentsChatResponseFromTaskResult(result);
	await persistAgentsChatConversationTurn({
		c,
		userId,
		requestInput: input,
		response,
		result,
	});
	return c.json(response);
}
