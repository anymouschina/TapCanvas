import { buildPublicChatContextFragment } from "./chat-context-fragment";
import type { PublicChatPromptContext } from "./chat-prompt.types";

export type {
	ChatPromptSkill,
	PersonaContextFile,
	PersonaIdentity,
	PublicChatPromptContext,
	PublicChatReferenceImageSlot,
} from "./chat-prompt.types";

export { buildPublicChatContextFragment } from "./chat-context-fragment";

/**
 * Structural context presence check only. It deliberately does not infer the
 * user's intent, select a workflow, or inspect prompt prose.
 */
export function hasPublicChatExecutionContext(input: PublicChatPromptContext): boolean {
	return (
		Boolean(input.generationProposal?.proposalId?.trim()) ||
		Boolean(input.skill?.id?.trim()) ||
		Boolean(input.currentBookId?.trim()) ||
		Boolean(input.currentChapterId?.trim()) ||
		input.referenceImageCount > 0 ||
		input.referenceImageSlots.length > 0 ||
		input.assetRoleSummary.length > 0 ||
		input.hasTargetImage ||
		input.hasSelectedNode ||
		Boolean(input.selectedNodeId?.trim()) ||
		Boolean(input.selectedNodeKind?.trim()) ||
		Boolean(input.selectedNodeTextPreview?.trim()) ||
		input.selectedReference !== null
	);
}

/**
 * Hono contributes only current, caller-scoped facts to the agents runtime.
 * Persona, SOP, response policy and skill methodology belong to agents-cli
 * and its progressively loaded skills, so this builder performs no file IO.
 */
export async function buildPublicChatSystemPrompt(input: {
	chatContext: PublicChatPromptContext;
	canvasProjectId: string | null;
	canvasFlowId: string | null;
	planOnly: boolean;
	forceAssetGeneration: boolean;
}): Promise<string> {
	const hasProjectScope = Boolean(input.canvasProjectId?.trim()) || Boolean(input.canvasFlowId?.trim());
	if (!hasProjectScope && !hasPublicChatExecutionContext(input.chatContext)) return "";
	return buildPublicChatContextFragment({
		...input.chatContext,
		canvasProjectId: input.canvasProjectId,
		canvasFlowId: input.canvasFlowId,
		planOnly: input.planOnly,
		forceAssetGeneration: input.forceAssetGeneration,
	});
}
