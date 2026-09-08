export type ImagePromptSpecialistErrorCode =
  | "specialist_auth_invalid"
  | "specialist_replay_rejected"
  | "specialist_request_invalid"
  | "specialist_evidence_invalid"
  | "specialist_idempotency_conflict"
  | "specialist_model_binding_invalid"
  | "specialist_unavailable"
  | "specialist_timeout"
  | "specialist_output_invalid"
  | "specialist_model_inheritance_failed";

export type ImagePromptSpecialistScalar = string | number | boolean | null;

export interface ImagePromptSpecialistReferenceV1 {
  resourceId: string;
  mediaType: "image";
  semanticRole: "source" | "character" | "style" | "scene";
  ordinal: number;
  contentDigest: string;
  accessUrl: string;
}

export interface ImagePromptSpecialistEvidenceV1 {
  currentPrompt?: string;
  negativePrompt?: string;
  references: ImagePromptSpecialistReferenceV1[];
}

export interface ImagePromptSpecialistModelBindingV1 {
  catalogRecordId: string;
  modelKey: string;
  configurationRevision: string;
  providerEndpointVersionId: string;
  providerCredentialVersionId: string;
}

export interface ImagePromptSpecialistRequestV1 {
  schemaVersion: "image-prompt-request/v1";
  requestId: string;
  correlationId: string;
  idempotencyKey: string;
  actor: { tenantId: string; userId: string };
  scope: {
    projectId: string;
    canvasId: string;
    nodeId: string;
    nodeRevision: number;
  };
  commercialContext: {
    generationTaskId: string;
    billingOrderId: string;
    quoteFingerprint: string;
  };
  operation: {
    command: "portraitTexture";
    objective: string;
    parameters: Record<string, ImagePromptSpecialistScalar>;
  };
  evidence: ImagePromptSpecialistEvidenceV1;
  promptModel: ImagePromptSpecialistModelBindingV1;
}

export interface ImagePromptSpecialistExecutionRequestV1 {
  schemaVersion: "image-prompt-execution/v1";
  request: ImagePromptSpecialistRequestV1;
  relayGrant: string;
}

export interface ImagePromptSpecialistStructuredPromptV2 {
  version: "v2";
  shotIntent: string;
  spatialLayout: string[];
  cameraPlan: string[];
  lightingPlan: string[];
  continuityConstraints: string[];
  negativeConstraints: string[];
}

export interface ImagePromptSpecialistUsageV1 {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ImagePromptSpecialistResponseV1 {
  schemaVersion: "image-prompt/v1";
  imagePrompt: string;
  structuredPrompt?: ImagePromptSpecialistStructuredPromptV2;
  trace: {
    requestId: string;
    correlationId: string;
    specialist: "image_prompt_specialist";
    evidenceDigest: string;
    model: ImagePromptSpecialistModelBindingV1 & { effectiveModel: string };
    usage: ImagePromptSpecialistUsageV1;
    startedAt: string;
    completedAt: string;
  };
}

export type ImagePromptSpecialistParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const IMAGE_PROMPT_SPECIALIST_REQUEST_VERSION: "image-prompt-request/v1";
export const IMAGE_PROMPT_SPECIALIST_EXECUTION_VERSION: "image-prompt-execution/v1";
export const IMAGE_PROMPT_SPECIALIST_RESPONSE_VERSION: "image-prompt/v1";
export const IMAGE_PROMPT_SPECIALIST_NAME: "image_prompt_specialist";
export const IMAGE_PROMPT_SPECIALIST_ERROR_CODES: readonly ImagePromptSpecialistErrorCode[];

export function parseImagePromptSpecialistRequest(
  input: unknown,
): ImagePromptSpecialistParseResult<ImagePromptSpecialistRequestV1>;

export function parseImagePromptSpecialistExecutionRequest(
  input: unknown,
): ImagePromptSpecialistParseResult<ImagePromptSpecialistExecutionRequestV1>;

export function parseImagePromptSpecialistResponse(
  input: unknown,
): ImagePromptSpecialistParseResult<ImagePromptSpecialistResponseV1>;

export function canonicalImagePromptSpecialistJson(value: unknown): string;
export function imagePromptEvidenceDigest(evidence: unknown): string;
