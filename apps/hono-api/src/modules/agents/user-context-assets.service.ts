import crypto from "node:crypto";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { AppError } from "../../middleware/error";
import { getPrismaClient } from "../../platform/node/prisma";
import type {
	CreateUserContextAssetRequestDto,
	UpdateUserContextAssetRequestDto,
	UserContextAssetDto,
} from "./agents.schemas";

const MAX_USER_CONTEXT_ASSETS = 64;

type UserSkillAssetRow = {
	id: string;
	owner_id: string;
	file_name: string;
	name: string;
	description: string | null;
	content: string;
	logo_url: string | null;
	force_full_context: number;
	size_bytes: number;
	sha256: string;
	marketplace_product_id: string | null;
	marketplace_price_cents: number | null;
	marketplace_currency: string | null;
	marketplace_listed_at: string | null;
	source_marketplace_product_id: string | null;
	created_at: string;
	updated_at: string;
};

type UserSkillAssetMetadataRow = Omit<UserSkillAssetRow, "content">;

const metadataSelect = {
	id: true,
	owner_id: true,
	file_name: true,
	name: true,
	description: true,
	logo_url: true,
	force_full_context: true,
	size_bytes: true,
	sha256: true,
	marketplace_product_id: true,
	marketplace_price_cents: true,
	marketplace_currency: true,
	marketplace_listed_at: true,
	source_marketplace_product_id: true,
	created_at: true,
	updated_at: true,
} as const;

function normalizeOwnerId(userId: string): string {
	const ownerId = userId.trim();
	if (!ownerId) {
		throw new AppError("User context asset owner is missing", {
			status: 401,
			code: "user_context_asset_owner_missing",
		});
	}
	return ownerId;
}

function normalizeMarkdownFileName(fileName: string): string {
	const normalized = fileName.trim();
	const hasControlCharacter = Array.from(normalized).some((character) => {
		const codePoint = character.codePointAt(0) ?? 0;
		return codePoint < 32 || codePoint === 127;
	});
	if (
		!normalized ||
		hasControlCharacter ||
		path.basename(normalized) !== normalized ||
		path.extname(normalized).toLowerCase() !== ".md" ||
		!buildAssetName(normalized)
	) {
		throw new AppError("仅支持上传 .md 文件", {
			status: 400,
			code: "user_context_asset_markdown_required",
			details: { fileName },
		});
	}
	return normalized;
}

function buildAssetName(fileName: string): string {
	return fileName.slice(0, -path.extname(fileName).length).trim();
}

function normalizeAssetName(value: string): string {
	const name = value.trim();
	if (!name) {
		throw new AppError("Skill 标题不能为空", {
			status: 400,
			code: "user_context_asset_name_required",
		});
	}
	return name;
}

function normalizeDescription(value: string | null | undefined): string | null {
	if (value === null || value === undefined) return null;
	return value.trim() || null;
}

function normalizeLogoUrl(value: string | null | undefined): string {
	const logoUrl = typeof value === "string" ? value.trim() : "";
	let protocol = "";
	try {
		protocol = new URL(logoUrl).protocol;
	} catch {
		protocol = "";
	}
	if (!logoUrl || (protocol !== "https:" && protocol !== "http:")) {
		throw new AppError("请先上传 Skill Logo", {
			status: 400,
			code: "user_context_asset_logo_required",
		});
	}
	return logoUrl;
}

function buildMarketplaceListing(row: UserSkillAssetMetadataRow): UserContextAssetDto["marketplaceListing"] {
	const listingFields = [
		row.marketplace_product_id,
		row.marketplace_price_cents,
		row.marketplace_currency,
		row.marketplace_listed_at,
	];
	if (listingFields.every((value) => value === null)) return null;
	if (
		!row.marketplace_product_id ||
		typeof row.marketplace_price_cents !== "number" ||
		!row.marketplace_currency ||
		!row.marketplace_listed_at
	) {
		throw new AppError("Skill 商城上架元数据不完整", {
			status: 500,
			code: "user_context_asset_marketplace_listing_invalid",
			details: { assetId: row.id },
		});
	}
	if (row.marketplace_currency !== "CREDITS") {
		throw new AppError("Skill 商城只支持站内积分交易", {
			status: 500,
			code: "user_context_asset_marketplace_currency_invalid",
			details: { assetId: row.id, currency: row.marketplace_currency },
		});
	}
	return {
		productId: row.marketplace_product_id,
		priceCredits: row.marketplace_price_cents,
		listedAt: row.marketplace_listed_at,
	};
}

function toDto(row: UserSkillAssetMetadataRow): UserContextAssetDto {
	return {
		id: row.id,
		kind: "skill",
		fileName: row.file_name,
		name: row.name,
		description: row.description,
		logoUrl: row.logo_url,
		sizeBytes: row.size_bytes,
		sha256: row.sha256,
		marketplaceListing: buildMarketplaceListing(row),
		sourceMarketplaceProductId: row.source_marketplace_product_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function assertVerifiedContent(row: UserSkillAssetRow): string {
	const digest = crypto.createHash("sha256").update(row.content, "utf8").digest("hex");
	const sizeBytes = Buffer.byteLength(row.content, "utf8");
	if (digest !== row.sha256 || sizeBytes !== row.size_bytes) {
		throw new AppError("用户上下文资产正文与元数据不一致", {
			status: 500,
			code: "user_context_asset_integrity_mismatch",
			details: { assetId: row.id, fileName: row.file_name },
		});
	}
	return row.content;
}

function notFoundError(): AppError {
	return new AppError("未找到用户上下文资产", {
		status: 404,
		code: "user_context_asset_not_found",
	});
}

function throwCreateError(error: unknown, fileName: string): never {
	if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
		throw new AppError("已存在同名 Skill Markdown 文件", {
			status: 409,
			code: "user_context_asset_file_exists",
			details: { fileName },
		});
	}
	throw error;
}

export async function listUserContextAssets(userId: string): Promise<UserContextAssetDto[]> {
	const rows = await getPrismaClient().user_skill_assets.findMany({
		where: { owner_id: normalizeOwnerId(userId) },
		select: metadataSelect,
		orderBy: { created_at: "desc" },
	});
	return rows.map(toDto);
}

export async function createUserContextAsset(
	userId: string,
	input: CreateUserContextAssetRequestDto,
): Promise<UserContextAssetDto> {
	const ownerId = normalizeOwnerId(userId);
	const fileName = normalizeMarkdownFileName(input.fileName);
	const logoUrl = normalizeLogoUrl(input.logoUrl);
	const duplicate = await getPrismaClient().user_skill_assets.findFirst({
		where: { owner_id: ownerId, file_name: fileName },
		select: metadataSelect,
	});
	if (duplicate) {
		if (input.overwrite === true) {
			if (duplicate.source_marketplace_product_id) {
				throw new AppError("商城购买的 Skill 不能被同名上传覆盖", {
					status: 409,
					code: "user_context_asset_purchased_overwrite_forbidden",
				});
			}
			const updated = await getPrismaClient().user_skill_assets.update({
				where: { id: duplicate.id },
				data: {
					name: normalizeAssetName(input.name ?? buildAssetName(fileName)),
					description: normalizeDescription(input.description),
					content: input.content,
					logo_url: logoUrl,
					size_bytes: Buffer.byteLength(input.content, "utf8"),
					sha256: crypto.createHash("sha256").update(input.content, "utf8").digest("hex"),
					updated_at: new Date().toISOString(),
				},
				select: metadataSelect,
			});
			return toDto(updated);
		}
		throw new AppError("已存在同名 Skill Markdown 文件", {
			status: 409,
			code: "user_context_asset_file_exists",
			details: { fileName },
		});
	}
	const count = await getPrismaClient().user_skill_assets.count({ where: { owner_id: ownerId } });
	if (count >= MAX_USER_CONTEXT_ASSETS) {
		throw new AppError(`用户上下文资产最多 ${MAX_USER_CONTEXT_ASSETS} 个`, {
			status: 409,
			code: "user_context_asset_limit_reached",
		});
	}
	const now = new Date().toISOString();
	try {
		const row = await getPrismaClient().user_skill_assets.create({
			data: {
				id: crypto.randomUUID(),
				owner_id: ownerId,
				file_name: fileName,
					name: normalizeAssetName(input.name ?? buildAssetName(fileName)),
					description: normalizeDescription(input.description),
				content: input.content,
				logo_url: logoUrl,
				force_full_context: 0,
				size_bytes: Buffer.byteLength(input.content, "utf8"),
				sha256: crypto.createHash("sha256").update(input.content, "utf8").digest("hex"),
				created_at: now,
				updated_at: now,
			},
			select: metadataSelect,
		});
		return toDto(row);
	} catch (error: unknown) {
		throwCreateError(error, fileName);
	}
}

export async function getUserContextAssetContent(
	userId: string,
	assetId: string,
): Promise<UserContextAssetDto & { content: string }> {
	const row = await getPrismaClient().user_skill_assets.findFirst({
		where: { id: assetId, owner_id: normalizeOwnerId(userId) },
	});
	if (!row) throw notFoundError();
	return { ...toDto(row), content: assertVerifiedContent(row) };
}

export async function updateUserContextAsset(
	userId: string,
	assetId: string,
	input: UpdateUserContextAssetRequestDto,
): Promise<UserContextAssetDto> {
	const ownerId = normalizeOwnerId(userId);
	return getPrismaClient().$transaction(async (transaction) => {
		const current = await transaction.user_skill_assets.findFirst({ where: { id: assetId, owner_id: ownerId } });
		if (!current) throw notFoundError();
		if (input.content !== undefined && current.source_marketplace_product_id) {
			throw new AppError("商城购买的 Skill 不能修改指令正文", {
				status: 409,
				code: "user_context_asset_purchased_content_update_forbidden",
			});
		}
		const content = input.content ?? current.content;
		const editsSkillDefinition = input.name !== undefined
			|| input.description !== undefined
			|| input.logoUrl !== undefined
			|| input.content !== undefined;
		const logoUrl = editsSkillDefinition
			? normalizeLogoUrl(input.logoUrl ?? current.logo_url)
			: current.logo_url;
		const updated = await transaction.user_skill_assets.update({
			where: { id: current.id },
			data: {
				...(input.name !== undefined ? { name: normalizeAssetName(input.name) } : {}),
				...(input.description !== undefined ? { description: normalizeDescription(input.description) } : {}),
				...(editsSkillDefinition ? { logo_url: logoUrl } : {}),
				...(input.content !== undefined ? {
					content,
					size_bytes: Buffer.byteLength(content, "utf8"),
					sha256: crypto.createHash("sha256").update(content, "utf8").digest("hex"),
				} : {}),
				updated_at: new Date().toISOString(),
			},
			select: metadataSelect,
		});
		return toDto(updated);
	});
}

export async function deleteUserContextAsset(userId: string, assetId: string): Promise<{ deleted: true }> {
	const current = await getPrismaClient().user_skill_assets.findFirst({
		where: { id: assetId, owner_id: normalizeOwnerId(userId) },
		select: { id: true, marketplace_product_id: true },
	});
	if (!current) throw notFoundError();
	if (current.marketplace_product_id) {
		throw new AppError("请先将 Skill 从商城下架，再卸载", {
			status: 409,
			code: "user_context_asset_listed_delete_forbidden",
		});
	}
	await getPrismaClient().user_skill_assets.delete({ where: { id: current.id } });
	return { deleted: true };
}

export async function updateUserContextAssetMarketplaceListing(
	userId: string,
	assetId: string,
	listing: NonNullable<UserContextAssetDto["marketplaceListing"]>,
): Promise<UserContextAssetDto> {
	const current = await getPrismaClient().user_skill_assets.findFirst({
		where: { id: assetId, owner_id: normalizeOwnerId(userId) },
		select: { id: true },
	});
	if (!current) throw notFoundError();
	const updated = await getPrismaClient().user_skill_assets.update({
		where: { id: current.id },
		data: {
			marketplace_product_id: listing.productId,
			marketplace_price_cents: listing.priceCredits,
			marketplace_currency: "CREDITS",
			marketplace_listed_at: listing.listedAt,
			updated_at: new Date().toISOString(),
		},
		select: metadataSelect,
	});
	return toDto(updated);
}

export async function clearUserContextAssetMarketplaceListing(
	userId: string,
	assetId: string,
): Promise<UserContextAssetDto> {
	const current = await getPrismaClient().user_skill_assets.findFirst({
		where: { id: assetId, owner_id: normalizeOwnerId(userId) },
		select: { id: true },
	});
	if (!current) throw notFoundError();
	const updated = await getPrismaClient().user_skill_assets.update({
		where: { id: current.id },
		data: {
			marketplace_product_id: null,
			marketplace_price_cents: null,
			marketplace_currency: null,
			marketplace_listed_at: null,
			updated_at: new Date().toISOString(),
		},
		select: metadataSelect,
	});
	return toDto(updated);
}

type MarketplaceSkillInstallInput = {
	buyerUserId: string;
	sellerUserId: string;
	sourceAssetId: string;
	productId: string;
	priceCredits: number;
};

export async function installUserContextAssetFromMarketplaceInTransaction(
	transaction: Prisma.TransactionClient,
	input: MarketplaceSkillInstallInput,
): Promise<{ asset: UserContextAssetDto; created: boolean }> {
	const buyerUserId = normalizeOwnerId(input.buyerUserId);
	const installed = await transaction.user_skill_assets.findFirst({
		where: { owner_id: buyerUserId, source_marketplace_product_id: input.productId },
		select: metadataSelect,
	});
	if (installed) return { asset: toDto(installed), created: false };
	const source = await transaction.user_skill_assets.findFirst({
		where: { id: input.sourceAssetId, owner_id: normalizeOwnerId(input.sellerUserId) },
	});
	if (!source) throw notFoundError();
	if (
		source.marketplace_product_id !== input.productId ||
		source.marketplace_currency !== "CREDITS" ||
		source.marketplace_price_cents !== input.priceCredits ||
		!source.marketplace_listed_at
	) {
		throw new AppError("Skill 源资产与积分商城上架记录不一致", {
			status: 409,
			code: "skill_marketplace_source_listing_mismatch",
			details: { sourceAssetId: input.sourceAssetId, productId: input.productId },
		});
	}
	assertVerifiedContent(source);
	const count = await transaction.user_skill_assets.count({ where: { owner_id: buyerUserId } });
	if (count >= MAX_USER_CONTEXT_ASSETS) {
		throw new AppError(`用户上下文资产最多 ${MAX_USER_CONTEXT_ASSETS} 个`, {
			status: 409,
			code: "user_context_asset_limit_reached",
		});
	}
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	const suffix = input.productId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || id.slice(0, 8);
	const fileName = normalizeMarkdownFileName(`${source.name.trim() || "marketplace-skill"}-${suffix}.md`);
	const created = await transaction.user_skill_assets.create({
		data: {
			id,
			owner_id: buyerUserId,
			file_name: fileName,
			name: source.name,
			description: source.description,
			content: source.content,
			logo_url: source.logo_url,
			force_full_context: 0,
			size_bytes: source.size_bytes,
			sha256: source.sha256,
			source_marketplace_product_id: input.productId,
			created_at: now,
			updated_at: now,
		},
		select: metadataSelect,
	});
	return { asset: toDto(created), created: true };
}
