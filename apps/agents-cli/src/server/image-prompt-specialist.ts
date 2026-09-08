import type { AgentDefinition, LLMRequest, LLMResponse } from "../types/index.js";
import {
  IMAGE_PROMPT_SPECIALIST_NAME,
  imagePromptEvidenceDigest,
  parseImagePromptSpecialistRequest,
  parseImagePromptSpecialistResponse,
  type ImagePromptSpecialistErrorCode,
  type ImagePromptSpecialistRequestV1,
  type ImagePromptSpecialistResponseV1,
  type ImagePromptSpecialistStructuredPromptV2,
} from "./image-prompt-contract.js";

const REQUIRED_SKILL = "tapcanvas-prompt-specialists";
const RAW_OUTPUT_KEYS = new Set(["imagePrompt", "structuredPrompt"]);

export class ImagePromptSpecialistFailure extends Error {
  constructor(
    readonly code: ImagePromptSpecialistErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImagePromptSpecialistFailure";
  }
}

export type ImagePromptSpecialistDependencies = {
  call: (request: LLMRequest) => Promise<LLMResponse>;
  getRole: (name: string) => AgentDefinition | null;
  getSkillContent: (name: string) => string | null;
  now?: () => Date;
};

type RawSpecialistOutput = {
  imagePrompt: string;
  structuredPrompt?: ImagePromptSpecialistStructuredPromptV2;
};

function parseRawSpecialistOutput(text: string): RawSpecialistOutput {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ImagePromptSpecialistFailure(
      "specialist_output_invalid",
      "image_prompt_specialist returned invalid JSON",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ImagePromptSpecialistFailure(
      "specialist_output_invalid",
      "image_prompt_specialist output must be one JSON object",
    );
  }
  const record = value as Record<string, unknown>;
  const unsupported = Object.keys(record).filter((key) => !RAW_OUTPUT_KEYS.has(key));
  if (unsupported.length > 0) {
    throw new ImagePromptSpecialistFailure(
      "specialist_output_invalid",
      `image_prompt_specialist output contains unsupported key: ${unsupported.sort()[0]}`,
    );
  }
  const imagePrompt = typeof record.imagePrompt === "string" ? record.imagePrompt : "";
  return {
    imagePrompt,
    ...(typeof record.structuredPrompt === "undefined"
      ? {}
      : { structuredPrompt: record.structuredPrompt as ImagePromptSpecialistStructuredPromptV2 }),
  };
}

function buildSpecialistSystem(role: AgentDefinition, skillContent: string): string {
  return [
    role.prompt.trim(),
    `# Required skill: ${REQUIRED_SKILL}`,
    skillContent.trim(),
    "# Runtime output contract",
    [
      "Return exactly one JSON object with these keys and types:",
      "- imagePrompt: non-empty trimmed string, maximum 8000 characters (required).",
      "- structuredPrompt: object (optional). If present, it must contain exactly:",
      '  - version: literal string "v2".',
      "  - shotIntent: non-empty trimmed string, maximum 600 characters.",
      "  - spatialLayout: array of 1-12 non-empty strings, each maximum 600 characters.",
      "  - cameraPlan: array of 1-12 non-empty strings, each maximum 600 characters.",
      "  - lightingPlan: array of 1-12 non-empty strings, each maximum 600 characters.",
      "  - continuityConstraints: array of 1-12 non-empty strings, each maximum 600 characters.",
      "  - negativeConstraints: array of 1-12 non-empty strings, each maximum 600 characters.",
      "Before returning, validate the object against this contract. If verified evidence does not support every required structuredPrompt field, omit the entire structuredPrompt field; never return null, a partial object, or an empty required array.",
      "Do not return trace; the runtime creates trace from verified facts.",
    ].join("\n"),
  ].join("\n\n");
}

function buildSpecialistUserMessage(request: ImagePromptSpecialistRequestV1): string {
  return JSON.stringify({
    objective: request.operation.objective,
    parameters: request.operation.parameters,
    currentPrompt: request.evidence.currentPrompt ?? null,
    negativePrompt: request.evidence.negativePrompt ?? null,
    references: request.evidence.references.map((reference) => ({
      resourceId: reference.resourceId,
      mediaType: reference.mediaType,
      semanticRole: reference.semanticRole,
      ordinal: reference.ordinal,
      contentDigest: reference.contentDigest,
      accessUrl: reference.accessUrl,
    })),
  });
}

export async function executeImagePromptSpecialist(
  input: ImagePromptSpecialistRequestV1,
  dependencies: ImagePromptSpecialistDependencies,
  options?: { abortSignal?: AbortSignal },
): Promise<ImagePromptSpecialistResponseV1> {
  const parsedRequest = parseImagePromptSpecialistRequest(input);
  if (!parsedRequest.ok) {
    throw new ImagePromptSpecialistFailure(
      "specialist_request_invalid",
      parsedRequest.error,
    );
  }
  const request = parsedRequest.value;
  const role = dependencies.getRole(IMAGE_PROMPT_SPECIALIST_NAME);
  if (!role || role.name !== IMAGE_PROMPT_SPECIALIST_NAME || role.tools.length !== 0) {
    throw new ImagePromptSpecialistFailure(
      "specialist_unavailable",
      "image_prompt_specialist role is unavailable or has tools",
    );
  }
  const skillContent = dependencies.getSkillContent(REQUIRED_SKILL);
  if (!skillContent) {
    throw new ImagePromptSpecialistFailure(
      "specialist_unavailable",
      `${REQUIRED_SKILL} skill is unavailable`,
    );
  }

  const now = dependencies.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const llmResponse = await dependencies.call({
    system: buildSpecialistSystem(role, skillContent),
    messages: [{ role: "user", content: buildSpecialistUserMessage(request) }],
    tools: [],
    model: request.promptModel.modelKey,
    ...(options?.abortSignal ? { abortSignal: options.abortSignal } : {}),
  });
  const completedAt = now().toISOString();

  if (llmResponse.toolCalls.length > 0) {
    throw new ImagePromptSpecialistFailure(
      "specialist_output_invalid",
      "image_prompt_specialist attempted a tool call",
    );
  }
  if (!llmResponse.model || llmResponse.model !== request.promptModel.modelKey) {
    throw new ImagePromptSpecialistFailure(
      "specialist_model_inheritance_failed",
      "image_prompt_specialist effective model does not match the requested model",
    );
  }
  if (!llmResponse.usage) {
    throw new ImagePromptSpecialistFailure(
      "specialist_output_invalid",
      "image_prompt_specialist response is missing token usage",
    );
  }

  const output = parseRawSpecialistOutput(llmResponse.text);
  const response: ImagePromptSpecialistResponseV1 = {
    schemaVersion: "image-prompt/v1",
    imagePrompt: output.imagePrompt,
    ...(output.structuredPrompt ? { structuredPrompt: output.structuredPrompt } : {}),
    trace: {
      requestId: request.requestId,
      correlationId: request.correlationId,
      specialist: IMAGE_PROMPT_SPECIALIST_NAME,
      evidenceDigest: imagePromptEvidenceDigest(request.evidence),
      model: {
        ...request.promptModel,
        effectiveModel: llmResponse.model,
      },
      usage: llmResponse.usage,
      startedAt,
      completedAt,
    },
  };
  const parsedResponse = parseImagePromptSpecialistResponse(response);
  if (!parsedResponse.ok) {
    throw new ImagePromptSpecialistFailure(
      "specialist_output_invalid",
      parsedResponse.error,
    );
  }
  return parsedResponse.value;
}
