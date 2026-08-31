import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	loadCompiledKnowledgeAsset,
	pgvectorDimensionsFromTypmod,
} from "./lib/system-knowledge-sync.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const knowledgeRoot = path.resolve(scriptDirectory, "../../agents-cli/knowledge");

test("compiled fighting knowledge vector matches its source card", async () => {
	const asset = await loadCompiledKnowledgeAsset({
		knowledgeRoot,
		cardRelativePath: "视听语言演出/action-physics-clean-blocking.md",
		vectorRelativePath: ".vectors/action-physics-clean-blocking.json",
	});
	assert.equal(asset.card.id, "action-physics-clean-blocking");
	assert.equal(asset.card.title, "动作设计·物理合理性·干净利落的动作链");
	assert.equal(asset.contentSha256, "fdbb6e22e163ce107dbb2e3b9da27251bc8b9eca16023cd62fd02486f9d9a37f");
	assert.equal(asset.embeddingModel, "doubao-embedding-vision-251215");
	assert.equal(asset.dimensions, 2048);
	assert.equal(asset.embedding.length, 2048);
	assert.equal(asset.embedding.every(Number.isFinite), true);
});

test("reads pgvector dimensions directly from pg_attribute typmod", () => {
	assert.equal(pgvectorDimensionsFromTypmod(2048), 2048);
	assert.equal(pgvectorDimensionsFromTypmod("2048"), 2048);
	assert.throws(
		() => pgvectorDimensionsFromTypmod(0),
		/Knowledge vector typmod is invalid/u,
	);
});
