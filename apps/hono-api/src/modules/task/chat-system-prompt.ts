import {
	buildChatAssistantSystemPrompt,
	buildChatSkillSystemPrompt,
	buildPersonaContextPrompt,
	extractPersonaIdentity,
	loadPersonaContextFiles,
	resolvePersonaRootCandidates,
	resolvePersonaWorkspaceRoot,
} from "./chat-persona-prompt";
import { buildPublicChatBaseSystemPrompt } from "./chat-base-system";
import { buildPublicChatContextFragment } from "./chat-context-fragment";
import { buildPublicChatResponsePolicyPrompt } from "./chat-response-policy";
import { hasPublicChatExecutionContext } from "./chat-persona-prompt";

export type {
	ChatPromptSkill,
	PersonaContextFile,
	PersonaIdentity,
	PublicChatPromptContext,
	PublicChatReferenceImageSlot,
} from "./chat-prompt.types";

export {
	buildChatAssistantSystemPrompt,
	buildChatSkillSystemPrompt,
	hasPublicChatExecutionContext,
	buildPersonaContextPrompt,
	extractPersonaIdentity,
	resolvePersonaRootCandidates,
};

export { buildPublicChatBaseSystemPrompt } from "./chat-base-system";
export { buildPublicChatContextFragment } from "./chat-context-fragment";
export { buildPublicChatResponsePolicyPrompt } from "./chat-response-policy";
export { buildPublicChatRuntimeSkillPrompt } from "./chat-runtime-skills";

export async function buildPublicChatSystemPrompt(input: {
	chatContext: import("./chat-prompt.types").PublicChatPromptContext;
	canvasProjectId: string | null;
	canvasFlowId: string | null;
	planOnly: boolean;
	forceAssetGeneration: boolean;
}): Promise<string> {
	const hasExecutionContext = hasPublicChatExecutionContext(input.chatContext);
	const hasProjectScope = Boolean(input.canvasProjectId?.trim()) || Boolean(input.canvasFlowId?.trim());
	if (!hasExecutionContext && !hasProjectScope) return "";
	const personaFiles = await loadPersonaContextFiles();
	const personaContextPrompt =
		personaFiles.length > 0
			? buildPersonaContextPrompt({
					files: personaFiles,
					workspaceRoot: resolvePersonaWorkspaceRoot(personaFiles),
			  })
			: "";
	const personaIdentity = extractPersonaIdentity(personaFiles);
	const skillPrompt = buildChatSkillSystemPrompt(input.chatContext.skill);
	const baseSystemPrompt = buildPublicChatBaseSystemPrompt({
		forceAssetGeneration: input.forceAssetGeneration,
		personaIdentity,
	});
	const responsePolicyPrompt = buildPublicChatResponsePolicyPrompt();
	const contextFragment = buildPublicChatContextFragment({
		...input.chatContext,
		canvasProjectId: input.canvasProjectId,
		canvasFlowId: input.canvasFlowId,
		planOnly: input.planOnly,
		forceAssetGeneration: input.forceAssetGeneration,
	});
	return [
		personaContextPrompt,
		skillPrompt,
		baseSystemPrompt,
		responsePolicyPrompt,
		contextFragment,
	]
		.filter(Boolean)
		.join("\n\n")
		.trim();
}
