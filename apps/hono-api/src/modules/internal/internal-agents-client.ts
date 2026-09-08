import {
	parseImagePromptSpecialistExecutionRequest,
	parseImagePromptSpecialistResponse,
	type ImagePromptSpecialistErrorCode,
	type ImagePromptSpecialistRequestV1,
	type ImagePromptSpecialistResponseV1,
} from "./image-prompt-contract";
import { loadImagePromptSpecialistContractModule } from "../../platform/node/shared-schema-loader";

export class InternalAgentsClientFailure extends Error {
	readonly code: ImagePromptSpecialistErrorCode;

	constructor(code: ImagePromptSpecialistErrorCode, message: string) {
		super(message);
		this.name = "InternalAgentsClientFailure";
		this.code = code;
	}
}

export type InternalAgentsImagePromptClient = {
	execute(
		request: ImagePromptSpecialistRequestV1,
		relayGrant: string,
		abortSignal?: AbortSignal,
	): Promise<ImagePromptSpecialistResponseV1>;
};

const MIN_PRIVATE_TOKEN_BYTES = 32;
const MAX_PRIVATE_TOKEN_BYTES = 512;

function requirePrivateToken(value: string): string {
	const token = value.trim();
	const byteLength = new TextEncoder().encode(token).byteLength;
	if (byteLength < MIN_PRIVATE_TOKEN_BYTES || byteLength > MAX_PRIVATE_TOKEN_BYTES) {
		throw new InternalAgentsClientFailure(
			"specialist_unavailable",
			`agents specialist token must contain at least ${MIN_PRIVATE_TOKEN_BYTES} UTF-8 bytes and at most ${MAX_PRIVATE_TOKEN_BYTES} UTF-8 bytes`,
		);
	}
	return token;
}

function requireBaseUrl(value: string): string {
	const normalized = value.trim().replace(/\/+$/, "");
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		throw new InternalAgentsClientFailure("specialist_unavailable", "agents specialist URL is invalid");
	}
	if (
		(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
		parsed.username ||
		parsed.password ||
		parsed.search ||
		parsed.hash
	) {
		throw new InternalAgentsClientFailure("specialist_unavailable", "agents specialist URL is invalid");
	}
	return normalized;
}

function isStableErrorCode(value: unknown): value is ImagePromptSpecialistErrorCode {
	return (
		typeof value === "string" &&
		loadImagePromptSpecialistContractModule().IMAGE_PROMPT_SPECIALIST_ERROR_CODES.includes(value)
	);
}

function parseFailureBody(value: unknown): { code: ImagePromptSpecialistErrorCode; reason: string } | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (!isStableErrorCode(record.code)) return null;
	const reason = typeof record.reason === "string" ? record.reason.trim().slice(0, 500) : "";
	return { code: record.code, reason: reason || "agents specialist request failed" };
}

async function readJson(response: Response): Promise<unknown> {
	const text = await response.text();
	if (!text.trim()) return null;
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return null;
	}
}

export function createInternalAgentsImagePromptClient(input: {
	baseUrl: string;
	token: string;
	timeoutMs: number;
	fetchImpl?: typeof fetch;
}): InternalAgentsImagePromptClient {
	const baseUrl = requireBaseUrl(input.baseUrl);
	const token = requirePrivateToken(input.token);
	if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 120_000) {
		throw new InternalAgentsClientFailure("specialist_unavailable", "agents specialist timeout is invalid");
	}
	const fetchImpl = input.fetchImpl ?? fetch;

	return {
		async execute(request, relayGrant, abortSignal) {
			const envelope = parseImagePromptSpecialistExecutionRequest({
				schemaVersion: "image-prompt-execution/v1",
				request,
				relayGrant,
			});
			if (!envelope.ok) {
				throw new InternalAgentsClientFailure(
					"specialist_request_invalid",
					`agents specialist execution request is invalid: ${envelope.error}`,
				);
			}
			const timeoutSignal = AbortSignal.timeout(input.timeoutMs);
			const signal = abortSignal
				? AbortSignal.any([abortSignal, timeoutSignal])
				: timeoutSignal;
			let response: Response;
			try {
				response = await fetchImpl(`${baseUrl}/specialists/image-prompt`, {
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/json",
						authorization: `Bearer ${token}`,
					},
					body: JSON.stringify(envelope.value),
					signal,
				});
			} catch (error) {
				if (timeoutSignal.aborted) {
					throw new InternalAgentsClientFailure("specialist_timeout", "agents specialist timed out");
				}
				if (abortSignal?.aborted) {
					throw new InternalAgentsClientFailure("specialist_unavailable", "specialist request was cancelled");
				}
				throw new InternalAgentsClientFailure(
					"specialist_unavailable",
					`agents specialist unavailable: ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			const body = await readJson(response);
			if (!response.ok) {
				const failure = parseFailureBody(body);
				throw new InternalAgentsClientFailure(
					failure?.code ?? "specialist_unavailable",
					failure?.reason ?? `agents specialist returned HTTP ${response.status}`,
				);
			}
			const parsed = parseImagePromptSpecialistResponse(body);
			if (!parsed.ok) {
				throw new InternalAgentsClientFailure(
					"specialist_output_invalid",
					`agents specialist response is invalid: ${parsed.error}`,
				);
			}
			return parsed.value;
		},
	};
}
