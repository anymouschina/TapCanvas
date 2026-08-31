type JsonObject = Record<string, unknown>;

type ResponsesContentPart =
	| { type: "input_text" | "output_text"; text: string }
	| { type: "input_image"; image_url: string; detail?: string };

type ResponsesMessage = {
	type: "message";
	role: "user" | "assistant";
	content: ResponsesContentPart[];
};

type ResponsesTool = { type: "web_search" };

export class AgentsLlmProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AgentsLlmProtocolError";
	}
}

function asObject(value: unknown): JsonObject | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as JsonObject;
}

function readNonEmptyString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim();
	return normalized || null;
}

function readTextParts(value: unknown): string[] {
	if (typeof value === "string") return value.trim() ? [value] : [];
	if (!Array.isArray(value)) return [];
	const parts: string[] = [];
	for (const rawPart of value) {
		const part = asObject(rawPart);
		if (!part) continue;
		if (part.type !== "text" && part.type !== "input_text" && part.type !== "output_text") {
			continue;
		}
		const text = readNonEmptyString(part.text);
		if (text) parts.push(text);
	}
	return parts;
}

function convertMessageContent(
	role: "user" | "assistant",
	value: unknown,
): ResponsesContentPart[] {
	const textType = role === "assistant" ? "output_text" : "input_text";
	if (typeof value === "string") {
		return value.trim() ? [{ type: textType, text: value }] : [];
	}
	if (!Array.isArray(value)) {
		throw new AgentsLlmProtocolError(`chat message content must be a string or array (role=${role})`);
	}

	const parts: ResponsesContentPart[] = [];
	for (const rawPart of value) {
		const part = asObject(rawPart);
		if (!part) {
			throw new AgentsLlmProtocolError(`chat message content part must be an object (role=${role})`);
		}
		if (part.type === "text" || part.type === "input_text" || part.type === "output_text") {
			const text = readNonEmptyString(part.text);
			if (text) parts.push({ type: textType, text });
			continue;
		}
		if (part.type === "image_url") {
			if (role !== "user") {
				throw new AgentsLlmProtocolError("assistant image_url content cannot be converted to Responses input");
			}
			const image = asObject(part.image_url);
			const imageUrl = readNonEmptyString(image?.url);
			if (!imageUrl) {
				throw new AgentsLlmProtocolError("chat image_url content requires image_url.url");
			}
			const detail = readNonEmptyString(image?.detail);
			parts.push({
				type: "input_image",
				image_url: imageUrl,
				...(detail ? { detail } : {}),
			});
			continue;
		}
		throw new AgentsLlmProtocolError(
			`unsupported chat content part type: ${String(part.type || "unknown")}`,
		);
	}
	return parts;
}

function convertTools(value: unknown): ResponsesTool[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		throw new AgentsLlmProtocolError("tools must be an array");
	}

	let hasWebSearch = false;
	for (const rawTool of value) {
		const tool = asObject(rawTool);
		if (!tool) throw new AgentsLlmProtocolError("tool must be an object");
		const type = readNonEmptyString(tool.type);
		if (type === "web_search" || type === "web_search_preview") {
			hasWebSearch = true;
			continue;
		}
		throw new AgentsLlmProtocolError(`unsupported tool type: ${String(type || "unknown")}`);
	}

	return hasWebSearch ? [{ type: "web_search" }] : [];
}

export function usesResponsesApi(model: string): boolean {
	return /^gpt-/i.test(model.trim());
}

export function buildResponsesRequestFromChat(body: JsonObject): JsonObject {
	const model = readNonEmptyString(body.model);
	if (!model) throw new AgentsLlmProtocolError("model is required");
	if (!Array.isArray(body.messages) || body.messages.length === 0) {
		throw new AgentsLlmProtocolError("messages must be a non-empty array");
	}

	const instructions: string[] = [];
	const input: ResponsesMessage[] = [];
	for (const rawMessage of body.messages) {
		const message = asObject(rawMessage);
		if (!message) throw new AgentsLlmProtocolError("chat message must be an object");
		const role = readNonEmptyString(message.role);
		if (role === "system" || role === "developer") {
			const systemParts = readTextParts(message.content);
			if (systemParts.length === 0) {
				throw new AgentsLlmProtocolError(`${role} message requires text content`);
			}
			instructions.push(systemParts.join("\n"));
			continue;
		}
		if (role !== "user" && role !== "assistant") {
			throw new AgentsLlmProtocolError(`unsupported chat message role: ${String(role || "unknown")}`);
		}
		if (Array.isArray(message.tool_calls) || message.tool_call_id) {
			throw new AgentsLlmProtocolError("tool call history is not supported by the text helper proxy");
		}
		const content = convertMessageContent(role, message.content);
		if (content.length === 0) {
			throw new AgentsLlmProtocolError(`${role} message requires non-empty content`);
		}
		input.push({ type: "message", role, content });
	}
	if (input.length === 0) {
		throw new AgentsLlmProtocolError("at least one user or assistant message is required");
	}

	const maxTokensCandidate = body.max_tokens ?? body.max_completion_tokens;
	const maxOutputTokens =
		typeof maxTokensCandidate === "number" &&
		Number.isFinite(maxTokensCandidate) &&
		maxTokensCandidate > 0
			? Math.trunc(maxTokensCandidate)
			: null;
	const tools = convertTools(body.tools);
	const rawReasoningEffort = body.reasoning_effort ?? body.thinking_level;
	const reasoningEffort =
		typeof rawReasoningEffort === "string" &&
		["low", "medium", "high"].includes(rawReasoningEffort.trim().toLowerCase())
			? rawReasoningEffort.trim().toLowerCase()
			: null;

	return {
		model,
		stream: true,
		input,
		...(instructions.length > 0 ? { instructions: instructions.join("\n\n") } : {}),
		...(maxOutputTokens ? { max_output_tokens: maxOutputTokens } : {}),
		...(tools.length > 0 ? { tools } : {}),
		...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
	};
}

function extractTextFromResponsesObject(value: unknown): string {
	const response = asObject(value);
	if (!response) return "";
	if (typeof response.output_text === "string" && response.output_text) {
		return response.output_text;
	}
	if (!Array.isArray(response.output)) return "";
	const chunks: string[] = [];
	for (const rawItem of response.output) {
		const item = asObject(rawItem);
		if (!item) continue;
		if ((item.type === "output_text" || item.type === "text") && typeof item.text === "string") {
			chunks.push(item.text);
		}
		if (item.type !== "message" || !Array.isArray(item.content)) continue;
		for (const rawPart of item.content) {
			const part = asObject(rawPart);
			if (!part) continue;
			if ((part.type === "output_text" || part.type === "text") && typeof part.text === "string") {
				chunks.push(part.text);
			}
		}
	}
	return chunks.join("");
}

export type ResponsesOutputEnvelope = {
	id: string | null;
	model: string | null;
	status: string | null;
	previousResponseId: string | null;
	store: boolean | null;
	text: string;
};

const readResponsesEnvelope = (
	value: unknown,
	textOverride = "",
): ResponsesOutputEnvelope => {
	const response = asObject(value);
	const extractedText = response ? extractTextFromResponsesObject(response) : "";
	const text = textOverride || extractedText;
	return {
		id: readNonEmptyString(response?.id),
		model: readNonEmptyString(response?.model),
		status: readNonEmptyString(response?.status),
		previousResponseId: readNonEmptyString(response?.previous_response_id),
		store: typeof response?.store === "boolean" ? response.store : null,
		text,
	};
};

export function extractResponsesOutputEnvelope(raw: string): ResponsesOutputEnvelope {
	const normalized = raw.trim();
	if (!normalized) throw new AgentsLlmProtocolError("Responses upstream returned an empty body");

	const dataLines = normalized
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.startsWith("data:"));
	if (dataLines.length > 0) {
		let deltaText = "";
		let completedText = "";
		let responseObject: unknown = null;
		for (const line of dataLines) {
			const payload = line.slice("data:".length).trim();
			if (!payload || payload === "[DONE]") continue;
			let event: JsonObject;
			try {
				const parsed = JSON.parse(payload) as unknown;
				const parsedObject = asObject(parsed);
				if (!parsedObject) throw new Error("event is not an object");
				event = parsedObject;
			} catch (error) {
				throw new AgentsLlmProtocolError(
					`Responses SSE contained invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			if (event.type === "response.failed") {
				throw new AgentsLlmProtocolError("Responses upstream emitted response.failed");
			}
			if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
				deltaText += event.delta;
			}
			if (event.type === "response.created" && event.response) {
				responseObject = event.response;
			}
			if (event.type === "response.completed") {
				responseObject = event.response;
				completedText = extractTextFromResponsesObject(event.response);
			}
		}
		const text = deltaText || completedText;
		if (!text) throw new AgentsLlmProtocolError("Responses SSE completed without output text");
		return readResponsesEnvelope(responseObject, text);
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(normalized) as unknown;
	} catch (error) {
		throw new AgentsLlmProtocolError(
			`Responses upstream returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	const text = extractTextFromResponsesObject(parsed);
	if (!text) throw new AgentsLlmProtocolError("Responses JSON completed without output text");
	return readResponsesEnvelope(parsed, text);
}

export function extractResponsesOutputText(raw: string): string {
	return extractResponsesOutputEnvelope(raw).text;
}

export function buildChatCompletionResponse(model: string, text: string): JsonObject {
	return {
		id: `chatcmpl-responses-${crypto.randomUUID()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message: { role: "assistant", content: text },
				finish_reason: "stop",
			},
		],
	};
}
