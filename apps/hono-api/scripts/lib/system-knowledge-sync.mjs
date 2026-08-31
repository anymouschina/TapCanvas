import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const KNOWLEDGE_ROLES = new Set(["director", "storyboard", "generation", "editor", "post", "qa"]);
const COMPILED_VECTOR_PROTOCOL = "tapcanvas.compiled-knowledge-vector/v1";

export function pgvectorDimensionsFromTypmod(value) {
	const dimensions = Number(value);
	if (!Number.isSafeInteger(dimensions) || dimensions < 1) {
		throw new Error(`Knowledge vector typmod is invalid: ${String(value)}`);
	}
	return dimensions;
}

function parseScalarOrArray(raw) {
	const value = String(raw || "").trim();
	if (!value) return [];
	const content = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
	return content.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseFrontmatter(block) {
	const fields = {};
	for (const line of block.split(/\r?\n/u)) {
		const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/u);
		if (match) fields[match[1].trim()] = match[2].trim();
	}
	return fields;
}

function deriveTitle(fields, body, id) {
	if (fields.title?.trim()) return fields.title.trim();
	for (const line of body.split(/\r?\n/u)) {
		const title = line.replace(/^#+\s*/u, "").trim();
		if (title) return title;
	}
	return fields.facet?.trim() || id;
}

export function parseKnowledgeCard(content, filePath, knowledgeRoot) {
	const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/u);
	if (!match) throw new Error(`Knowledge card frontmatter is invalid: ${filePath}`);
	const fields = parseFrontmatter(match[1]);
	const body = match[2].trim();
	const id = fields.id?.trim() || path.basename(filePath, ".md");
	const roleScope = parseScalarOrArray(fields.roleScope);
	const invalidRoles = roleScope.filter((role) => !KNOWLEDGE_ROLES.has(role));
	if (invalidRoles.length > 0) throw new Error(`Knowledge card has invalid roles: ${invalidRoles.join(", ")}`);
	const relativePath = path.relative(knowledgeRoot, filePath).replaceAll(path.sep, "/");
	if (!relativePath || relativePath.startsWith("../")) throw new Error(`Knowledge card is outside its root: ${filePath}`);
	return {
		id,
		domain: String(fields.domain || "").trim(),
		facet: fields.facet?.trim() || null,
		title: deriveTitle(fields, body, id),
		roleScope,
		keywords: parseScalarOrArray(fields.keywords),
		sourceUrls: parseScalarOrArray(fields.sourceUrls),
		body,
		sourcePath: `/apps/agents-cli/knowledge/${relativePath}`,
	};
}

export function cardContentForEmbedding(card) {
	return [
		`title: ${card.title}`,
		`domain: ${card.domain}`,
		`facet: ${card.facet ?? ""}`,
		`roleScope: ${card.roleScope.join(", ")}`,
		`keywords: ${card.keywords.join(", ")}`,
		`sourceUrls: ${card.sourceUrls.join(", ")}`,
		"body:",
		card.body,
	].join("\n");
}

export function cardContentSha256(card) {
	return crypto.createHash("sha256").update(cardContentForEmbedding(card), "utf8").digest("hex");
}

function decodeFloat32Vector(compiled) {
	if (compiled.encoding !== "base64-float32-le") throw new Error(`Unsupported vector encoding: ${compiled.encoding}`);
	const bytes = Buffer.from(String(compiled.embeddingBase64 || ""), "base64");
	if (bytes.byteLength !== compiled.dimensions * 4) {
		throw new Error(`Compiled vector byte length mismatch: expected=${compiled.dimensions * 4} actual=${bytes.byteLength}`);
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return Array.from({ length: compiled.dimensions }, (_, index) => view.getFloat32(index * 4, true));
}

export async function loadCompiledKnowledgeAsset({ knowledgeRoot, cardRelativePath, vectorRelativePath }) {
	const cardPath = path.resolve(knowledgeRoot, cardRelativePath);
	const vectorPath = path.resolve(knowledgeRoot, vectorRelativePath);
	const [cardContent, vectorContent] = await Promise.all([
		fs.readFile(cardPath, "utf8"),
		fs.readFile(vectorPath, "utf8"),
	]);
	const card = parseKnowledgeCard(cardContent, cardPath, knowledgeRoot);
	const compiled = JSON.parse(vectorContent);
	if (compiled.protocolVersion !== COMPILED_VECTOR_PROTOCOL) throw new Error("Compiled knowledge vector protocol is invalid");
	if (compiled.cardId !== card.id) throw new Error(`Compiled vector card mismatch: ${compiled.cardId} != ${card.id}`);
	const contentSha256 = cardContentSha256(card);
	if (compiled.contentSha256 !== contentSha256) {
		throw new Error(`Compiled knowledge vector is stale: card=${card.id} expected=${contentSha256} actual=${compiled.contentSha256}`);
	}
	if (!Number.isInteger(compiled.dimensions) || compiled.dimensions < 1) throw new Error("Compiled knowledge vector dimensions are invalid");
	if (typeof compiled.embeddingModel !== "string" || !compiled.embeddingModel.trim()) throw new Error("Compiled knowledge vector model is missing");
	return {
		card,
		contentSha256,
		embeddingModel: compiled.embeddingModel.trim(),
		dimensions: compiled.dimensions,
		embedding: decodeFloat32Vector(compiled),
	};
}
