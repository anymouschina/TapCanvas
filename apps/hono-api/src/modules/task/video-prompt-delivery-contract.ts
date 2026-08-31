import { createHash } from "node:crypto";

export const VIDEO_PROMPT_DELIVERY_CONTRACT_VERSION = 1 as const;
export const STRUCTURED_VIDEO_PROMPT_AUTHORITY = "structured_shots" as const;

export type VideoPromptDeliveryContract = {
  version: typeof VIDEO_PROMPT_DELIVERY_CONTRACT_VERSION;
  authority: typeof STRUCTURED_VIDEO_PROMPT_AUTHORITY;
  promptSha256: string;
  negativePromptSha256: string;
};

export type VideoPromptDeliveryProjection = {
  prompt: string;
  negativePrompt: string;
  promptDeliveryContract?: VideoPromptDeliveryContract;
  videoPrompt?: string;
};

export type VideoPromptDeliveryVerification =
  | {
      ok: true;
      contract: VideoPromptDeliveryContract | null;
    }
  | {
      ok: false;
      code:
        | "video_prompt_delivery_contract_invalid"
        | "video_prompt_delivery_prompt_mismatch"
        | "video_prompt_delivery_negative_prompt_mismatch";
      message: string;
    };

export function hashVideoPromptText(value: string): string {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

export function buildVideoPromptDeliveryContract(input: {
  prompt: string;
  negativePrompt?: string;
}): VideoPromptDeliveryContract {
  return {
    version: VIDEO_PROMPT_DELIVERY_CONTRACT_VERSION,
    authority: STRUCTURED_VIDEO_PROMPT_AUTHORITY,
    promptSha256: hashVideoPromptText(input.prompt),
    negativePromptSha256: hashVideoPromptText(input.negativePrompt ?? ""),
  };
}

/**
 * Builds the single persisted projection of the exact provider-bound prompt.
 *
 * Both the running placeholder and every success settlement path must spread
 * this projection after caller-supplied node data. Otherwise a fast/synchronous
 * provider result can accidentally restore the pre-annotation prompt while
 * retaining the hash contract that was built from the final prompt.
 */
export function buildVideoPromptDeliveryProjection(input: {
  prompt: string;
  negativePrompt: string;
  contract: VideoPromptDeliveryContract | null;
}): VideoPromptDeliveryProjection {
  return {
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    ...(input.contract
      ? {
          promptDeliveryContract: input.contract,
          videoPrompt: input.prompt,
        }
      : {}),
  };
}

function readContract(value: unknown): VideoPromptDeliveryContract | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const promptSha256 = typeof record.promptSha256 === "string"
    ? record.promptSha256.trim().toLowerCase()
    : "";
  const negativePromptSha256 = typeof record.negativePromptSha256 === "string"
    ? record.negativePromptSha256.trim().toLowerCase()
    : "";
  if (
    record.version !== VIDEO_PROMPT_DELIVERY_CONTRACT_VERSION ||
    record.authority !== STRUCTURED_VIDEO_PROMPT_AUTHORITY ||
    !/^[a-f0-9]{64}$/.test(promptSha256) ||
    !/^[a-f0-9]{64}$/.test(negativePromptSha256)
  ) {
    return null;
  }
  return {
    version: VIDEO_PROMPT_DELIVERY_CONTRACT_VERSION,
    authority: STRUCTURED_VIDEO_PROMPT_AUTHORITY,
    promptSha256,
    negativePromptSha256,
  };
}

/**
 * Verifies the exact provider-bound prompt projection.
 *
 * A missing contract means the caller is a non-orchestrated/manual request and
 * retains its existing prompt preparation path. A present but malformed or
 * mismatched contract fails explicitly; it must never fall back to mutable
 * prompt preparation because that would hide a broken authoring-to-provider
 * handoff.
 */
export function verifyVideoPromptDeliveryContract(input: {
  rawContract: unknown;
  prompt: string;
  negativePrompt?: string;
}): VideoPromptDeliveryVerification {
  if (input.rawContract === undefined || input.rawContract === null) {
    return { ok: true, contract: null };
  }
  const contract = readContract(input.rawContract);
  if (!contract) {
    return {
      ok: false,
      code: "video_prompt_delivery_contract_invalid",
      message: "视频提示词交付合同无效，禁止回退到可变提示词路径",
    };
  }
  if (hashVideoPromptText(input.prompt) !== contract.promptSha256) {
    return {
      ok: false,
      code: "video_prompt_delivery_prompt_mismatch",
      message: "最终视频提示词与结构化镜头冻结合同不一致",
    };
  }
  if (hashVideoPromptText(input.negativePrompt ?? "") !== contract.negativePromptSha256) {
    return {
      ok: false,
      code: "video_prompt_delivery_negative_prompt_mismatch",
      message: "最终视频负向提示词与结构化镜头冻结合同不一致",
    };
  }
  return { ok: true, contract };
}
