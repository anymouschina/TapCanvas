import fs from "node:fs";
import path from "node:path";

import { AppError } from "../../middleware/error";

export type GenerationContract = {
	version: "v1";
	lockedAnchors: string[];
	editableVariable: string | null;
	forbiddenChanges: string[];
	approvedKeyframeId: string | null;
};

type GenerationContractParseResult =
	| { ok: true; value: GenerationContract | null }
	| { ok: false; error: string };

type GenerationContractModule = {
	GENERATION_CONTRACT_VERSION: "v1";
	GENERATION_CONTRACT_MAX_LIST_ITEMS: number;
	GENERATION_CONTRACT_MAX_TEXT_LENGTH: number;
	GENERATION_CONTRACT_MAX_ID_LENGTH: number;
	parseGenerationContract: (input: unknown) => GenerationContractParseResult;
	formatGenerationContractPromptLines: (contract: GenerationContract | null) => string[];
};

export type ImagePromptSpecV2 = {
	version: "v2";
	shotIntent: string;
	spatialLayout: string[];
	subjectRelations: string[];
	referenceBindings?: string[];
	identityConstraints?: string[];
	environmentObjects: string[];
	cameraPlan: string[];
	lightingPlan: string[];
	styleConstraints: string[];
	continuityConstraints: string[];
	negativeConstraints: string[];
};

type ImagePromptSpecV2ParseResult =
	| { ok: true; value: ImagePromptSpecV2 | null }
	| { ok: false; error: string };

type ImagePromptSpecModule = {
	IMAGE_PROMPT_SPEC_V2_VERSION: "v2";
	IMAGE_PROMPT_SPEC_MAX_LIST_ITEMS: number;
	IMAGE_PROMPT_SPEC_MAX_TEXT_LENGTH: number;
	parseImagePromptSpecV2: (input: unknown) => ImagePromptSpecV2ParseResult;
	compileImagePromptSpecV2: (spec: ImagePromptSpecV2 | null) => string;
};

type ImageViewControlsModule = {
	appendImageViewPrompt: (
		prompt: string,
		input: {
			cameraControl?: unknown;
			lightingRig?: unknown;
		},
	) => string;
};

function requireSharedSchemaModule<TModule>(moduleRelativePath: string): TModule {
	const candidatePaths = [
		path.resolve(process.cwd(), "../../packages/schemas", moduleRelativePath),
		path.resolve(process.cwd(), "../packages/schemas", moduleRelativePath),
	];
	const matchedPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
	if (!matchedPath) {
		throw new AppError("Failed to resolve shared schema module", {
			status: 500,
			code: "SHARED_SCHEMA_MODULE_NOT_FOUND",
			details: {
				moduleRelativePath,
				cwd: process.cwd(),
				candidatePaths,
			},
		});
	}
	return require(matchedPath) as TModule;
}

export function loadGenerationContractModule(): GenerationContractModule {
	return requireSharedSchemaModule<GenerationContractModule>("generation-contract/index.js");
}

export function loadImagePromptSpecModule(): ImagePromptSpecModule {
	return requireSharedSchemaModule<ImagePromptSpecModule>("image-prompt-spec/index.js");
}

export function loadImageViewControlsModule(): ImageViewControlsModule {
	return requireSharedSchemaModule<ImageViewControlsModule>("image-view-controls/index.js");
}
