// 【导演人格池（作者导演美学）只读目录】
//
// 单一真相源 = apps/agents-cli/knowledge/作者导演美学/*.md 知识卡（learn-domain 学习模式沉淀，
// 小T 各角色经 knowledge_search 检索的同一批卡）。本模块只做两件事：
// ① 扫描该目录的 frontmatter，给 web「选导演」下拉提供 {id, name, description, keywords} 列表；
// ② 为 agents-bridge 生成「导演人格·项目级锁定」事实块——只声明"用户已选定谁"，不规定
//    knowledge_search、Skill 或固定工作流。是否需要读取该卡必须由 agents 依据本轮用户诉求决定。
//
// 目录解析顺序：AGENTS_KNOWLEDGE_ROOT env → /workspace/apps/agents-cli/knowledge（docker api 挂载，
// 见 docker-compose.yml `../agents-cli:/workspace/apps/agents-cli`）→ 本机开发相对路径。

import { promises as fs } from "node:fs";
import path from "node:path";

export type DirectorPersonaSummary = {
	/** 卡 id = 文件名（不含 .md），如 stephen-chow / king-hu */
	id: string;
	/** 展示名 = facet 首段（「·」前），如 周星驰视觉语法锁 */
	name: string;
	/** facet 余段作一句话简介 */
	description: string;
	keywords: string[];
};

const PERSONA_DOMAIN_DIR = "作者导演美学";
const CACHE_TTL_MS = 60_000;

let cached: { at: number; root: string | null; list: DirectorPersonaSummary[] } | null = null;

async function isDir(p: string): Promise<boolean> {
	try {
		return (await fs.stat(p)).isDirectory();
	} catch {
		return false;
	}
}

async function resolveKnowledgeRoot(): Promise<string | null> {
	const candidates = [
		String(process.env.AGENTS_KNOWLEDGE_ROOT ?? "").trim(),
		"/workspace/apps/agents-cli/knowledge",
		path.resolve(process.cwd(), "../agents-cli/knowledge"),
		path.resolve(process.cwd(), "../../apps/agents-cli/knowledge"),
	].filter(Boolean);
	for (const root of candidates) {
		if (await isDir(path.join(root, PERSONA_DOMAIN_DIR))) return root;
	}
	return null;
}

function parseFrontmatterField(front: string, field: string): string {
	const m = front.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
	return m ? m[1].trim() : "";
}

function parseKeywords(front: string): string[] {
	const raw = parseFrontmatterField(front, "keywords");
	const inner = raw.replace(/^\[/, "").replace(/\]$/, "");
	return inner
		.split(/[,，]/)
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 24);
}

/** 列出导演人格池（60s TTL 缓存；目录不存在时返回空列表不抛错）。 */
export async function listDirectorPersonas(): Promise<DirectorPersonaSummary[]> {
	const now = Date.now();
	if (cached && now - cached.at < CACHE_TTL_MS) return cached.list;

	const root = await resolveKnowledgeRoot();
	if (!root) {
		cached = { at: now, root: null, list: [] };
		return [];
	}
	const dir = path.join(root, PERSONA_DOMAIN_DIR);
	const list: DirectorPersonaSummary[] = [];
	try {
		const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md")).sort();
		for (const file of files) {
			try {
				const raw = await fs.readFile(path.join(dir, file), "utf8");
				const fm = raw.match(/^---\n([\s\S]*?)\n---/);
				const front = fm ? fm[1] : "";
				const facet = parseFrontmatterField(front, "facet");
				const id = file.replace(/\.md$/, "");
				const segments = facet.split("·");
				const name = (segments[0] || id).trim();
				const description = segments.slice(1).join("·").trim();
				list.push({ id, name, description, keywords: parseKeywords(front) });
			} catch {
				/* 单卡坏了跳过，别拖垮整个列表 */
			}
		}
	} catch {
		/* 目录读失败按空池处理 */
	}
	cached = { at: now, root, list };
	return list;
}

/**
 * 生成「导演人格·项目级锁定」上下文块（用户在画布上选定后注入每轮对话）。
 * 这里只传递用户已经在项目状态中选定的事实，不把它变成运行时知识装配指令。
 * 如果本轮请求确实需要导演人格事实，agents 会把本轮用户原始请求作为第一检索视图，
 * 再自行召回并选择对应知识卡；如果用户本轮问的是别的事，则不应读取该卡。
 */
export function buildDirectorPersonaContextBlock(persona: {
	personaId: string;
	personaName: string;
}): string {
	const id = persona.personaId.trim();
	const name = persona.personaName.trim() || id;
	return [
		"【导演人格·项目级锁定（用户在画布上选定）】",
		`本项目导演人格 = 「${name}」（知识卡：作者导演美学/${id}）。`,
		"这是项目状态事实，不是本轮必须读取的知识卡，也不覆盖用户本轮具体诉求。",
		"仅当本轮交付确实需要该导演人格的事实时，才基于当前用户请求进行知识候选召回与选择；",
		"用户本轮未要求相关内容时，不要因为项目存在导演人格就自动加载作者导演美学知识。",
	].join("\n");
}
