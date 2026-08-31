import fs from "node:fs/promises";
import path from "node:path";
import { upsertBookIndex, type BookIndexRecord } from "../asset/book-index-store";
import { resolveProjectDataRepoRoot } from "../asset/project-data-root";

function sanitizePathSegment(raw: string): string {
	return String(raw || "")
		.trim()
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.slice(0, 120);
}

function buildCanvasBookDir(projectId: string, userId: string): string {
	const repoRoot = resolveProjectDataRepoRoot();
	return path.join(
		repoRoot,
		"project-data",
		"users",
		sanitizePathSegment(userId),
		"projects",
		sanitizePathSegment(projectId),
		"books",
		sanitizePathSegment(projectId),
	);
}

function readTrimmedString(value: unknown, max = 0): string {
	if (typeof value !== "string") return "";
	const s = value.trim();
	return max > 0 && s.length > max ? s.slice(0, max) : s;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TEXT_NODE_KINDS = new Set(["text", "novelDoc", "scriptDoc"]);

type CanvasTextNode = {
	nodeId: string;
	title: string;
	content: string;
	order: number;
	x: number;
	y: number;
};

function extractTextNodes(flowData: unknown): CanvasTextNode[] {
	if (!isRecord(flowData)) return [];
	const nodes = Array.isArray(flowData.nodes) ? flowData.nodes : [];
	const candidates: Array<Omit<CanvasTextNode, "order">> = [];
	for (const raw of nodes) {
		if (!isRecord(raw)) continue;
		// 支持 taskNode type
		const type = readTrimmedString(raw.type);
		if (type && type !== "taskNode") continue;
		const data = isRecord(raw.data) ? raw.data : {};
		const kind = readTrimmedString(data.kind);
		if (!TEXT_NODE_KINDS.has(kind)) continue;
		// 提取正文内容：novelDoc/scriptDoc 优先 data.content，text 优先 data.prompt
		const content =
			kind === "text"
				? readTrimmedString(data.prompt) || readTrimmedString(data.content)
				: readTrimmedString(data.content) || readTrimmedString(data.prompt);
		if (!content) continue; // 空内容节点跳过
		const title =
			readTrimmedString(data.label) ||
			readTrimmedString(data.title) ||
			readTrimmedString(raw.id as string, 20) ||
			"无标题";
		const pos = isRecord(raw.position) ? raw.position : {};
		candidates.push({
			nodeId: readTrimmedString(raw.id as string),
			title,
			content,
			x: typeof pos.x === "number" ? pos.x : 0,
			y: typeof pos.y === "number" ? pos.y : 0,
		});
	}
	// 按 y 升序（同 y 按 x 升序）决定章节顺序
	candidates.sort((a, b) => a.y - b.y || a.x - b.x);
	return candidates.map((n, i) => ({ ...n, order: i + 1 }));
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
	const dir = path.dirname(filePath);
	await fs.mkdir(dir, { recursive: true });
	const tmp = `${filePath}.tmp`;
	await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
	await fs.rename(tmp, filePath);
}

export type CanvasBookSyncResult = {
	synced: number;
	deleted: number;
};

export async function syncCanvasBookFromFlow(input: {
	projectId: string;
	userId: string;
	projectName?: string;
	flowData: unknown;
	nowIso: string;
}): Promise<CanvasBookSyncResult> {
	const { projectId, userId, projectName, flowData, nowIso } = input;
	const bookDir = buildCanvasBookDir(projectId, userId);
	const chaptersDir = path.join(bookDir, "chapters");

	const textNodes = extractTextNodes(flowData);
	const currentNodeIds = new Set(textNodes.map((n) => n.nodeId));

	// 读现有章节文件，找出需要删除的（节点已不存在）
	let deleted = 0;
	try {
		const existing = await fs.readdir(chaptersDir);
		for (const fname of existing) {
			if (!fname.endsWith(".json")) continue;
			const nodeId = fname.slice(0, -5); // strip .json
			if (!currentNodeIds.has(nodeId)) {
				await fs.unlink(path.join(chaptersDir, fname)).catch(() => {});
				deleted += 1;
			}
		}
	} catch {
		// chaptersDir 不存在时忽略
	}

	// 写入或更新每个章节文件
	let synced = 0;
	for (const node of textNodes) {
		const chapterFile = path.join(chaptersDir, `${sanitizePathSegment(node.nodeId)}.json`);
		const chapterData = {
			nodeId: node.nodeId,
			chapterId: node.nodeId,
			chapter: node.order,
			title: node.title,
			content: node.content,
			order: node.order,
			source: "canvas",
			updatedAt: nowIso,
		};
		await atomicWriteJson(chapterFile, chapterData);
		synced += 1;
	}

	// 写入 index.json
	const indexData = {
		bookId: projectId,
		projectId,
		title: projectName || projectId,
		source: "canvas",
		chapterCount: textNodes.length,
		updatedAt: nowIso,
		chapters: textNodes.map((n) => ({
			chapter: n.order,
			nodeId: n.nodeId,
			title: n.title,
			contentFile: `chapters/${sanitizePathSegment(n.nodeId)}.json`,
			// 保留 offset 字段防止旧版代码解析崩溃
			startOffset: 0,
			endOffset: 0,
			length: n.content.length,
		})),
	};
	await upsertBookIndex(path.join(bookDir, "index.json"), {
		create: () => ({ next: indexData, result: null }),
		update: (current) => {
			const next: BookIndexRecord = {
				...current,
				title: indexData.title,
				source: indexData.source,
				chapterCount: indexData.chapterCount,
				chapters: indexData.chapters,
				updatedAt: indexData.updatedAt,
			};
			return { next, result: null };
		},
	});

	return { synced, deleted };
}
