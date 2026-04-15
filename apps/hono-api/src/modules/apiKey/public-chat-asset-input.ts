import { getAssetByIdForUser, type AssetRow } from "../asset/asset.repo";
import type { PrismaClient } from "../../types";

const PUBLIC_CHAT_MAX_ASSET_INPUTS = 12;
const PUBLIC_CHAT_MAX_REFERENCE_IMAGES = 12;

export const PUBLIC_CHAT_ASSET_ROLES = [
	"target",
	"reference",
	"character",
	"product",
	"style",
	"context",
	"mask",
] as const;

export type PublicChatAssetRole = (typeof PUBLIC_CHAT_ASSET_ROLES)[number];

export type PublicChatAssetInput = {
	assetId?: string;
	url?: string;
	role?: PublicChatAssetRole;
	weight?: number;
	note?: string;
};

export type NormalizedPublicChatAssetInput = {
	assetId: string | null;
	url: string;
	role: PublicChatAssetRole;
	weight: number | null;
	note: string | null;
	name: string | null;
};

type NormalizeAssetInputsOptions = {
	origin: string;
	userId: string;
	db: PrismaClient;
};

function toAbsoluteHttpUrl(raw: unknown, origin: string): string {
	const value = typeof raw === "string" ? raw.trim() : "";
	if (!value) return "";
	if (/^https?:\/\//i.test(value)) return value;
	if (value.startsWith("/") && origin) return `${origin}${value}`;
	return "";
}

function normalizeAssetRole(raw: unknown): PublicChatAssetRole {
	const role = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if ((PUBLIC_CHAT_ASSET_ROLES as readonly string[]).includes(role)) {
		return role as PublicChatAssetRole;
	}
	return "reference";
}

function normalizeWeight(raw: unknown): number | null {
	const n = Number(raw);
	if (!Number.isFinite(n)) return null;
	const clamped = Math.max(0, Math.min(1, n));
	return Number.isFinite(clamped) ? clamped : null;
}

function normalizeNote(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const text = raw.trim();
	if (!text) return null;
	return text.slice(0, 500);
}

function extractAssetPrimaryUrl(row: AssetRow | null, origin: string): string {
	if (!row) return "";
	let parsed: unknown = null;
	try {
		parsed = row.data ? JSON.parse(row.data) : null;
	} catch {
		parsed = null;
	}
	const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
	const directUrl = toAbsoluteHttpUrl(obj?.url, origin);
	if (directUrl) return directUrl;
	const sourceUrl = toAbsoluteHttpUrl(obj?.sourceUrl, origin);
	if (sourceUrl) return sourceUrl;
	return "";
}

export class PublicChatAssetInputNormalizer {
	static readonly MAX_ASSET_INPUTS = PUBLIC_CHAT_MAX_ASSET_INPUTS;
	static readonly MAX_REFERENCE_IMAGES = PUBLIC_CHAT_MAX_REFERENCE_IMAGES;

	normalizeReferenceImages(value: unknown, origin: string): string[] {
		if (!Array.isArray(value)) return [];
		const out: string[] = [];
		const seen = new Set<string>();
		for (const item of value) {
			const url = toAbsoluteHttpUrl(item, origin);
			if (!url || url.length > 2048 || seen.has(url)) continue;
			seen.add(url);
			out.push(url);
			if (out.length >= PublicChatAssetInputNormalizer.MAX_REFERENCE_IMAGES) break;
		}
		return out;
	}

	async normalizeAssetInputs(
		value: unknown,
		opts: NormalizeAssetInputsOptions,
	): Promise<NormalizedPublicChatAssetInput[]> {
		if (!Array.isArray(value)) return [];
		const out: NormalizedPublicChatAssetInput[] = [];
		const seen = new Set<string>();

		for (const item of value) {
			if (!item || typeof item !== "object") continue;
			const input = item as PublicChatAssetInput;
			const assetId =
				typeof input.assetId === "string" && input.assetId.trim()
					? input.assetId.trim()
					: "";
			const role = normalizeAssetRole(input.role);
			const note = normalizeNote(input.note);
			const weight = normalizeWeight(input.weight);

			let resolvedUrl = toAbsoluteHttpUrl(input.url, opts.origin);
			let resolvedName: string | null = null;
			if (assetId) {
				const row = await getAssetByIdForUser(opts.db, assetId, opts.userId);
				if (!row) continue;
				const fromAsset = extractAssetPrimaryUrl(row, opts.origin);
				if (fromAsset) resolvedUrl = fromAsset;
				resolvedName =
					typeof row.name === "string" && row.name.trim() ? row.name.trim() : null;
			}
			if (!resolvedUrl || resolvedUrl.length > 2048) continue;
			const dedupeKey = `${role}|${resolvedUrl}`;
			if (seen.has(dedupeKey)) continue;
			seen.add(dedupeKey);
			out.push({
				assetId: assetId || null,
				url: resolvedUrl,
				role,
				weight,
				note,
				name: resolvedName,
			});
			if (out.length >= PublicChatAssetInputNormalizer.MAX_ASSET_INPUTS) break;
		}
		return out;
	}
}

