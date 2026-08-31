import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { PutObjectCommand } from "@aws-sdk/client-s3";

import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
	createObjectStorageClientFromConfig,
	resolveObjectStorageConfig,
} from "../asset/rustfs.client";
import { requireSelectableAudioModel } from "../new-api-models/new-api-audio-model";

const execFileAsync = promisify(execFile);

export const DEFAULT_SPEECH_VOICE = "male-qn-qingse";
// 总文案上限（超过 t2a_v2 单请求限制的部分自动分段合成再拼接）。
const MAX_SPEECH_TEXT_LENGTH = 20000;
// 单段上限（JS 字符）；MiniMax t2a_v2 限 1 万计费字符（汉字=2），留足余量。
const SPEECH_SEGMENT_MAX_CHARS = 2000;

/**
 * 语音模型积分单价（积分 / 万计费字符）。
 * 规则：上游官方价（hd 3.5 元/万字符、turbo 2 元/万字符）× 2.5（毛利 60%）
 * × 100（积分:元 = 100:1）。计费字符按 MiniMax 规则：汉字等 CJK = 2，其余 = 1。
 */
export const SPEECH_CREDIT_RATES_PER_10K: Record<string, number> = {
	"speech-2.8-hd": 875,
	"speech-2.6-hd": 875,
	"speech-01-hd": 875,
	"speech-2.8-turbo": 500,
	"speech-2.6-turbo": 500,
	"speech-01": 500,
};

export const SUPPORTED_SPEECH_MODELS = Object.keys(SPEECH_CREDIT_RATES_PER_10K);

/** MiniMax 计费字符数：CJK（含中文/日文假名/韩文）算 2，其余算 1。 */
export function countSpeechBillableChars(text: string): number {
	let count = 0;
	for (const ch of text) {
		const code = ch.codePointAt(0) ?? 0;
		const isCjk =
			(code >= 0x2e80 && code <= 0x9fff) ||
			(code >= 0xac00 && code <= 0xd7af) ||
			(code >= 0xf900 && code <= 0xfaff) ||
			(code >= 0x3000 && code <= 0x303f) ||
			(code >= 0xff00 && code <= 0xffef);
		count += isCjk ? 2 : 1;
	}
	return count;
}

/** 按实际文案长度计算本次合成所需积分（最低 1 积分）。 */
export function computeSpeechCredits(model: string, text: string): number {
	const normalized = (model || "").trim();
	const rate = SPEECH_CREDIT_RATES_PER_10K[normalized];
	if (!normalized || !rate) {
		throw new AppError("语音模型缺少明确的字符计费规则", {
			status: 503,
			code: "speech_model_pricing_unavailable",
			details: { model: normalized || null },
		});
	}
	const chars = countSpeechBillableChars(text);
	return Math.max(1, Math.ceil((chars * rate) / 10000));
}

/** 按句读边界把长文案切成 ≤maxLen 的段落，供分段合成。 */
export function splitSpeechTextIntoSegments(text: string, maxLen = SPEECH_SEGMENT_MAX_CHARS): string[] {
	const trimmed = (text || "").trim();
	if (!trimmed) return [];
	if (trimmed.length <= maxLen) return [trimmed];
	const sentences = trimmed.match(/[^。！？!?\n]+[。！？!?\n]*/g) || [trimmed];
	const segments: string[] = [];
	let current = "";
	for (const sentence of sentences) {
		if (current && current.length + sentence.length > maxLen) {
			segments.push(current);
			current = "";
		}
		// 单句超长时硬切
		if (sentence.length > maxLen) {
			if (current) {
				segments.push(current);
				current = "";
			}
			for (let i = 0; i < sentence.length; i += maxLen) {
				segments.push(sentence.slice(i, i + maxLen));
			}
			continue;
		}
		current += sentence;
	}
	if (current) segments.push(current);
	return segments.map((s) => s.trim()).filter(Boolean);
}

export const SPEECH_EMOTIONS = [
	"happy",
	"sad",
	"angry",
	"fearful",
	"disgusted",
	"surprised",
	"calm",
	"fluent",
	"whisper",
] as const;
export type SpeechEmotion = (typeof SPEECH_EMOTIONS)[number];

export const SPEECH_SOUND_EFFECTS = [
	"spacious_echo",
	"auditorium_echo",
	"lofi_telephone",
	"robotic",
] as const;
export type SpeechSoundEffect = (typeof SPEECH_SOUND_EFFECTS)[number];

export type SynthesizeSpeechInput = {
	text: string;
	model?: string | null;
	voiceId?: string | null;
	emotion?: string | null;
	/** 0.5 ~ 2.0，MiniMax voice_setting.speed */
	speed?: number | null;
	soundEffects?: string[] | null;
};

export type SynthesizeSpeechResult = {
	url: string;
	key: string;
	bytes: number;
	durationSec: number | null;
	model: string;
	voiceId: string;
	emotion: string | null;
};

function readNewApiRelayConfig(c: AppContext): { baseUrl: string; token: string } | null {
	const env = c?.env as Record<string, unknown> | undefined;
	const processEnv = (globalThis as any)?.process?.env as
		| Record<string, string | undefined>
		| undefined;
	const pick = (key: string): string => {
		const fromEnv = typeof env?.[key] === "string" ? String(env[key]).trim() : "";
		if (fromEnv) return fromEnv;
		const fromProcess =
			typeof processEnv?.[key] === "string" ? String(processEnv[key]).trim() : "";
		return fromProcess;
	};
	const baseUrl = pick("NEW_API_INTERNAL_BASE_URL").replace(/\/+$/, "");
	const token = pick("NEW_API_INTERNAL_TOKEN");
	if (!baseUrl || !token) return null;
	return { baseUrl, token };
}

export function normalizeSpeechEmotion(value: unknown): SpeechEmotion | null {
	const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!candidate) return null;
	return (SPEECH_EMOTIONS as readonly string[]).includes(candidate)
		? (candidate as SpeechEmotion)
		: null;
}

export function normalizeSpeechSoundEffects(values: unknown): SpeechSoundEffect[] {
	if (!Array.isArray(values)) return [];
	const out: SpeechSoundEffect[] = [];
	for (const item of values) {
		const candidate = typeof item === "string" ? item.trim().toLowerCase() : "";
		if (
			candidate &&
			(SPEECH_SOUND_EFFECTS as readonly string[]).includes(candidate) &&
			!out.includes(candidate as SpeechSoundEffect)
		) {
			out.push(candidate as SpeechSoundEffect);
		}
	}
	return out;
}

function normalizeSpeed(value: unknown): number | null {
	const n = typeof value === "number" ? value : Number.NaN;
	if (!Number.isFinite(n)) return null;
	return Math.min(2, Math.max(0.5, n));
}

async function probeDurationSec(file: string): Promise<number | null> {
	try {
		const { stdout } = await execFileAsync("ffprobe", [
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"csv=p=0",
			file,
		]);
		const duration = Number(stdout.trim());
		return Number.isFinite(duration) && duration > 0
			? Math.round(duration * 100) / 100
			: null;
	} catch {
		return null;
	}
}

/**
 * 调 new-api 的 OpenAI 兼容 TTS relay（MiniMax 渠道 → /v1/t2a_v2），拿到音频
 * 字节后转存对象存储，返回公开 URL。
 *
 * new-api 的 minimax adaptor 在 output_format=url 时把上游 OSS 链接包成 302
 * 重定向返回，因此这里必须 redirect:"manual" 后改用 GET 拉取（重定向 URL 是
 * 预签名 GET，跟随 POST 会 405）；hex 路径则直接返回音频字节。
 */
export async function synthesizeSpeechToStorage(
	c: AppContext,
	userId: string,
	input: SynthesizeSpeechInput,
): Promise<SynthesizeSpeechResult> {
	const text = (input.text || "").trim();
	if (!text) throw new Error("text is required");
	if (text.length > MAX_SPEECH_TEXT_LENGTH) {
		throw new Error(`text too long (max ${MAX_SPEECH_TEXT_LENGTH} chars)`);
	}

	const relay = readNewApiRelayConfig(c);
	if (!relay) throw new Error("NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置");

	const storageConfig = resolveObjectStorageConfig(c.env);
	if (!storageConfig) throw new Error("Object storage is not configured");

	const catalogModel = await requireSelectableAudioModel(c, input.model, "speech");
	if (!catalogModel.tags.some((tag) => tag.trim().toLowerCase() === "tapcanvas:audio-engine=minimax")) {
		throw new AppError("所选语音模型不支持 MiniMax TTS 执行端点", {
			status: 400,
			code: "audio_model_engine_mismatch",
			details: { model: catalogModel.modelName, expectedEngine: "minimax" },
		});
	}
	const model = catalogModel.requestModelKey;
	const voiceId = (input.voiceId || "").trim() || DEFAULT_SPEECH_VOICE;
	const emotion = normalizeSpeechEmotion(input.emotion);
	const speed = normalizeSpeed(input.speed);
	const soundEffects = normalizeSpeechSoundEffects(input.soundEffects);

	// metadata 会整体覆盖 adaptor 构造的同名字段（json.Unmarshal 到同一结构体），
	// 所以 voice_setting 必须自带 voice_id/speed，不能只放增量字段。
	const voiceSetting: Record<string, unknown> = { voice_id: voiceId };
	if (emotion) voiceSetting.emotion = emotion;
	if (speed !== null) voiceSetting.speed = speed;
	const metadata: Record<string, unknown> = {
		output_format: "url",
		voice_setting: voiceSetting,
	};
	if (soundEffects.length > 0) {
		metadata.voice_modify = { sound_effects: soundEffects.join(",") };
	}

	const fetchSegment = async (segmentText: string): Promise<Buffer> => {
		const upstreamRes = await fetch(`${relay.baseUrl}/v1/audio/speech`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${relay.token}`,
			},
			body: JSON.stringify({ model, input: segmentText, voice: voiceId, metadata }),
			redirect: "manual",
			signal: AbortSignal.timeout(120_000),
		});

		let buf: Buffer;
		if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
			const location = upstreamRes.headers.get("location") || "";
			if (!location) throw new Error("TTS relay redirected without location header");
			const audioRes = await fetch(location, {
				method: "GET",
				signal: AbortSignal.timeout(120_000),
			});
			if (!audioRes.ok) {
				throw new Error(`failed to download synthesized audio (${audioRes.status})`);
			}
			buf = Buffer.from(await audioRes.arrayBuffer());
		} else if (upstreamRes.ok) {
			buf = Buffer.from(await upstreamRes.arrayBuffer());
		} else {
			const detail = await upstreamRes.text().catch(() => "");
			throw new Error(
				`TTS relay failed (${upstreamRes.status}): ${detail.slice(0, 500) || upstreamRes.statusText}`,
			);
		}
		if (buf.byteLength < 128) {
			throw new Error("TTS relay returned empty audio payload");
		}
		return buf;
	};

	// 超过单请求上限时按句读分段合成，再用 ffmpeg concat 拼回一条 mp3。
	const segments = splitSpeechTextIntoSegments(text);
	const workDir = await mkdtemp(join(tmpdir(), "tts-"));
	let audioBuf: Buffer;
	let durationSec: number | null = null;
	try {
		if (segments.length <= 1) {
			audioBuf = await fetchSegment(segments[0] ?? text);
			const tempFile = join(workDir, "speech.mp3");
			await writeFile(tempFile, audioBuf);
			durationSec = await probeDurationSec(tempFile);
		} else {
			const parts: string[] = [];
			for (let i = 0; i < segments.length; i += 1) {
				const buf = await fetchSegment(segments[i]);
				const partFile = join(workDir, `part-${i}.mp3`);
				await writeFile(partFile, buf);
				parts.push(partFile);
			}
			const listFile = join(workDir, "list.txt");
			await writeFile(
				listFile,
				parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
				"utf-8",
			);
			const outFile = join(workDir, "speech.mp3");
			await execFileAsync("ffmpeg", [
				"-y",
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				listFile,
				"-c:a",
				"libmp3lame",
				"-q:a",
				"2",
				outFile,
			]);
			audioBuf = Buffer.from(await readFile(outFile));
			durationSec = await probeDurationSec(outFile);
		}
	} finally {
		await rm(workDir, { recursive: true, force: true }).catch(() => {});
	}

	const client = createObjectStorageClientFromConfig(storageConfig);
	const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
	const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	const key = `gen/audio/${safeUser}/${datePrefix}/${randomUUID()}.mp3`;
	await client.send(
		new PutObjectCommand({
			Bucket: storageConfig.bucket,
			Key: key,
			Body: audioBuf,
			ContentType: "audio/mpeg",
			CacheControl: "public, max-age=31536000, immutable",
		}),
	);

	const publicBase = storageConfig.publicBase.trim().replace(/\/+$/, "");
	const url = publicBase ? `${publicBase}/${key}` : `/${key}`;

	return {
		url,
		key,
		bytes: audioBuf.byteLength,
		durationSec,
		model,
		voiceId,
		emotion,
	};
}

// ============================================================================
// 豆包语音 doubao-seed-audio（火山「豆包语音」TTS）
// ----------------------------------------------------------------------------
// 走 new-api volcengine seed-audio relay（同步 HTTP openspeech /api/v3/tts/create）。
// 与 MiniMax 路径的关键差异：
//   1) 响应是音频字节（非 url、无 302）；
//   2) 按「秒」计费（relay 落响应头 X-NewApi-Audio-Duration / X-NewApi-Consumed-Credits）；
//   3) 参数走 seed-audio 语义：speed=语速(-50~100)，metadata 携带 pitch/loudness/
//      sample_rate + 音色克隆参考（audio_url / references / image_url，图优先互斥）。
// ============================================================================

// seed-audio 单请求最长 120s；按经验中文 ~4-5 字/秒，单段控制在 ~500 字以内防超时。
const DOUBAO_SEED_AUDIO_MAX_SECONDS = 120;
const DOUBAO_SEGMENT_MAX_CHARS = 500;
// 计费：1.2 元/分钟 = 20 积分/秒（与 new-api seedAudioDefaultCreditsPerSecond 对齐，
// 封顶 120s=2400/次）。最终以 relay 回桥的实际时长结算。
const DOUBAO_CREDITS_PER_SECOND = 20;

/** 模型是否为豆包语音（doubao-seed-audio 前缀）。 */
export function isDoubaoSpeechModel(model: string | null | undefined): boolean {
	return String(model || "")
		.trim()
		.toLowerCase()
		.startsWith("doubao-seed-audio");
}

/** 按实际合成秒数计费（向上取整秒，封顶 120s，最低 1 积分）。 */
export function computeDoubaoSpeechCredits(durationSec: number): number {
	const secs = Math.min(
		DOUBAO_SEED_AUDIO_MAX_SECONDS,
		Math.max(0, Number.isFinite(durationSec) ? durationSec : 0),
	);
	return Math.max(1, Math.ceil(secs * DOUBAO_CREDITS_PER_SECOND));
}

/** 预留上限（封顶秒数对应积分），实际按时长结算后释放差额。 */
export function doubaoSpeechReserveCeiling(): number {
	return DOUBAO_SEED_AUDIO_MAX_SECONDS * DOUBAO_CREDITS_PER_SECOND;
}

function clampNum(value: unknown, lo: number, hi: number): number | null {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return null;
	return Math.min(hi, Math.max(lo, Math.round(n)));
}

export type SynthesizeDoubaoSpeechInput = {
	text: string;
	model?: string | null;
	/** 预设音色 speaker id（与克隆参考互斥，有参考时被 relay 清空）。 */
	voiceId?: string | null;
	/** 语速 -50~100（0=不变）。 */
	speechRate?: number | null;
	/** 音调 -12~12。 */
	pitchRate?: number | null;
	/** 响度 -50~100。 */
	loudnessRate?: number | null;
	sampleRate?: number | null;
	/** 输出格式：当前统一转存 mp3，保留入参兼容。 */
	responseFormat?: string | null;
	/** 音色克隆：参考音频（最多 3），与参考图互斥。 */
	referenceAudioUrls?: string[] | null;
	/** 音色克隆：参考图（图优先于音频）。 */
	referenceImageUrl?: string | null;
};

export type SynthesizeDoubaoSpeechResult = {
	url: string;
	key: string;
	bytes: number;
	durationSec: number | null;
	model: string;
	voiceId: string;
};

/**
 * 调 new-api 的 seed-audio relay（/v1/audio/speech，model=doubao-seed-audio-1-0），
 * 拿到音频字节后转存对象存储；返回公开 URL + 实际时长（用于按秒结算）。
 */
export async function synthesizeDoubaoSpeechToStorage(
	c: AppContext,
	userId: string,
	input: SynthesizeDoubaoSpeechInput,
): Promise<SynthesizeDoubaoSpeechResult> {
	const text = (input.text || "").trim();
	if (!text) throw new Error("text is required");
	if (text.length > MAX_SPEECH_TEXT_LENGTH) {
		throw new Error(`text too long (max ${MAX_SPEECH_TEXT_LENGTH} chars)`);
	}

	const relay = readNewApiRelayConfig(c);
	if (!relay) throw new Error("NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置");

	const storageConfig = resolveObjectStorageConfig(c.env);
	if (!storageConfig) throw new Error("Object storage is not configured");

	const catalogModel = await requireSelectableAudioModel(c, input.model, "speech");
	if (!catalogModel.tags.some((tag) => tag.trim().toLowerCase() === "tapcanvas:audio-engine=doubao")) {
		throw new AppError("所选语音模型不支持豆包 TTS 执行端点", {
			status: 400,
			code: "audio_model_engine_mismatch",
			details: { model: catalogModel.modelName, expectedEngine: "doubao" },
		});
	}
	const model = catalogModel.requestModelKey;
	const voiceId = (input.voiceId || "").trim();
	const speechRate = clampNum(input.speechRate, -50, 100);
	const pitchRate = clampNum(input.pitchRate, -12, 12);
	const loudnessRate = clampNum(input.loudnessRate, -50, 100);
	const sampleRate =
		typeof input.sampleRate === "number" && Number.isFinite(input.sampleRate)
			? Math.max(0, Math.trunc(input.sampleRate))
			: null;

	// 音色克隆参考（图优先、与音频互斥；逻辑与 new-api seed_audio.go 一致，双端兜底）。
	const refImage = (input.referenceImageUrl || "").trim();
	const refAudios = Array.isArray(input.referenceAudioUrls)
		? input.referenceAudioUrls
				.map((u) => (typeof u === "string" ? u.trim() : ""))
				.filter(Boolean)
				.slice(0, 3)
		: [];
	const metadata: Record<string, unknown> = {};
	if (sampleRate) metadata.sample_rate = sampleRate;
	if (loudnessRate !== null) metadata.loudness_rate = loudnessRate;
	if (pitchRate !== null) metadata.pitch_rate = pitchRate;
	if (refImage) {
		metadata.image_url = refImage;
	} else if (refAudios.length === 1) {
		metadata.audio_url = refAudios[0];
	} else if (refAudios.length > 1) {
		metadata.references = refAudios.map((audio_url) => ({ audio_url }));
	}

	let accumulatedDuration = 0;
	const fetchSegment = async (segmentText: string): Promise<Buffer> => {
		const body: Record<string, unknown> = {
			model,
			input: segmentText,
			// 统一转存 mp3，便于波形/下载与 MiniMax 路径一致。
			response_format: "mp3",
			metadata,
		};
		if (voiceId) body.voice = voiceId;
		if (speechRate !== null) body.speed = speechRate;

		const upstreamRes = await fetch(`${relay.baseUrl}/v1/audio/speech`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${relay.token}`,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(120_000),
		});
		if (!upstreamRes.ok) {
			const detail = await upstreamRes.text().catch(() => "");
			throw new Error(
				`seed-audio relay failed (${upstreamRes.status}): ${detail.slice(0, 500) || upstreamRes.statusText}`,
			);
		}
		// relay 回桥的实际时长（写 body 前已落响应头），用于按秒结算。
		const durHeader = upstreamRes.headers.get("x-newapi-audio-duration");
		const dur = durHeader ? Number(durHeader) : Number.NaN;
		if (Number.isFinite(dur) && dur > 0) accumulatedDuration += dur;
		const buf = Buffer.from(await upstreamRes.arrayBuffer());
		if (buf.byteLength < 128) {
			throw new Error("seed-audio relay returned empty audio payload");
		}
		return buf;
	};

	const segments = splitSpeechTextIntoSegments(text, DOUBAO_SEGMENT_MAX_CHARS);
	const workDir = await mkdtemp(join(tmpdir(), "seedtts-"));
	let audioBuf: Buffer;
	let durationSec: number | null = null;
	try {
		if (segments.length <= 1) {
			audioBuf = await fetchSegment(segments[0] ?? text);
			const tempFile = join(workDir, "speech.mp3");
			await writeFile(tempFile, audioBuf);
			durationSec = await probeDurationSec(tempFile);
		} else {
			const parts: string[] = [];
			for (let i = 0; i < segments.length; i += 1) {
				const buf = await fetchSegment(segments[i]);
				const partFile = join(workDir, `part-${i}.mp3`);
				await writeFile(partFile, buf);
				parts.push(partFile);
			}
			const listFile = join(workDir, "list.txt");
			await writeFile(
				listFile,
				parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"),
				"utf-8",
			);
			const outFile = join(workDir, "speech.mp3");
			await execFileAsync("ffmpeg", [
				"-y",
				"-f",
				"concat",
				"-safe",
				"0",
				"-i",
				listFile,
				"-c:a",
				"libmp3lame",
				"-q:a",
				"2",
				outFile,
			]);
			audioBuf = Buffer.from(await readFile(outFile));
			durationSec = await probeDurationSec(outFile);
		}
	} finally {
		await rm(workDir, { recursive: true, force: true }).catch(() => {});
	}

	// 时长优先用 ffprobe 实测（更准），无则回退 relay 回桥的累计时长。
	if ((durationSec === null || durationSec <= 0) && accumulatedDuration > 0) {
		durationSec = Math.round(accumulatedDuration * 100) / 100;
	}

	const client = createObjectStorageClientFromConfig(storageConfig);
	const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
	const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	const key = `gen/audio/${safeUser}/${datePrefix}/${randomUUID()}.mp3`;
	await client.send(
		new PutObjectCommand({
			Bucket: storageConfig.bucket,
			Key: key,
			Body: audioBuf,
			ContentType: "audio/mpeg",
			CacheControl: "public, max-age=31536000, immutable",
		}),
	);

	const publicBase = storageConfig.publicBase.trim().replace(/\/+$/, "");
	const url = publicBase ? `${publicBase}/${key}` : `/${key}`;

	return {
		url,
		key,
		bytes: audioBuf.byteLength,
		durationSec,
		model,
		voiceId,
	};
}

export type GenerateMusicInput = {
	/** 曲风/氛围描述（纯音乐模式必填） */
	prompt: string;
	/** 自定义歌词（lyricsMode=custom 时使用） */
	lyrics?: string | null;
	/** auto=AI 自动填词 / custom=自定义歌词 / instrumental=纯音乐 */
	lyricsMode?: "auto" | "custom" | "instrumental" | null;
	model?: string | null;
};

export type GenerateMusicResult = {
	url: string;
	key: string;
	bytes: number;
	durationSec: number | null;
	model: string;
};

/**
 * MiniMax 音乐生成（new-api 透传 /v1/music_generation → api.minimaxi.com）。
 * 同步接口，官方耗时约 1-3 分钟；data.audio 可能是 URL 或 hex。
 */
export async function generateMusicToStorage(
	c: AppContext,
	userId: string,
	input: GenerateMusicInput,
): Promise<GenerateMusicResult> {
	const prompt = (input.prompt || "").trim();
	const lyrics = (input.lyrics || "").trim();
	const lyricsMode = input.lyricsMode || "instrumental";
	if (!prompt && !lyrics) throw new Error("prompt or lyrics is required");

	const relay = readNewApiRelayConfig(c);
	if (!relay) throw new Error("NEW_API_INTERNAL_BASE_URL / NEW_API_INTERNAL_TOKEN 未配置");
	const storageConfig = resolveObjectStorageConfig(c.env);
	if (!storageConfig) throw new Error("Object storage is not configured");

	const catalogModel = await requireSelectableAudioModel(c, input.model, "music");
	const model = catalogModel.requestModelKey;
	const body: Record<string, unknown> = {
		model,
		output_format: "url",
	};
	if (prompt) body.prompt = prompt;
	if (lyricsMode === "instrumental") {
		body.is_instrumental = true;
	} else if (lyricsMode === "custom" && lyrics) {
		body.lyrics = lyrics;
	} else {
		// auto：AI 依据 prompt 自动填词
		body.lyrics_optimizer = true;
		if (lyrics) body.lyrics = lyrics;
	}

	const upstreamRes = await fetch(`${relay.baseUrl}/v1/music_generation`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${relay.token}`,
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(300_000),
	});
	const rawText = await upstreamRes.text().catch(() => "");
	if (!upstreamRes.ok) {
		throw new Error(`music relay failed (${upstreamRes.status}): ${rawText.slice(0, 400)}`);
	}
	let parsed: any = null;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		throw new Error(`music relay returned non-JSON payload: ${rawText.slice(0, 200)}`);
	}
	const baseCode = Number(parsed?.base_resp?.status_code ?? 0);
	if (baseCode !== 0) {
		throw new Error(
			`MiniMax music error ${baseCode}: ${parsed?.base_resp?.status_msg || "unknown"}`,
		);
	}
	const audioField = String(parsed?.data?.audio || parsed?.audio || "").trim();
	if (!audioField) throw new Error("MiniMax music response missing audio payload");

	let audioBuf: Buffer;
	if (/^https?:\/\//i.test(audioField)) {
		const audioRes = await fetch(audioField, { signal: AbortSignal.timeout(120_000) });
		if (!audioRes.ok) throw new Error(`failed to download music audio (${audioRes.status})`);
		audioBuf = Buffer.from(await audioRes.arrayBuffer());
	} else {
		// hex 编码音频
		audioBuf = Buffer.from(audioField.replace(/\s+/g, ""), "hex");
	}
	if (audioBuf.byteLength < 1024) throw new Error("music audio payload too small");

	const workDir = await mkdtemp(join(tmpdir(), "music-"));
	let durationSec: number | null = null;
	try {
		const tempFile = join(workDir, "music.mp3");
		await writeFile(tempFile, audioBuf);
		durationSec = await probeDurationSec(tempFile);
	} finally {
		await rm(workDir, { recursive: true, force: true }).catch(() => {});
	}

	const client = createObjectStorageClientFromConfig(storageConfig);
	const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, "_");
	const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
	const key = `gen/audio/${safeUser}/${datePrefix}/${randomUUID()}.mp3`;
	await client.send(
		new PutObjectCommand({
			Bucket: storageConfig.bucket,
			Key: key,
			Body: audioBuf,
			ContentType: "audio/mpeg",
			CacheControl: "public, max-age=31536000, immutable",
		}),
	);
	const publicBase = storageConfig.publicBase.trim().replace(/\/+$/, "");
	return {
		url: publicBase ? `${publicBase}/${key}` : `/${key}`,
		key,
		bytes: audioBuf.byteLength,
		durationSec,
		model,
	};
}
