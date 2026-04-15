export type GenerationContract = {
  version: "v1";
  lockedAnchors: string[];
  editableVariable: string | null;
  forbiddenChanges: string[];
  approvedKeyframeId: string | null;
};

export type GenerationContractParseResult =
  | { ok: true; value: GenerationContract | null }
  | { ok: false; error: string };

export const GENERATION_CONTRACT_VERSION: "v1";
export const GENERATION_CONTRACT_MAX_LIST_ITEMS: number;
export const GENERATION_CONTRACT_MAX_TEXT_LENGTH: number;
export const GENERATION_CONTRACT_MAX_ID_LENGTH: number;

export function parseGenerationContract(input: unknown): GenerationContractParseResult;
export function formatGenerationContractPromptLines(contract: GenerationContract | null): string[];
