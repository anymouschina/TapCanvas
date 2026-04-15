import fs from "node:fs/promises";
import path from "node:path";
import { buildPublicChatBaseSystemPrompt } from "./chat-base-system";
import { buildPublicChatContextFragment } from "./chat-context-fragment";
import { buildPublicChatResponsePolicyPrompt } from "./chat-response-policy";

import type {
	ChatPromptSkill,
	PersonaContextFile,
	PersonaIdentity,
	PublicChatPromptContext,
} from "./chat-prompt.types";

const PERSONA_FILE_NAMES = ["IDENTITY.md", "SOUL.md"] as const;
const MAX_PERSONA_CHARS_PER_FILE = 3_000;
const MAX_PERSONA_TOTAL_CHARS = 6_000;
export function buildChatSkillSystemPrompt(skill: ChatPromptSkill | null): string {
	return "请始终用中文回答，不要询问用户选择语言。";
}

export function buildChatAssistantSystemPrompt(
	input: PublicChatPromptContext & {
		canvasProjectId: string | null;
		canvasFlowId: string | null;
		planOnly: boolean;
		forceAssetGeneration: boolean;
		personaIdentity?: PersonaIdentity | null;
	},
): string {
	const baseSkillPrompt = buildChatSkillSystemPrompt(input.skill);
	const assistantContractPrompt = buildPublicChatBaseSystemPrompt({
		forceAssetGeneration: input.forceAssetGeneration,
		personaIdentity: input.personaIdentity,
	});
	const responsePolicyPrompt = buildPublicChatResponsePolicyPrompt();
	const turnBriefing = buildPublicChatContextFragment(input);
	return [
		baseSkillPrompt,
		assistantContractPrompt,
		responsePolicyPrompt,
		turnBriefing,
	]
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

export function hasPublicChatExecutionContext(
	input: PublicChatPromptContext,
): boolean {
	const hasSkillSelection =
		Boolean(input.skill?.key?.trim()) ||
		Boolean(input.skill?.name?.trim());
	return (
		hasSkillSelection ||
		(Boolean(input.currentBookId?.trim()) &&
			Boolean(input.currentChapterId?.trim())) ||
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

export function buildPersonaContextPrompt(input: {
	files: PersonaContextFile[];
	workspaceRoot: string;
}): string {
	if (input.files.length === 0) return "";
	const sections = [
		"## Workspace Context",
		`workspaceRoot: ${input.workspaceRoot}`,
		"以下文件为本次运行的稳定上下文，优先视为项目事实与约束：",
	];
	for (const file of input.files) {
		sections.push(`### ${file.name} (${file.path})`);
		sections.push(file.content);
	}
	sections.push(buildPersonaDirectivePrompt(input.files));
	return sections.filter(Boolean).join("\n\n").trim();
}

export function extractPersonaIdentity(files: PersonaContextFile[]): PersonaIdentity {
	const identityFile = files.find((file) => file.name === "IDENTITY.md");
	if (!identityFile) {
		return { name: null, product: null, role: null };
	}
	return {
		name: extractIdentityField(identityFile.content, "Name"),
		product: extractIdentityField(identityFile.content, "Product"),
		role: extractIdentityField(identityFile.content, "Role"),
	};
}

function extractIdentityField(content: string, field: "Name" | "Product" | "Role"): string | null {
	const pattern = new RegExp(`^-\\s*${field}:\\s*(.+)$`, "mi");
	const match = pattern.exec(content);
	return match?.[1]?.trim() || null;
}

function buildPersonaDirectivePrompt(files: PersonaContextFile[]): string {
	const hasIdentity = files.some((file) => file.name === "IDENTITY.md");
	const hasSoul = files.some((file) => file.name === "SOUL.md");
	if (!hasIdentity && !hasSoul) return "";
	const lines = ["## Persona Directives"];
	if (hasIdentity) {
		lines.push(
			"如果 IDENTITY.md 已加载，你必须采用其中定义的名字、角色、自我定位与语言风格，不要擅自切换身份或自称其他名字。",
		);
	}
	if (hasSoul) {
		lines.push(
			"如果 SOUL.md 已加载，你必须体现其中定义的价值观、边界、协作方式与语气。避免僵硬、泛化、客服式回复。",
		);
	}
	if (hasIdentity && hasSoul) {
		lines.push("IDENTITY.md 定义你是谁；SOUL.md 定义你如何判断、如何行动。两者都应持续生效。");
	}
	return lines.join("\n");
}

export function resolvePersonaWorkspaceRoot(files: PersonaContextFile[]): string {
	return files[0]?.path.includes("apps/agents-cli")
		? path.resolve(process.cwd(), "apps/agents-cli")
		: process.cwd();
}

export function resolvePersonaRootCandidates(cwd: string): string[] {
	const start = path.resolve(cwd);
	const roots: string[] = [];
	const seen = new Set<string>();
	const pushRoot = (candidate: string) => {
		const normalized = path.resolve(candidate);
		if (seen.has(normalized)) return;
		seen.add(normalized);
		roots.push(normalized);
	};
	pushRoot("/workspace/apps/agents-cli");
	pushRoot("/workspace");
	let cursor = start;
	for (let depth = 0; depth < 5; depth += 1) {
		pushRoot(cursor);
		pushRoot(path.join(cursor, "apps/agents-cli"));
		pushRoot(path.join(cursor, "agents-cli"));
		const parent = path.resolve(cursor, "..");
		if (parent === cursor) break;
		cursor = parent;
	}
	return roots;
}

export async function loadPersonaContextFiles(): Promise<PersonaContextFile[]> {
	const roots = resolvePersonaRootCandidates(process.cwd());
	const files: PersonaContextFile[] = [];
	let totalChars = 0;
	for (const root of roots) {
		for (const name of PERSONA_FILE_NAMES) {
			if (files.some((file) => file.name === name)) continue;
			const filePath = path.join(root, name);
			let content = "";
			try {
				content = (await fs.readFile(filePath, "utf-8")).trim();
			} catch {
				continue;
			}
			if (!content) continue;
			const remaining = Math.max(0, MAX_PERSONA_TOTAL_CHARS - totalChars);
			const budget = Math.min(MAX_PERSONA_CHARS_PER_FILE, remaining);
			if (budget <= 0) return files;
			const truncated =
				content.length > budget ? `${content.slice(0, budget - 1).trimEnd()}…` : content;
			totalChars += truncated.length;
			files.push({
				name,
				path: path.relative(process.cwd(), filePath) || name,
				content: truncated,
			});
		}
	}
	return files;
}
