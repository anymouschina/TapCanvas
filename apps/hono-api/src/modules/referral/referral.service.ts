import type { AppContext } from "../../types";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import {
	createObjectStorageClientFromConfig,
	resolveObjectStorageConfig,
} from "../asset/rustfs.client";
import { resolvePublicAssetBaseUrl } from "../asset/asset.publicBase";
import * as repo from "./referral.repo";
import { topUpTeamCredits } from "../team/team.repo";

const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // base32 minus 0/1/O/I

function generateInviteCode(): string {
	const buf = new Uint8Array(6);
	crypto.getRandomValues(buf);
	let out = "";
	for (let i = 0; i < 6; i++) {
		out += INVITE_CODE_ALPHABET[buf[i] % INVITE_CODE_ALPHABET.length];
	}
	return out;
}

export async function getOrCreateInviteCode(
	c: AppContext,
	userId: string,
): Promise<string> {
	const existing = await repo.getUserInviteCode(c.env.DB, userId);
	if (existing) return existing;
	const nowIso = new Date().toISOString();
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = generateInviteCode();
		const ok = await repo.setUserInviteCode(c.env.DB, userId, code, nowIso);
		if (ok) {
			const after = await repo.getUserInviteCode(c.env.DB, userId);
			if (after) return after;
		}
	}
	throw new Error("failed to allocate invite code");
}

export async function bindReferrerOnRegister(
	c: AppContext,
	userId: string,
	refCode: string | null,
	_clientIp: string | null,
	_fingerprint: string | null,
): Promise<void> {
	if (!refCode || typeof refCode !== "string") return;
	const trimmed = refCode.trim().toUpperCase();
	if (!/^[A-HJ-NP-Z2-9]{6}$/.test(trimmed)) return;

	try {
		const referrer = await repo.findUserByInviteCode(c.env.DB, trimmed);
		if (!referrer) return;
		if (referrer.id === userId) return; // self-invite

		const config = await repo.getReferralConfig(c.env.DB);
		const me = await repo.getUserReferrerInfo(c.env.DB, userId);
		if (!me) return;

		// Hard block: same phone (same real-world identity)
		if (
			config?.anti_self_check &&
			referrer.phone &&
			me.phone &&
			referrer.phone === me.phone
		) {
			return;
		}

		const nowIso = new Date().toISOString();
		await repo.setUserReferrer(c.env.DB, userId, referrer.id, nowIso);

		// Grant welcome bonus to the invitee (idempotent)
		const welcomeCredits = Number(config?.invitee_welcome_credits ?? 1000) || 0;
		if (welcomeCredits > 0 && !(await repo.hasWelcomeBonusBeenGranted(c.env.DB, userId))) {
			const inviteeTeamId = `personal_${userId}`;
			const taskId = `referral-welcome:${userId}`;
			const credit = await topUpTeamCredits(c.env.DB, {
				teamId: inviteeTeamId,
				amount: welcomeCredits,
				actorUserId: userId,
				note: JSON.stringify({ kind: "welcome_bonus", referrerUserId: referrer.id }),
				nowIso,
				entryType: "referral_welcome",
				taskId,
				taskKind: "referral_welcome",
				sourceType: "referral_welcome",
				sourceKey: taskId,
			});
			if (!credit.ledgerEntryId) throw new Error(`referral welcome credit ledger missing: ${taskId}`);
			await repo.insertGrantLog(c.env.DB, {
				id: crypto.randomUUID(),
				source_topup_ledger_id: `welcome_${userId}`,
				referrer_user_id: referrer.id,
				invitee_user_id: userId,
				kind: "welcome_bonus",
				granted_credits: welcomeCredits,
				ledger_entry_id: credit.ledgerEntryId,
				created_at: nowIso,
			});
		}
	} catch (err) {
		console.error("[referral] bindReferrerOnRegister failed", err);
	}
}

export type CampaignPublic = {
	enabled: boolean;
	title: string;
	body: string;
	ctaText: string;
	imageUrl: string | null;
	inviteeWelcomeCredits: number;
};

export async function getCampaignForPublic(
	c: AppContext,
): Promise<CampaignPublic> {
	const config = await repo.getReferralConfig(c.env.DB);
	if (!config) {
		return {
			enabled: false,
			title: "",
			body: "",
			ctaText: "",
			imageUrl: null,
			inviteeWelcomeCredits: 0,
		};
	}
	if (config.enabled && !(config.image_url && config.image_url.trim())) {
		scheduleEnsureCampaignImage(c);
	}
	return {
		enabled: !!config.enabled,
		title: config.title,
		body: config.body,
		ctaText: config.cta_text,
		imageUrl: config.image_url,
		inviteeWelcomeCredits: config.invitee_welcome_credits,
	};
}

export async function getReferralStats(
	c: AppContext,
	userId: string,
): Promise<{ inviteeCount: number; totalGrantedCredits: number }> {
	const [inviteeCount, totalGrantedCredits] = await Promise.all([
		repo.countInviteesByReferrer(c.env.DB, userId),
		repo.sumGrantedCreditsByReferrer(c.env.DB, userId),
	]);
	return { inviteeCount, totalGrantedCredits };
}

function readEnv(c: AppContext, key: string): string {
	const fromEnv =
		typeof (c.env as any)?.[key] === "string"
			? String((c.env as any)[key])
			: "";
	if (fromEnv.trim()) return fromEnv.trim();
	const fromProcess =
		typeof (globalThis as any)?.process?.env?.[key] === "string"
			? String((globalThis as any).process.env[key])
			: "";
	return fromProcess.trim();
}

function normalizeBaseUrl(input: string): string {
	if (!input) return "";
	return input.replace(/\/+$/, "");
}

// Fixed marketing prompt — admins no longer pick prompts; the popup cover is a
// brand-consistent illustration generated once and reused.
const CAMPAIGN_IMAGE_PROMPT = [
	"A premium marketing hero illustration for a creative AI canvas product's referral campaign.",
	"Friends sharing rewards and creative sparks — flat modern vector style with soft volumetric light.",
	"Vibrant gradient palette: violet, magenta, warm orange highlights on a deep navy background.",
	"Floating UI cards, sparkles, gift envelopes and abstract canvas/node motifs.",
	"Clean composition with strong central focal point and generous negative space at the top.",
	"No text, no logos, no watermarks. Cinematic, polished, social-share ready.",
].join(" ");

let campaignImageGenerationInFlight = false;

function isCampaignImageReady(url: string | null | undefined): boolean {
	return typeof url === "string" && url.trim().length > 0;
}

export async function ensureCampaignImage(
	c: AppContext,
	opts?: { force?: boolean },
): Promise<string | null> {
	const config = await repo.getReferralConfig(c.env.DB);
	if (!config) return null;
	if (!opts?.force && isCampaignImageReady(config.image_url)) {
		return config.image_url;
	}
	if (campaignImageGenerationInFlight) return config.image_url;
	campaignImageGenerationInFlight = true;
	try {
		const url = await generateAndHostCampaignImage(c);
		if (!url) return config.image_url;
		await repo.updateReferralConfig(
			c.env.DB,
			{ image_url: url },
			new Date().toISOString(),
		);
		return url;
	} catch (err) {
		console.error("[referral] ensureCampaignImage failed", err);
		return config.image_url;
	} finally {
		campaignImageGenerationInFlight = false;
	}
}

export function scheduleEnsureCampaignImage(c: AppContext): void {
	const work = async () => {
		try {
			await ensureCampaignImage(c);
		} catch (err) {
			console.warn("[referral] scheduled ensureCampaignImage failed", err);
		}
	};
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const execCtx = (c as any)?.executionCtx;
	try {
		if (execCtx && typeof execCtx.waitUntil === "function") {
			execCtx.waitUntil(work());
			return;
		}
	} catch {
		// fall through
	}
	void work();
}

async function generateAndHostCampaignImage(
	c: AppContext,
): Promise<string | null> {
	const baseUrl = normalizeBaseUrl(
		readEnv(c, "NEW_API_INTERNAL_BASE_URL") || "http://localhost:4455",
	);
	const token = readEnv(c, "NEW_API_INTERNAL_TOKEN");

	const resp = await fetch(`${baseUrl}/v1/images/generations`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({
			model: "gpt-image-2",
			prompt: CAMPAIGN_IMAGE_PROMPT,
			n: 1,
			size: "2048x2048",
			quality: "high",
			resolution: "4K",
			response_format: "url",
		}),
		signal: AbortSignal.timeout(3 * 60_000),
	});
	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		throw new Error(
			`new-api image generation failed (${resp.status}): ${text}`,
		);
	}
	const data = (await resp.json()) as {
		data?: Array<{ url?: string; b64_json?: string }>;
	};
	const payload = pickFirstImagePayload(data.data ?? []);
	if (!payload) return null;
	return await uploadCampaignImageToObjectStorage(c, payload);
}

type CampaignImagePayload =
	| { kind: "url"; url: string }
	| { kind: "base64"; mimeType: string; base64: string };

function pickFirstImagePayload(
	rows: Array<{ url?: string; b64_json?: string }>,
): CampaignImagePayload | null {
	for (const row of rows) {
		if (typeof row.url === "string" && row.url.trim()) {
			return { kind: "url", url: row.url.trim() };
		}
		if (typeof row.b64_json === "string" && row.b64_json.trim()) {
			return {
				kind: "base64",
				mimeType: "image/png",
				base64: row.b64_json.trim(),
			};
		}
	}
	return null;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
	const cleaned = (base64 || "").replace(/\s+/g, "");
	if (!cleaned) return new Uint8Array(0);
	if (typeof atob === "function") {
		const binary = atob(cleaned);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		return bytes;
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyGlobal: any = globalThis as any;
	if (anyGlobal?.Buffer) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return new Uint8Array((anyGlobal.Buffer as any).from(cleaned, "base64"));
	}
	throw new Error("base64 decode not supported in this runtime");
}

function detectImageExtension(contentType: string, fallbackUrl?: string): string {
	const known: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
	};
	if (contentType && known[contentType]) return known[contentType];
	if (fallbackUrl) {
		try {
			const parsed = new URL(fallbackUrl);
			const ext = (parsed.pathname.split(".").pop() || "").toLowerCase();
			if (/^[a-z0-9]+$/.test(ext)) return ext;
		} catch {
			// ignore
		}
	}
	return "png";
}

async function uploadCampaignImageToObjectStorage(
	c: AppContext,
	payload: CampaignImagePayload,
): Promise<string> {
	const storage = resolveObjectStorageConfig(c.env);
	if (!storage) {
		throw new Error("Object storage is not configured");
	}
	const publicBase = resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");

	let body: Uint8Array;
	let contentType = "image/png";
	let sourceUrlForExt: string | undefined;

	if (payload.kind === "url") {
		const res = await fetch(payload.url);
		if (!res.ok) {
			throw new Error(
				`fetch upstream image failed (${res.status} ${res.statusText})`,
			);
		}
		const ct = res.headers.get("content-type") || "image/png";
		contentType = ct.split(";")[0].trim() || "image/png";
		body = new Uint8Array(await res.arrayBuffer());
		sourceUrlForExt = payload.url;
	} else {
		body = decodeBase64ToBytes(payload.base64);
		contentType = payload.mimeType || "image/png";
	}

	const ext = detectImageExtension(contentType, sourceUrlForExt);
	const date = new Date();
	const datePrefix = `${date.getUTCFullYear()}${String(
		date.getUTCMonth() + 1,
	).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
	const key = `gen/referral/${datePrefix}/${crypto.randomUUID()}.${ext}`;

	const client = createObjectStorageClientFromConfig(storage);
	await client.send(
		new PutObjectCommand({
			Bucket: storage.bucket,
			Key: key,
			Body: body,
			ContentType: contentType,
			CacheControl: "public, max-age=31536000, immutable",
			ContentLength: body.byteLength,
		}),
	);

	return publicBase ? `${publicBase}/${key}` : `/${key}`;
}
