import type { PublicChatPromptContext } from "./chat-prompt.types";

type PublicChatRuntimeSkillPromptInput = {
	chatContext: PublicChatPromptContext;
	canvasProjectId: string | null;
	canvasFlowId: string | null;
};

export async function buildPublicChatRuntimeSkillPrompt(
	input: PublicChatRuntimeSkillPromptInput,
): Promise<string> {
	void input;
	return "";
}
