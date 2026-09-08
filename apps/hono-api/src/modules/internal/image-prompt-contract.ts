import type {
	ImagePromptSpecialistErrorCode,
	ImagePromptSpecialistExecutionRequestV1,
	ImagePromptSpecialistModelBindingV1,
	ImagePromptSpecialistRequestV1,
	ImagePromptSpecialistResponseV1,
} from "../../../../../packages/schemas/image-prompt-specialist/index.js";
import { loadImagePromptSpecialistContractModule } from "../../platform/node/shared-schema-loader";

export type {
	ImagePromptSpecialistErrorCode,
	ImagePromptSpecialistExecutionRequestV1,
	ImagePromptSpecialistModelBindingV1,
	ImagePromptSpecialistRequestV1,
	ImagePromptSpecialistResponseV1,
};

export function parseImagePromptSpecialistExecutionRequest(
	input: unknown,
):
	| { ok: true; value: ImagePromptSpecialistExecutionRequestV1 }
	| { ok: false; error: string } {
	return loadImagePromptSpecialistContractModule().parseImagePromptSpecialistExecutionRequest(input);
}

export function parseImagePromptSpecialistRequest(
	input: unknown,
):
	| { ok: true; value: ImagePromptSpecialistRequestV1 }
	| { ok: false; error: string } {
	return loadImagePromptSpecialistContractModule().parseImagePromptSpecialistRequest(input);
}

export function parseImagePromptSpecialistResponse(
	input: unknown,
):
	| { ok: true; value: ImagePromptSpecialistResponseV1 }
	| { ok: false; error: string } {
	return loadImagePromptSpecialistContractModule().parseImagePromptSpecialistResponse(input);
}

export function canonicalImagePromptSpecialistJson(input: unknown): string {
	return loadImagePromptSpecialistContractModule().canonicalImagePromptSpecialistJson(input);
}

export function imagePromptEvidenceDigest(input: unknown): string {
	return loadImagePromptSpecialistContractModule().imagePromptEvidenceDigest(input);
}

export function isImagePromptSpecialistErrorCode(
	input: string,
): input is ImagePromptSpecialistErrorCode {
	return loadImagePromptSpecialistContractModule().IMAGE_PROMPT_SPECIALIST_ERROR_CODES.includes(
		input,
	);
}
