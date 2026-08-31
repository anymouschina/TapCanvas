#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const marketplaceRoot = path.resolve(scriptDirectory, "../marketplace-skills");
const apply = process.argv.includes("--apply");
const categories = new Set([
	"图像创作",
	"视频创作",
	"音频配音",
	"文案脚本",
	"故事小说",
	"角色设定",
	"电商营销",
	"社媒运营",
	"效率工具",
	"其他",
]);

function requireString(value, field, key) {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Marketplace Skill ${key || "catalog"} requires ${field}`);
	}
	return value.trim();
}

function resolveMarketplaceLogoUrl(logoKey) {
	const provider = requireString(process.env.OBJECT_STORAGE_PROVIDER, "OBJECT_STORAGE_PROVIDER").toLowerCase();
	if (provider !== "tos" && provider !== "r2") {
		throw new Error("OBJECT_STORAGE_PROVIDER must be either tos or r2");
	}
	const publicBaseKey = provider === "tos" ? "TOS_PUBLIC_BASE_URL" : "R2_PUBLIC_BASE_URL";
	const publicBase = requireString(process.env[publicBaseKey], publicBaseKey).replace(/\/+$/, "");
	const parsedPublicBase = new URL(publicBase);
	if (parsedPublicBase.protocol !== "https:") throw new Error(`${publicBaseKey} must use HTTPS`);
	const normalizedKey = logoKey.replace(/^\/+/, "");
	const providerKey = provider === "tos" ? `tapcanvas/legacy/${normalizedKey}` : normalizedKey;
	return `${publicBase}/${providerKey}`;
}

function readFrontmatterName(content, filePath) {
	const lines = content.replaceAll("\r\n", "\n").split("\n");
	if (lines[0] !== "---") throw new Error(`Skill frontmatter missing: ${filePath}`);
	for (let index = 1; index < lines.length; index += 1) {
		const line = lines[index];
		if (line === "---") break;
		if (!line.startsWith("name:")) continue;
		return line.slice("name:".length).trim().replace(/^['"]|['"]$/g, "");
	}
	throw new Error(`Skill frontmatter name missing: ${filePath}`);
}

function assertSquare2kPng(buffer, filePath) {
	const pngSignature = "89504e470d0a1a0a";
	if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== pngSignature) {
		throw new Error(`Marketplace Skill Logo must be a PNG: ${filePath}`);
	}
	const width = buffer.readUInt32BE(16);
	const height = buffer.readUInt32BE(20);
	if (width !== height || width < 2048) {
		throw new Error(`Marketplace Skill Logo must be square and at least 2K: ${filePath} (${width}x${height})`);
	}
}

async function loadCatalog() {
	const catalogPath = path.join(marketplaceRoot, "catalog.json");
	const parsed = JSON.parse(await fs.readFile(catalogPath, "utf8"));
	if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Marketplace Skill catalog must be a non-empty array");
	const keys = new Set();
	const items = [];
	for (const raw of parsed) {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Marketplace Skill catalog item must be an object");
		const key = requireString(raw.key, "key");
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) throw new Error(`Marketplace Skill key is invalid: ${key}`);
		if (keys.has(key)) throw new Error(`Marketplace Skill key is duplicated: ${key}`);
		keys.add(key);
		const title = requireString(raw.title, "title", key);
		const description = requireString(raw.description, "description", key);
		const category = requireString(raw.category, "category", key);
		if (!categories.has(category)) throw new Error(`Marketplace Skill ${key} has unsupported category: ${category}`);
		const priceCredits = Number(raw.priceCredits);
		if (!Number.isSafeInteger(priceCredits) || priceCredits < 1 || priceCredits > 10_000_000) {
			throw new Error(`Marketplace Skill ${key} has invalid priceCredits`);
		}
		const logoFile = requireString(raw.logoFile, "logoFile", key);
		const logoPath = path.join(marketplaceRoot, key, logoFile);
		assertSquare2kPng(await fs.readFile(logoPath), logoPath);
		const logoKey = requireString(raw.logoKey, "logoKey", key);
		const logoUrl = resolveMarketplaceLogoUrl(logoKey);
		const filePath = path.join(marketplaceRoot, key, "SKILL.md");
		const content = await fs.readFile(filePath, "utf8");
		if (!content.trim() || Buffer.byteLength(content, "utf8") > 200_000) throw new Error(`Marketplace Skill content size is invalid: ${key}`);
		if (readFrontmatterName(content, filePath) !== key) throw new Error(`Marketplace Skill frontmatter name must equal catalog key: ${key}`);
		items.push({ key, title, description, category, priceCredits, content, logoUrl });
	}
	return items;
}

function personalTeamId(userId) {
	const safe = userId.trim().replace(/[^a-zA-Z0-9_-]/g, "_");
	if (!safe) throw new Error("COMMERCE_PLATFORM_OWNER_ID is invalid");
	return `personal_${safe}`;
}

if (!apply) {
	const catalog = await loadCatalog();
	console.log(`Dry run: ${catalog.length} marketplace Skills are valid. Re-run with --apply to write PostgreSQL.`);
	for (const item of catalog) console.log(`${item.key}\t${item.category}\t${item.priceCredits} credits`);
	process.exit(0);
}

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const platformOwnerId = String(process.env.COMMERCE_PLATFORM_OWNER_ID || "").trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to sync marketplace Skills");
// The Skill marketplace is an optional storefront: its platform owner is chosen
// by an operator, and a deployment that has not set one up has nothing to sync.
// This script runs in prepare-container-start.mjs, so throwing here fails the
// whole startup and takes the API down over an unconfigured storefront. Skip
// instead — a later start syncs once COMMERCE_PLATFORM_OWNER_ID is set. A value
// that is set but wrong still fails loudly below.
if (!platformOwnerId) {
	console.log(
		"[skill-marketplace] skipped: COMMERCE_PLATFORM_OWNER_ID is not set (set it to publish the marketplace catalog)",
	);
	process.exit(0);
}

const catalog = await loadCatalog();

const prisma = new PrismaClient();
try {
	const owner = await prisma.users.findUnique({ where: { id: platformOwnerId }, select: { id: true } });
	if (!owner) throw new Error("COMMERCE_PLATFORM_OWNER_ID does not reference an existing user");
	const now = new Date().toISOString();
	const teamId = personalTeamId(platformOwnerId);
	const currentTeam = await prisma.teams.findUnique({ where: { id: teamId }, select: { id: true } });
	if (!currentTeam) {
		await prisma.teams.create({ data: { id: teamId, name: "个人账户", credits: 0, credits_frozen: 0, max_members: 1, created_at: now, updated_at: now } });
	}
	await prisma.team_memberships.upsert({
		where: { team_id_user_id: { team_id: teamId, user_id: platformOwnerId } },
		create: { team_id: teamId, user_id: platformOwnerId, role: "owner", created_at: now, updated_at: now },
		update: { role: "owner", updated_at: now },
	});
	let merchant = await prisma.merchants.findUnique({ where: { owner_id: platformOwnerId }, select: { id: true } });
	if (!merchant) {
		merchant = await prisma.merchants.create({
			data: { id: `skill-marketplace-merchant:${platformOwnerId}`, owner_id: platformOwnerId, name: "TapCanvas Skill Marketplace", status: "active", created_at: now, updated_at: now },
			select: { id: true },
		});
	}
	await prisma.$transaction(catalog.flatMap((item) => {
		const assetId = `official-marketplace-asset:${item.key}`;
		const productId = `official-marketplace-product:${item.key}`;
		const entitlementId = `official-marketplace-entitlement:${item.key}`;
		const fileName = `${item.key}.md`;
		const sizeBytes = Buffer.byteLength(item.content, "utf8");
		const sha256 = crypto.createHash("sha256").update(item.content, "utf8").digest("hex");
		const configJson = JSON.stringify({
			sourceType: "user_asset",
			skillId: `marketplace:${item.key}`,
			skillName: item.title,
			description: item.description,
			logoUrl: item.logoUrl,
			sellerUserId: platformOwnerId,
			sourceAssetId: assetId,
			createdAt: now,
			category: item.category,
			firstParty: true,
		});
		return [
			prisma.products.upsert({
				where: { id: productId },
				create: { id: productId, owner_id: platformOwnerId, merchant_id: merchant.id, title: item.title, subtitle: item.category, description: item.description, currency: "CREDITS", price_cents: item.priceCredits, stock: 999_999, status: "active", cover_image_url: item.logoUrl, created_at: now, updated_at: now },
				update: { owner_id: platformOwnerId, merchant_id: merchant.id, title: item.title, subtitle: item.category, description: item.description, currency: "CREDITS", price_cents: item.priceCredits, stock: 999_999, status: "active", cover_image_url: item.logoUrl, updated_at: now },
			}),
			prisma.user_skill_assets.upsert({
				where: { id: assetId },
				create: { id: assetId, owner_id: platformOwnerId, file_name: fileName, name: item.title, description: item.description, content: item.content, logo_url: item.logoUrl, force_full_context: 0, size_bytes: sizeBytes, sha256, marketplace_product_id: productId, marketplace_price_cents: item.priceCredits, marketplace_currency: "CREDITS", marketplace_listed_at: now, source_marketplace_product_id: null, created_at: now, updated_at: now },
				update: { owner_id: platformOwnerId, file_name: fileName, name: item.title, description: item.description, content: item.content, logo_url: item.logoUrl, size_bytes: sizeBytes, sha256, marketplace_product_id: productId, marketplace_price_cents: item.priceCredits, marketplace_currency: "CREDITS", marketplace_listed_at: now, source_marketplace_product_id: null, updated_at: now },
			}),
			prisma.product_entitlements.upsert({
				where: { id: entitlementId },
				create: { id: entitlementId, product_id: productId, owner_id: platformOwnerId, entitlement_type: "skill_license", config_json: configJson, created_at: now, updated_at: now },
				update: { product_id: productId, owner_id: platformOwnerId, entitlement_type: "skill_license", config_json: configJson, updated_at: now },
			}),
		];
	}));
	console.log(`Marketplace Skill sync complete: total=${catalog.length} owner=${platformOwnerId}`);
} finally {
	await prisma.$disconnect();
}
