import * as crypto from "node:crypto";

import type { AppContext } from "../../types";

// ============================================================================
// 豆包语音（seed-audio）富音色目录
// ----------------------------------------------------------------------------
// 调火山顶层开放 API ListSpeakers（open.volcengineapi.com, service=speech_saas_prod,
// resourceId=seed-tts-2.0）拉取在线音色列表（含头像 + 试听 url），映射为前端富音色
// 选择器可直接渲染的精简结构。需 Volcengine AK/SK（VOLC_ARK_ACCESS_KEY /
// VOLC_ARK_SECRET_KEY，与 seed-audio 合成用的 openspeech X-Api-Key 不同）。
// 未配置凭证或拉取失败 → 优雅返回空数组（前端回落静态库），永不抛出。
// 结果内存缓存 ~6h。
// ============================================================================

export type SeedAudioVoiceMeta = {
	id: string; // VoiceType → seed-audio speaker
	name: string;
	avatar: string;
	trialUrl: string;
	gender: string;
	age: string;
	scene: string;
	description: string;
	emotions: string[];
};

type VolcSpeaker = {
	VoiceType?: string;
	Name?: string;
	Avatar?: string;
	TrialURL?: string;
	ShortTrialURL?: string;
	Gender?: string;
	Age?: string;
	Description?: string;
	Categories?: Array<{ Categories?: string[] }>;
	Emotions?: Array<{ Icon?: string; Label?: string; Value?: string }>;
};

const REGION = "cn-beijing";
const SERVICE = "speech_saas_prod";
const HOST = "open.volcengineapi.com";
const ACTION = "ListSpeakers";
const VERSION = "2025-05-20";
const RESOURCE_ID = "seed-tts-2.0";
const PAGE_LIMIT = 100;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cache: SeedAudioVoiceMeta[] | null = null;
let cacheTimestamp = 0;
let inflight: Promise<SeedAudioVoiceMeta[]> | null = null;

function readVolcCreds(c: AppContext): { accessKey: string; secretKey: string } {
	const env = c?.env as Record<string, unknown> | undefined;
	const processEnv = (globalThis as any)?.process?.env as
		| Record<string, string | undefined>
		| undefined;
	const pick = (key: string): string => {
		const fromEnv = typeof env?.[key] === "string" ? String(env[key]).trim() : "";
		if (fromEnv) return fromEnv;
		return typeof processEnv?.[key] === "string" ? String(processEnv[key]).trim() : "";
	};
	return {
		accessKey: pick("VOLC_ARK_ACCESS_KEY"),
		secretKey: pick("VOLC_ARK_SECRET_KEY"),
	};
}

function sha256Hex(input: string | Buffer): string {
	return crypto.createHash("sha256").update(input).digest("hex");
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
	return crypto.createHmac("sha256", key).update(data).digest();
}

function formatDate(d: Date): { iso: string; short: string } {
	const pad = (n: number) => String(n).padStart(2, "0");
	const y = d.getUTCFullYear();
	const m = pad(d.getUTCMonth() + 1);
	const day = pad(d.getUTCDate());
	const h = pad(d.getUTCHours());
	const mi = pad(d.getUTCMinutes());
	const s = pad(d.getUTCSeconds());
	return { iso: `${y}${m}${day}T${h}${mi}${s}Z`, short: `${y}${m}${day}` };
}

/** Volcengine top-level API V4 (HMAC-SHA256) 签名。 */
function signVolcRequest(input: {
	accessKey: string;
	secretKey: string;
	body: string;
}): { url: string; headers: Record<string, string> } {
	const { accessKey, secretKey, body } = input;
	const { iso, short } = formatDate(new Date());
	const canonicalQuery = `Action=${encodeURIComponent(ACTION)}&Version=${encodeURIComponent(VERSION)}`;
	const bodyHash = sha256Hex(body || "");
	const contentType = "application/json; charset=utf-8";

	const canonicalHeaders =
		`content-type:${contentType}\n` +
		`host:${HOST}\n` +
		`x-content-sha256:${bodyHash}\n` +
		`x-date:${iso}\n`;
	const signedHeaders = "content-type;host;x-content-sha256;x-date";

	const canonicalRequest = [
		"POST",
		"/",
		canonicalQuery,
		canonicalHeaders,
		signedHeaders,
		bodyHash,
	].join("\n");

	const credentialScope = `${short}/${REGION}/${SERVICE}/request`;
	const stringToSign = [
		"HMAC-SHA256",
		iso,
		credentialScope,
		sha256Hex(canonicalRequest),
	].join("\n");

	const kDate = hmacSha256(secretKey, short);
	const kRegion = hmacSha256(kDate, REGION);
	const kService = hmacSha256(kRegion, SERVICE);
	const kSigning = hmacSha256(kService, "request");
	const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

	const authorization =
		`HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
		`SignedHeaders=${signedHeaders}, Signature=${signature}`;

	return {
		url: `https://${HOST}/?${canonicalQuery}`,
		headers: {
			"Content-Type": contentType,
			Host: HOST,
			"X-Date": iso,
			"X-Content-Sha256": bodyHash,
			Authorization: authorization,
		},
	};
}

function mapSpeaker(sp: VolcSpeaker): SeedAudioVoiceMeta {
	const firstScene = sp.Categories?.[0]?.Categories?.[0] || "通用场景";
	return {
		id: sp.VoiceType || "",
		name: sp.Name || sp.VoiceType || "",
		avatar: sp.Avatar || "",
		trialUrl: sp.TrialURL || sp.ShortTrialURL || "",
		gender: sp.Gender || "",
		age: sp.Age || "",
		scene: firstScene,
		description: sp.Description || "",
		emotions: Array.isArray(sp.Emotions)
			? sp.Emotions.map((e) => e?.Label || "").filter((l): l is string => Boolean(l))
			: [],
	};
}

async function fetchPage(
	creds: { accessKey: string; secretKey: string },
	page: number,
): Promise<{ speakers: VolcSpeaker[]; pageTotal: number }> {
	const body = JSON.stringify({ ResourceIDs: [RESOURCE_ID], Page: page, Limit: PAGE_LIMIT });
	const signed = signVolcRequest({ ...creds, body });
	const response = await fetch(signed.url, {
		method: "POST",
		headers: signed.headers,
		body,
		signal: AbortSignal.timeout(20_000),
	});
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`ListSpeakers HTTP ${response.status}: ${text.slice(0, 200)}`);
	}
	const json: any = await response.json();
	const result = json?.Result || {};
	const speakers: VolcSpeaker[] = Array.isArray(result.Speakers) ? result.Speakers : [];
	const pageTotal = typeof result.Total === "number" ? result.Total : speakers.length;
	return { speakers, pageTotal };
}

async function loadAllVoices(creds: {
	accessKey: string;
	secretKey: string;
}): Promise<SeedAudioVoiceMeta[]> {
	const collected: SeedAudioVoiceMeta[] = [];
	let page = 1;
	let total = Infinity;
	// 分页直到收集满 Result.Total（防御性上限 50 页 = 5000 条）。
	while (collected.length < total && page <= 50) {
		const { speakers, pageTotal } = await fetchPage(creds, page);
		total = pageTotal;
		if (speakers.length === 0) break;
		for (const sp of speakers) collected.push(mapSpeaker(sp));
		if (speakers.length < PAGE_LIMIT) break;
		page += 1;
	}
	return collected;
}

/** 返回富音色目录；未配置凭证或拉取失败时优雅返回空数组（永不抛出）。 */
export async function listDoubaoSeedAudioVoices(c: AppContext): Promise<SeedAudioVoiceMeta[]> {
	if (cache && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
		return cache;
	}
	const creds = readVolcCreds(c);
	if (!creds.accessKey || !creds.secretKey) {
		// 未配置 AK/SK：前端回落静态库（仍可选音色，无头像/试听）。
		return [];
	}
	if (inflight) return inflight;

	inflight = loadAllVoices(creds)
		.then((voices) => {
			if (voices.length > 0) {
				cache = voices;
				cacheTimestamp = Date.now();
			}
			return voices;
		})
		.catch(() => cache || [])
		.finally(() => {
			inflight = null;
		});

	return inflight;
}
