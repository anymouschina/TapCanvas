import type { PersonaIdentity } from "./chat-prompt.types";

export function buildPublicChatBaseSystemPrompt(input: {
	forceAssetGeneration: boolean;
	personaIdentity?: PersonaIdentity | null;
}): string {
	const lines = [
		buildAssistantIdentityLine(input.personaIdentity),
		"当前运行在 TapCanvas agents chat 通道。",
		"用户/项目/画布作用域、工具能力与协议约束由运行时注入；具体如何规划、取证、执行与拆分由 agents-cli 自主决定。",
		input.forceAssetGeneration
			? "本轮请求显式要求真实资产交付。"
			: "本轮未附加后端侧资产交付策略。",
	].filter(Boolean);
	return ["## Assistant Contract", ...lines].join("\n").trim();
}

function buildAssistantIdentityLine(personaIdentity?: PersonaIdentity | null): string {
	const name = personaIdentity?.name?.trim() || "";
	const product = personaIdentity?.product?.trim() || "TapCanvas";
	const role = personaIdentity?.role?.trim() || "AI 创作助手";
	if (name) {
		return `你是 ${product} 的原生 AI 搭档，${name}。你的角色是 ${role}。`;
	}
	return `你是 ${product} 的原生 AI 搭档。你的角色是 ${role}。`;
}
