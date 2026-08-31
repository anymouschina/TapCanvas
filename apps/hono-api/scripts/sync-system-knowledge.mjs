import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
	loadCompiledKnowledgeAsset,
	pgvectorDimensionsFromTypmod,
} from "./lib/system-knowledge-sync.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const knowledgeRoot = path.join(repositoryRoot, "apps/agents-cli/knowledge");
const SOURCE_ROOT = "builtin:agents-cli/knowledge";
const BUILTIN_ASSETS = [{
	cardRelativePath: "视听语言演出/action-physics-clean-blocking.md",
	vectorRelativePath: ".vectors/action-physics-clean-blocking.json",
}];

function vectorLiteral(values) {
	if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
		throw new Error("Compiled knowledge vector contains a non-finite value");
	}
	return `[${values.join(",")}]`;
}

const assets = await Promise.all(BUILTIN_ASSETS.map((asset) => loadCompiledKnowledgeAsset({
	knowledgeRoot,
	...asset,
})));
const prisma = new PrismaClient();
try {
	let changed = 0;
	for (const asset of assets) {
		const existing = await prisma.$queryRaw`
			SELECT content_sha256, embedding_model, vector_dims(embedding) AS dimensions
			FROM agent_knowledge_vectors
			WHERE source_root = ${SOURCE_ROOT} AND card_id = ${asset.card.id}
			LIMIT 1
		`;
		const existingRow = existing[0];
		if (existingRow) {
			if (
				existingRow.content_sha256 !== asset.contentSha256
				|| existingRow.embedding_model !== asset.embeddingModel
				|| Number(existingRow.dimensions) !== asset.dimensions
			) {
				throw new Error(`Built-in knowledge card identity collision: ${asset.card.id}`);
			}
			continue;
		}
		const column = await prisma.$queryRaw`
			SELECT atttypmod AS dimensions
			FROM pg_attribute
			WHERE attrelid = 'agent_knowledge_vectors'::regclass AND attname = 'embedding'
		`;
		const columnDimensions = pgvectorDimensionsFromTypmod(column[0]?.dimensions);
		if (columnDimensions !== asset.dimensions) {
			throw new Error(`Knowledge vector schema mismatch: column=${columnDimensions} compiled=${asset.dimensions}`);
		}
		const roleScope = JSON.stringify(asset.card.roleScope);
		const keywords = JSON.stringify(asset.card.keywords);
		const sourceUrls = JSON.stringify(asset.card.sourceUrls);
		const embedding = vectorLiteral(asset.embedding);
		const affected = await prisma.$executeRaw`
			INSERT INTO agent_knowledge_vectors (
				source_root, card_id, content_sha256, embedding_model,
				source_path, domain, facet, title, role_scope, keywords, source_urls,
				body, embedding, updated_at
			) VALUES (
				${SOURCE_ROOT}, ${asset.card.id}, ${asset.contentSha256}, ${asset.embeddingModel},
				${asset.card.sourcePath}, ${asset.card.domain}, ${asset.card.facet}, ${asset.card.title},
				${roleScope}::jsonb, ${keywords}::jsonb, ${sourceUrls}::jsonb,
				${asset.card.body}, ${embedding}::vector, NOW()
			)
			ON CONFLICT (source_root, card_id) DO NOTHING
		`;
		if (affected !== 1) throw new Error(`Built-in knowledge card insert raced with another writer: ${asset.card.id}`);
		changed += affected;
	}
	console.log(`System knowledge sync complete: total=${assets.length} changed=${changed} reused=${assets.length - changed}`);
} finally {
	await prisma.$disconnect();
}
