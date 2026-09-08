import type {
	ImagePromptSpecialistErrorCode,
	ImagePromptSpecialistModelBindingV1,
} from "./image-prompt-contract";
import {
	ImagePromptRelayGrantFailure,
	consumeImagePromptRelayGrant,
	type ImagePromptRelayGrantStore,
	verifyImagePromptRelayGrantBinding,
} from "./image-prompt-relay-grant";
import {
	InternalHmaigcImagePromptModelFailure,
	type ImagePromptModelRelayMessageV1,
	type InternalHmaigcImagePromptModelClient,
} from "./internal-hmaigc-model-client";

type ImagePromptRelayMetadataV1 = {
	schemaVersion: "image-prompt-relay-binding/v1";
	correlationId: string;
	generationTaskId: string;
	promptModel: ImagePromptSpecialistModelBindingV1;
};

type GrantedImagePromptChatRequest = {
	model: string;
	messages: [ImagePromptModelRelayMessageV1, ImagePromptModelRelayMessageV1];
	tools: [];
	stream: false;
	metadata: ImagePromptRelayMetadataV1;
};

export type GrantedImagePromptChatCompletion = {
	id: string;
	object: "chat.completion";
	created: number;
	model: string;
	choices: [
		{
			index: 0;
			message: { role: "assistant"; content: string };
			finish_reason: "stop";
		},
	];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		prompt_tokens_details: { cached_tokens: number };
	};
};

const CHAT_KEYS = new Set(["model", "messages", "tools", "stream", "metadata"]);
const METADATA_KEYS = new Set([
	"schemaVersion",
	"correlationId",
	"generationTaskId",
	"promptModel",
]);
const MODEL_KEYS = new Set([
	"catalogRecordId",
	"modelKey",
	"configurationRevision",
	"providerEndpointVersionId",
	"providerCredentialVersionId",
]);

export class InternalImagePromptRelayFailure extends Error {
	readonly code: ImagePromptSpecialistErrorCode;

	constructor(code: ImagePromptSpecialistErrorCode, message: string) {
		super(message);
		this.name = "InternalImagePromptRelayFailure";
		this.code = code;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
	return Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function isIdentity(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 160 && value.trim() === value;
}

function parsePromptModel(value: unknown): ImagePromptSpecialistModelBindingV1 {
	if (
		!isRecord(value) ||
		!hasExactKeys(value, MODEL_KEYS) ||
		!isIdentity(value.catalogRecordId) ||
		!isIdentity(value.modelKey) ||
		!isIdentity(value.configurationRevision) ||
		!isIdentity(value.providerEndpointVersionId) ||
		!isIdentity(value.providerCredentialVersionId)
	) {
		throw new InternalImagePromptRelayFailure(
			"specialist_model_binding_invalid",
			"LLM relay prompt model binding is invalid",
		);
	}
	return {
		catalogRecordId: value.catalogRecordId,
		modelKey: value.modelKey,
		configurationRevision: value.configurationRevision,
		providerEndpointVersionId: value.providerEndpointVersionId,
		providerCredentialVersionId: value.providerCredentialVersionId,
	};
}

function parseChatRequest(input: unknown): GrantedImagePromptChatRequest {
	if (!isRecord(input) || !hasExactKeys(input, CHAT_KEYS)) {
		throw new InternalImagePromptRelayFailure(
			"specialist_request_invalid",
			"LLM relay body contains unsupported fields",
		);
	}
	if (!isRecord(input.metadata) || !hasExactKeys(input.metadata, METADATA_KEYS)) {
		throw new InternalImagePromptRelayFailure(
			"specialist_request_invalid",
			"LLM relay metadata is invalid",
		);
	}
	const metadata = input.metadata;
	if (
		metadata.schemaVersion !== "image-prompt-relay-binding/v1" ||
		!isIdentity(metadata.correlationId) ||
		!isIdentity(metadata.generationTaskId)
	) {
		throw new InternalImagePromptRelayFailure(
			"specialist_request_invalid",
			"LLM relay request binding is invalid",
		);
	}
	const promptModel = parsePromptModel(metadata.promptModel);
	if (
		!isIdentity(input.model) ||
		input.model !== promptModel.modelKey ||
		input.stream !== false ||
		!Array.isArray(input.tools) ||
		input.tools.length !== 0 ||
		!Array.isArray(input.messages) ||
		input.messages.length !== 2
	) {
		throw new InternalImagePromptRelayFailure(
			"specialist_request_invalid",
			"LLM relay model, tools, stream, or messages are invalid",
		);
	}
	const roles = ["system", "user"] as const;
	const messages = input.messages.map((value, index): ImagePromptModelRelayMessageV1 => {
		if (
			!isRecord(value) ||
			!hasExactKeys(value, new Set(["role", "content"])) ||
			value.role !== roles[index] ||
			typeof value.content !== "string" ||
			!value.content.trim() ||
			value.content.length > 65_536
		) {
			throw new InternalImagePromptRelayFailure(
				"specialist_request_invalid",
				"LLM relay message is invalid",
			);
		}
		return { role: roles[index], content: value.content };
	});
	return {
		model: input.model,
		messages: [messages[0], messages[1]],
		tools: [],
		stream: false,
		metadata: {
			schemaVersion: "image-prompt-relay-binding/v1",
			correlationId: metadata.correlationId,
			generationTaskId: metadata.generationTaskId,
			promptModel,
		},
	};
}

function bearerGrant(authorization: string): string {
	const normalized = authorization.trim();
	if (!normalized.toLowerCase().startsWith("bearer ")) return "";
	return normalized.slice(7).trim();
}

function parseChatRequestBody(body: string): GrantedImagePromptChatRequest {
	let value: unknown;
	try {
		value = JSON.parse(body) as unknown;
	} catch {
		throw new InternalImagePromptRelayFailure(
			"specialist_request_invalid",
			"LLM relay body is not valid JSON",
		);
	}
	return parseChatRequest(value);
}

function asRelayFailure(error: unknown): InternalImagePromptRelayFailure {
	if (error instanceof InternalImagePromptRelayFailure) return error;
	if (
		error instanceof ImagePromptRelayGrantFailure ||
		error instanceof InternalHmaigcImagePromptModelFailure
	) {
		return new InternalImagePromptRelayFailure(error.code, error.message);
	}
	return new InternalImagePromptRelayFailure(
		"specialist_unavailable",
		error instanceof Error ? error.message : String(error),
	);
}

export async function relayGrantedImagePromptModelCall(input: {
	authorization: string;
	chatRequestBody: string;
	grantStore: ImagePromptRelayGrantStore;
	hmaigcClient: InternalHmaigcImagePromptModelClient;
	now: Date;
	abortSignal?: AbortSignal;
}): Promise<GrantedImagePromptChatCompletion> {
	try {
		const binding = await consumeImagePromptRelayGrant(
			input.grantStore,
			bearerGrant(input.authorization),
			input.now,
		);
		const chat = parseChatRequestBody(input.chatRequestBody);
		verifyImagePromptRelayGrantBinding(binding, {
			correlationId: chat.metadata.correlationId,
			generationTaskId: chat.metadata.generationTaskId,
			promptModel: chat.metadata.promptModel,
		});
		const response = await input.hmaigcClient.execute(
			{
				schemaVersion: "image-prompt-model-relay-request/v1",
				correlationId: binding.correlationId,
				commercialContext: binding.commercialContext,
				promptModel: binding.promptModel,
				messages: chat.messages,
				tools: [],
				stream: false,
			},
			input.abortSignal,
		);
		if (response.effectiveModel !== binding.promptModel.modelKey) {
			throw new InternalImagePromptRelayFailure(
				"specialist_model_inheritance_failed",
				"HMaigc returned a different effective prompt model",
			);
		}
		return {
			id: response.providerRequestId,
			object: "chat.completion",
			created: Math.floor(input.now.getTime() / 1000),
			model: response.effectiveModel,
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: response.text },
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: response.usage.inputTokens,
				completion_tokens: response.usage.outputTokens,
				total_tokens: response.usage.totalTokens,
				prompt_tokens_details: { cached_tokens: response.usage.cachedTokens },
			},
		};
	} catch (error) {
		throw asRelayFailure(error);
	}
}
