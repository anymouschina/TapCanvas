import type { AgentConfig, LLMRequest, LLMResponse } from "../types/index.js";
import { LLMClient } from "../llm/client.js";
import {
  IMAGE_PROMPT_SPECIALIST_ERROR_CODES,
  type ImagePromptSpecialistErrorCode,
  type ImagePromptSpecialistModelBindingV1,
} from "./image-prompt-contract.js";
import { ImagePromptSpecialistFailure } from "./image-prompt-specialist.js";

export const IMAGE_PROMPT_RELAY_ENV = {
  baseUrl: "AGENTS_IMAGE_PROMPT_RELAY_BASE_URL",
} as const;

type Environment = Readonly<Record<string, string | undefined>>;

const MAX_PRIVATE_TOKEN_BYTES = 512;

export type ImagePromptRelayEndpointConfig = {
  baseUrl: string;
};

export type ImagePromptRelayConfig = ImagePromptRelayEndpointConfig & {
  grant: string;
  correlationId: string;
  generationTaskId: string;
  promptModel: ImagePromptSpecialistModelBindingV1;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isSpecialistErrorCode(value: unknown): value is ImagePromptSpecialistErrorCode {
  return (
    typeof value === "string" &&
    IMAGE_PROMPT_SPECIALIST_ERROR_CODES.includes(value as ImagePromptSpecialistErrorCode)
  );
}

function parseRelayFailure(error: unknown): ImagePromptSpecialistFailure | null {
  const errorRecord = asRecord(error);
  const details = asRecord(errorRecord?.details);
  const responsePreview = details?.responsePreview;
  if (typeof responsePreview !== "string" || !responsePreview.trim()) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(responsePreview) as unknown;
  } catch {
    return null;
  }
  const record = asRecord(payload);
  if (!record || !isSpecialistErrorCode(record.code)) return null;
  const reason = typeof record.reason === "string" ? record.reason.trim().slice(0, 500) : "";
  return new ImagePromptSpecialistFailure(
    record.code,
    reason || "image prompt model relay failed",
  );
}

function requireRelayGrant(value: string): string {
  const grant = value.trim();
  const byteLength = Buffer.byteLength(grant, "utf8");
  if (byteLength < 1 || byteLength > MAX_PRIVATE_TOKEN_BYTES) {
    throw new ImagePromptSpecialistFailure(
      "specialist_request_invalid",
      `relay grant must contain between 1 and ${MAX_PRIVATE_TOKEN_BYTES} UTF-8 bytes`,
    );
  }
  return grant;
}

function normalizeRelayBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new ImagePromptSpecialistFailure(
      "specialist_unavailable",
      `${IMAGE_PROMPT_RELAY_ENV.baseUrl} is invalid`,
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ImagePromptSpecialistFailure(
      "specialist_unavailable",
      `${IMAGE_PROMPT_RELAY_ENV.baseUrl} is invalid`,
    );
  }
  return normalized;
}

export function readImagePromptRelayConfig(
  environment: Environment = process.env,
): ImagePromptRelayEndpointConfig | null {
  const rawBaseUrl = environment[IMAGE_PROMPT_RELAY_ENV.baseUrl]?.trim() ?? "";
  if (!rawBaseUrl) return null;
  return { baseUrl: normalizeRelayBaseUrl(rawBaseUrl) };
}

export function requireImagePromptRelayConfig(
  environment: Environment = process.env,
): ImagePromptRelayEndpointConfig {
  const config = readImagePromptRelayConfig(environment);
  if (!config) {
    throw new ImagePromptSpecialistFailure(
      "specialist_unavailable",
      `${IMAGE_PROMPT_RELAY_ENV.baseUrl} is required`,
    );
  }
  return config;
}

export function createImagePromptRelayCall(
  runtimeConfig: AgentConfig,
  relayConfig: ImagePromptRelayConfig,
): (request: LLMRequest) => Promise<LLMResponse> {
  const grant = requireRelayGrant(relayConfig.grant);
  const client = new LLMClient(
    {
      ...runtimeConfig,
      apiBaseUrl: relayConfig.baseUrl,
      apiKey: grant,
      apiStyle: "chat",
      chatThinkingMode: undefined,
      stream: false,
    },
    {
      maxHttpRetries: 0,
      allowPayloadLogging: false,
      requestMetadata: {
        schemaVersion: "image-prompt-relay-binding/v1",
        correlationId: relayConfig.correlationId,
        generationTaskId: relayConfig.generationTaskId,
        promptModel: relayConfig.promptModel,
      },
    },
  );
  return async (request) => {
    try {
      return await client.call(request);
    } catch (error) {
      throw parseRelayFailure(error) ?? error;
    }
  };
}
