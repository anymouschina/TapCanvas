import type { AppContext, WorkerEnv } from "../../types";
import { AppError } from "../../middleware/error";
import { SoraVideoDraftResponseSchema } from "./sora.schemas";
import { resolveVendorContext } from "../task/task.service";

function normalizeBaseUrl(raw: string | null | undefined): string {
	const val = (raw || "").trim();
	if (!val) return "";
	return val.replace(/\/+$/, "");
}

function isGrsaiBaseUrl(url: string): boolean {
	const val = url.toLowerCase();
	// New Sora2API/GRSAI protocol uses chat/completions for character/image.
	// Treat sora2api domain as new protocol base as well.
	return val.includes("grsai") || val.includes("sora2api");
}

type SoraToken = {
	id: string;
	label: string;
	secretToken: string;
	userAgent: string | null;
	shared: boolean;
	providerVendor: string;
	providerBaseUrl: string | null;
};

async function listSoraTokens(
	c: AppContext,
	userId: string,
	vendor: string,
): Promise<SoraToken[]> {
	const sql = `
    SELECT
      t.id,
      t.label,
      t.secret_token as secretToken,
      t.user_agent as userAgent,
      t.shared as shared,
      p.vendor as providerVendor,
      p.base_url as providerBaseUrl
    FROM model_tokens t
    JOIN model_providers p ON p.id = t.provider_id
    WHERE t.enabled = 1
      AND p.vendor = ?
      AND (t.user_id = ? OR t.shared = 1)
    ORDER BY t.created_at ASC
  `;

	const { results } = await c.env.DB.prepare(sql)
		.bind(vendor, userId)
		.all<SoraToken>();
	return results ?? [];
}

async function resolveSoraToken(
	c: AppContext,
	userId: string,
	tokenId?: string | null,
): Promise<SoraToken> {
	const vendor = "sora";
	if (tokenId) {
		const sql = `
      SELECT
        t.id,
        t.label,
        t.secret_token as secretToken,
        t.user_agent as userAgent,
        t.shared as shared,
        p.vendor as providerVendor,
        p.base_url as providerBaseUrl
      FROM model_tokens t
      JOIN model_providers p ON p.id = t.provider_id
      WHERE t.id = ?
        AND t.enabled = 1
        AND p.vendor = ?
        AND (t.user_id = ? OR t.shared = 1)
      LIMIT 1
    `;
		const row = await c.env.DB.prepare(sql)
			.bind(tokenId, vendor, userId)
			.first<SoraToken>();
		if (row) return row;
	}

	const tokens = await listSoraTokens(c, userId, vendor);
	if (!tokens.length) {
		throw new AppError("未找到可用的 Sora Token", {
			status: 400,
			code: "sora_token_missing",
		});
	}
	return tokens[0];
}

// 尝试解析 Sora2API Token（model_providers.vendor = 'sora2api'）
async function resolveSora2ApiToken(
	c: AppContext,
	userId: string,
	tokenId?: string | null,
): Promise<SoraToken> {
	const vendor = "sora2api";
	if (tokenId) {
		const sql = `
      SELECT
        t.id,
        t.label,
        t.secret_token as secretToken,
        t.user_agent as userAgent,
        t.shared as shared,
        p.vendor as providerVendor,
        p.base_url as providerBaseUrl
      FROM model_tokens t
      JOIN model_providers p ON p.id = t.provider_id
      WHERE t.id = ?
        AND t.enabled = 1
        AND p.vendor = ?
        AND (t.user_id = ? OR t.shared = 1)
      LIMIT 1
    `;
		const row = await c.env.DB.prepare(sql)
			.bind(tokenId, vendor, userId)
			.first<SoraToken>();
		if (row) return row;
	}

	const tokens = await listSoraTokens(c, userId, vendor);
	if (!tokens.length) {
		throw new AppError("未找到可用的 Sora2API Token", {
			status: 400,
			code: "sora_token_missing",
		});
	}
	return tokens[0];
}

function getDefaultSoraBase(env: WorkerEnv, vendor?: string | null): string {
	const v = (vendor || "").toLowerCase();
	if (v === "sora2api") {
		const envVal =
			env.SORA2API_BASE_URL ||
			// 兼容早期自定义绑定名称
			((env as any).SORA2API_BASE as string | undefined) ||
			"http://localhost:8000";
		return String(envVal).trim();
	}
	return "https://sora.chatgpt.com";
}

function buildSoraBaseUrl(env: WorkerEnv, token: SoraToken): string {
	return (token.providerBaseUrl ||
		getDefaultSoraBase(env, token.providerVendor)).replace(
		/\/+$/,
		"",
	);
}

function decodeJwtPayload(token: string): any | null {
	const parts = token.split(".");
	if (parts.length < 2) return null;
	const payloadSeg = parts[1];
	try {
		let base64 = payloadSeg.replace(/-/g, "+").replace(/_/g, "/");
		const pad = base64.length % 4;
		if (pad) base64 += "=".repeat(4 - pad);
		const json = atob(base64);
		return JSON.parse(json);
	} catch {
		return null;
	}
}

async function resolveSoraProfileId(
	token: SoraToken,
	baseUrl: string,
): Promise<string> {
	let profileId: string | undefined;

	const payload = decodeJwtPayload(token.secretToken);
	if (payload && typeof payload === "object") {
		const auth = (payload as any)["https://api.openai.com/auth"] || {};
		const uid =
			auth.user_id ||
			(payload as any).user_id ||
			undefined;
		if (typeof uid === "string" && uid.startsWith("user-")) {
			profileId = uid;
		}
	}

	if (!profileId) {
		const sessionUrl = new URL("/api/auth/session", baseUrl).toString();
		const res = await fetch(sessionUrl, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${token.secretToken}`,
				"User-Agent": token.userAgent || "TapCanvas/1.0",
				Accept: "application/json",
			},
		});
		if (res.ok) {
			try {
				const data: any = await res.json();
				profileId =
					data?.user?.user_id ||
					data?.user?.id ||
					data?.user_id ||
					undefined;
			} catch {
				// ignore parse error
			}
		}
	}

	if (!profileId) {
		throw new AppError("Sora session missing profile user id", {
			status: 502,
			code: "sora_profile_missing",
		});
	}

	return profileId;
}

export async function unwatermarkVideo(c: AppContext, url: string) {
	const soraUrl = url.trim();
	if (!soraUrl) {
		throw new AppError("url is required", {
			status: 400,
			code: "invalid_request",
		});
	}

	const endpoint =
		(c.env as any).SORA_UNWATERMARK_ENDPOINT?.trim() ||
		"https://sorai.me/get-sora-link";

	let res: Response;
	try {
		res = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ url: soraUrl }),
		});
	} catch (error: any) {
		throw new AppError("Failed to call unwatermark endpoint", {
			status: 502,
			code: "unwatermark_upstream_error",
			details: {
				message: error?.message ?? String(error),
			},
		});
	}

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok || (data && data.error)) {
		const message =
			(typeof data?.error === "string" && data.error) ||
			`Sora unwatermark failed: ${res.status}`;
		throw new AppError(message, {
			status: 502,
			code: "unwatermark_upstream_error",
			details: {
				upstreamStatus: res.status,
				upstreamBody: data,
			},
		});
	}

	const downloadUrl: unknown = data?.download_link ?? data?.downloadLink;
	if (typeof downloadUrl !== "string" || !downloadUrl.trim()) {
		throw new AppError("解析成功但未返回下载链接", {
			status: 502,
			code: "unwatermark_missing_download_url",
			details: {
				upstreamStatus: res.status,
				upstreamBody: data,
			},
		});
	}

	return {
		downloadUrl: downloadUrl.trim(),
		raw: data,
	};
}

export async function createSoraVideoTask(
	c: AppContext,
	userId: string,
	input: {
		tokenId?: string | null;
		prompt: string;
		orientation: "portrait" | "landscape" | "square";
		size?: string;
		n_frames?: number;
		inpaintFileId?: string | null;
		imageUrl?: string | null;
		remixTargetId?: string | null;
		operation?: string | null;
		title?: string | null;
	},
) {
	const token = await resolveSoraToken(c, userId, input.tokenId ?? undefined);
	if ((token.providerVendor || "").toLowerCase() !== "sora") {
		throw new AppError("token not found or not a Sora token", {
			status: 400,
			code: "invalid_sora_token",
		});
	}

	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL("/backend/nf/create", baseUrl).toString();
	const userAgent = token.userAgent || "TapCanvas/1.0";

	const body: any = {
		kind: "video",
		prompt: input.prompt,
		title: input.title ?? null,
		orientation: input.orientation || "portrait",
		size: input.size || "small",
		n_frames:
			typeof input.n_frames === "number" ? input.n_frames : 300,
		inpaint_items: input.inpaintFileId
			? [{ kind: "file", file_id: input.inpaintFileId }]
			: [],
		remix_target_id: input.remixTargetId ?? null,
		metadata: null,
		cameo_ids: null,
		cameo_replacements: null,
		model: "sy_8",
		style_id: null,
		audio_caption: null,
		audio_transcript: null,
		video_caption: null,
		storyboard_id: null,
	};
	if (input.operation) {
		body.operation = input.operation;
	}

	const nowIso = new Date().toISOString();

	let res: Response;
	let data: any = null;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token.secretToken}`,
				"User-Agent": userAgent,
				Accept: "*/*",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("Sora video create request failed", {
			status: 502,
			code: "sora_create_failed",
			details: {
				message: error?.message ?? String(error),
			},
		});
	}

	if (!res.ok) {
		const upstreamError =
			data?.error ||
			(typeof data?.message === "object" ? data.message : null);
		const msg =
			(upstreamError && upstreamError.message) ||
			data?.message ||
			data?.error ||
			`Sora video create failed with status ${res.status}`;

		throw new AppError(msg, {
			status: res.status,
			code: "sora_create_failed",
			details: {
				upstreamStatus: res.status,
				upstreamData: data ?? null,
			},
		});
	}

	const result: any = data ?? {};
	// Record basic history if task id exists
	if (result.id && typeof result.id === "string") {
		const id = crypto.randomUUID();
		await c.env.DB.prepare(
			`INSERT INTO video_generation_histories
       (id, user_id, node_id, project_id, prompt, parameters, image_url,
        task_id, generation_id, status, video_url, thumbnail_url,
        duration, width, height, token_id, provider, model, cost,
        is_favorite, rating, notes, remix_target_id, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, ?, NULL,
        ?, NULL, ?, NULL, NULL,
        NULL, NULL, NULL, ?, ?, NULL, NULL,
        0, NULL, NULL, ?, ?, ?)
      `,
		)
			.bind(
				id,
				userId,
				input.prompt,
				JSON.stringify({
					orientation: input.orientation,
					size: input.size,
					n_frames: input.n_frames,
					inpaintFileId: input.inpaintFileId,
					imageUrl: input.imageUrl,
					remixTargetId: input.remixTargetId,
				}),
				result.id,
				"pending",
				token.id,
				"sora",
				input.remixTargetId ?? null,
				nowIso,
				nowIso,
			)
			.run();
	}

	result.__usedTokenId = token.id;
	result.__switchedFromTokenIds = [];
	result.__tokenSwitched = false;
	return result;
}

export async function listSoraPendingVideos(c: AppContext, userId: string) {
	// Simplified implementation: query pending from the first Sora token if available.
	let token: SoraToken | null = null;
	try {
		token = await resolveSoraToken(c, userId);
	} catch {
		return [];
	}

	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL("/backend/nf/pending", baseUrl).toString();
	const userAgent = token.userAgent || "TapCanvas/1.0";

	try {
		const res = await fetch(url, {
			method: "GET",
			headers: {
				Authorization: `Bearer ${token.secretToken}`,
				"User-Agent": userAgent,
				Accept: "*/*",
			},
		});

		let data: any = null;
		try {
			data = await res.json();
		} catch {
			data = null;
		}

		if (!res.ok) {
			return [];
		}

		if (Array.isArray(data)) return data;
		if (Array.isArray(data?.items)) return data.items;
		return [];
	} catch {
		return [];
	}
}

export async function listSoraDrafts(
	c: AppContext,
	userId: string,
	input: { tokenId?: string | null; cursor?: string | null; limit?: number },
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL("/backend/project_y/profile/drafts", baseUrl);
	const params: Record<string, string> = {};
	if (input.cursor) params.cursor = input.cursor;
	if (typeof input.limit === "number" && !Number.isNaN(input.limit)) {
		params.limit = String(input.limit);
	}
	Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

	const userAgent = token.userAgent || "TapCanvas/1.0";

	const res = await fetch(url.toString(), {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": userAgent,
			Accept: "application/json",
		},
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error)) ||
			`Sora drafts request failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_drafts_failed",
		});
	}

	const rawItems: any[] = Array.isArray(data?.items)
		? data.items
		: Array.isArray(data)
			? data
			: [];
	const items = rawItems.map((item) => {
		const enc = item.encodings || {};
		const rawThumbnail =
			enc.thumbnail?.path ||
			item.preview_image_url ||
			item.thumbnail_url ||
			null;
		const rawVideoUrl =
			item.downloadable_url || item.url || enc.source?.path || null;

		const rawCreated: any = (item as any).created_at;
		let createdAt: number | null = null;
		if (typeof rawCreated === "number" && !Number.isNaN(rawCreated)) {
			createdAt = rawCreated;
		} else if (typeof rawCreated === "string") {
			const ts = Date.parse(rawCreated);
			if (!Number.isNaN(ts)) {
				createdAt = Math.floor(ts / 1000);
			}
		}

		return {
			id: String(item.id),
			kind: item.kind ?? "sora_draft",
			title: item.title ?? null,
			prompt:
				item.prompt ??
					item.creation_config?.prompt ??
					null,
			width: item.width ?? null,
			height: item.height ?? null,
			generationType: item.generation_type ?? null,
			createdAt,
			thumbnailUrl: rawThumbnail,
			videoUrl: rawVideoUrl,
			platform: "sora" as const,
		};
	});

	return {
		items,
		cursor: data?.cursor ?? null,
	};
}

export async function deleteSoraDraft(
	c: AppContext,
	userId: string,
	input: { tokenId: string; draftId: string },
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL(
		`/backend/project_y/profile/drafts/${input.draftId}`,
		baseUrl,
	).toString();

	const res = await fetch(url, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "*/*",
		},
	});

	if (!res.ok) {
		throw new AppError("Sora delete draft request failed", {
			status: res.status,
			code: "sora_delete_draft_failed",
		});
	}
}

export async function getSoraVideoDraftByTask(
	c: AppContext,
	userId: string,
	input: { tokenId?: string | null; taskId: string },
) {
	// Simplified: search across all user's Sora tokens in drafts
	const tokens = await listSoraTokens(c, userId);
	if (!tokens.length) {
		throw new AppError("No Sora tokens available", {
			status: 400,
			code: "sora_token_missing",
		});
	}

	const preferredId = input.tokenId ?? null;
	const orderedTokens = [...tokens];
	if (preferredId) {
		orderedTokens.sort((a, b) => {
			if (a.id === preferredId && b.id !== preferredId) return -1;
			if (a.id !== preferredId && b.id === preferredId) return 1;
			return 0;
		});
	}

	for (const token of orderedTokens) {
		const baseUrl = buildSoraBaseUrl(c.env, token);
		const url = new URL("/backend/project_y/profile/drafts", baseUrl);
		url.searchParams.set("limit", "20");
		const userAgent = token.userAgent || "TapCanvas/1.0";

		try {
			const res = await fetch(url.toString(), {
				method: "GET",
				headers: {
					Authorization: `Bearer ${token.secretToken}`,
					"User-Agent": userAgent,
					Accept: "application/json",
				},
			});
			let data: any = null;
			try {
				data = await res.json();
			} catch {
				data = null;
			}
			if (!res.ok) {
				continue;
			}
			const items: any[] = Array.isArray(data?.items)
				? data.items
				: Array.isArray(data)
					? data
					: [];
			const needle = String(input.taskId);
			const matched = items.find((item) => {
				try {
					const text = JSON.stringify(item);
					return text.includes(needle);
				} catch {
					return false;
				}
			});
			if (!matched) continue;

			const enc = matched.encodings || {};
			const rawThumbnail =
				enc.thumbnail?.path ||
				matched.preview_image_url ||
				matched.thumbnail_url ||
				null;
			const rawVideoUrl =
				matched.downloadable_url ||
				matched.url ||
				enc.source?.path ||
				null;

			const draft = {
				id: String(matched.id),
				title: matched.title ?? null,
				prompt:
					matched.prompt ??
					matched.creation_config?.prompt ??
					null,
				thumbnailUrl: rawThumbnail,
				videoUrl: rawVideoUrl,
				postId: null,
				status:
					(typeof matched.status === "string" &&
						matched.status) ||
					null,
				progress:
					typeof matched.progress === "number"
						? matched.progress
						: null,
				raw: matched,
			};

			// Update history when video becomes available
			const videoUrl =
				draft.videoUrl && typeof draft.videoUrl === "string"
					? draft.videoUrl
					: null;
			const thumb =
				draft.thumbnailUrl &&
				typeof draft.thumbnailUrl === "string"
					? draft.thumbnailUrl
					: null;
			const duration =
				typeof (matched as any).duration === "number"
					? (matched as any).duration
					: null;
			const width =
				typeof (matched as any).width === "number"
					? (matched as any).width
					: null;
			const height =
				typeof (matched as any).height === "number"
					? (matched as any).height
					: null;
			const generationId =
				(matched as any).generation_id ||
				(matched as any).id ||
				null;

			const nowIso = new Date().toISOString();
			await c.env.DB.prepare(
				`UPDATE video_generation_histories
         SET status = ?, video_url = ?, thumbnail_url = ?,
             duration = ?, width = ?, height = ?, generation_id = ?, updated_at = ?
         WHERE user_id = ? AND task_id = ?`,
			)
				.bind(
					"success",
					videoUrl,
					thumb,
					duration,
					width,
					height,
					generationId,
					nowIso,
					userId,
					input.taskId,
				)
				.run();

			return SoraVideoDraftResponseSchema.parse(draft);
		} catch {
			continue;
		}
	}

	throw new AppError(
		"在所有 Sora 账号的草稿中未找到对应视频，请稍后再试",
		{
			status: 404,
			code: "sora_draft_not_found",
		},
	);
}

export async function listSoraCharacters(
	c: AppContext,
	userId: string,
	input: { tokenId?: string | null; cursor?: string | null; limit?: number },
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const profileId = await resolveSoraProfileId(token, baseUrl);
	const url = new URL(
		`/backend/project_y/profile/${profileId}/characters`,
		baseUrl,
	);
	if (input.cursor) url.searchParams.set("cursor", input.cursor);
	if (typeof input.limit === "number" && !Number.isNaN(input.limit)) {
		url.searchParams.set("limit", String(input.limit));
	}

	const res = await fetch(url.toString(), {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "application/json",
		},
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error)) ||
			`Sora characters request failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_characters_failed",
		});
	}

	const items: any[] = Array.isArray(data?.items)
		? data.items
		: Array.isArray(data)
			? data
			: [];

	return {
		items,
		cursor: data?.cursor ?? null,
	};
}

export async function deleteSoraCharacter(
	c: AppContext,
	userId: string,
	input: { tokenId: string; characterId: string },
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL(
		`/backend/project_y/characters/${input.characterId}`,
		baseUrl,
	).toString();

	const res = await fetch(url, {
		method: "DELETE",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "*/*",
		},
	});

	if (!res.ok) {
		throw new AppError("Sora delete character request failed", {
			status: res.status,
			code: "sora_delete_character_failed",
		});
	}
}

export async function updateSoraCharacter(
	c: AppContext,
	userId: string,
	input: {
		tokenId: string;
		characterId: string;
		username?: string;
		display_name?: string | null;
		profile_asset_pointer?: any;
	},
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL(
		`/backend/project_y/characters/${input.characterId}/update`,
		baseUrl,
	).toString();

	const body: any = {};
	if (typeof input.username === "string") {
		body.username = input.username;
	}
	if ("display_name" in input) {
		body.display_name = input.display_name ?? null;
	}
	if ("profile_asset_pointer" in input) {
		body.profile_asset_pointer = input.profile_asset_pointer ?? null;
	}

	let res: Response;
	let data: any = null;
	try {
		res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token.secretToken}`,
				"User-Agent": token.userAgent || "TapCanvas/1.0",
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("Sora update character request failed", {
			status: 502,
			code: "sora_update_character_failed",
			details: {
				message: error?.message ?? String(error),
			},
		});
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error)) ||
			`Sora update character failed with status ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_update_character_failed",
			details: {
				upstreamStatus: res.status,
				upstreamData: data ?? null,
			},
		});
	}

	return data;
}

export async function checkCharacterUsername(
	c: AppContext,
	userId: string,
	input: { tokenId?: string | null; username: string },
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL(
		"/backend/project_y/profile/username/check",
		baseUrl,
	).toString();

	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "*/*",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ username: input.username }),
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error)) ||
			`Sora username check failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_username_check_failed",
		});
	}

	return data;
}

export async function searchSoraMentions(
	c: AppContext,
	userId: string,
	input: { tokenId?: string | null; username: string; intent?: string; limit?: number },
) {
	// 优先尝试使用官方 Sora Token；若未配置，则兜底使用 Sora2API Token。
	let token: SoraToken;
	try {
		token = await resolveSoraToken(c, userId, input.tokenId);
	} catch (err: any) {
		const isAppError =
			err instanceof AppError ||
			(!!err &&
				typeof err === "object" &&
				"code" in err &&
				"status" in err);
		const code = isAppError ? (err as any).code : null;
		if (code !== "sora_token_missing") {
			throw err;
		}
		// 没有 Sora Token 时，尝试使用 Sora2API Token 兜底；如果仍然没有，则视为未配置。
		try {
			token = await resolveSora2ApiToken(c, userId, input.tokenId);
		} catch {
			// 对于纯 mentions 功能，缺少 Token 时退化为“无结果”而非报错，避免打断编辑体验。
			return { items: [] };
		}
	}

	// 若 token 来自 Sora2API，自建服务通常不提供 profile/search_mentions，直接退化为空列表。
	if ((token.providerVendor || "").toLowerCase() === "sora2api") {
		return { items: [] };
	}

	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL(
		"/backend/project_y/profile/search_mentions",
		baseUrl,
	);
	url.searchParams.set("username", input.username);
	url.searchParams.set("intent", input.intent || "cameo");
	if (typeof input.limit === "number" && !Number.isNaN(input.limit)) {
		url.searchParams.set("limit", String(input.limit));
	}

	const res = await fetch(url.toString(), {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "*/*",
		},
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error)) ||
			`Sora search mentions failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_mentions_failed",
		});
	}

	return data;
}

export async function getCameoStatus(
	c: AppContext,
	userId: string,
	input: { tokenId: string; id: string },
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL(
		`/backend/project_y/cameos/in_progress/${input.id}`,
		baseUrl,
	).toString();

	const res = await fetch(url, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "application/json",
		},
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error)) ||
			`Sora cameo status failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_cameo_status_failed",
		});
	}

	return data;
}

export async function setCameoPublic(
	c: AppContext,
	userId: string,
	input: { tokenId: string; cameoId: string },
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL(
		`/backend/project_y/cameos/by_id/${input.cameoId}/update_v2`,
		baseUrl,
	).toString();

	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ visibility: "public" }),
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error)) ||
			`Sora set cameo public failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_cameo_public_failed",
		});
	}

	return data;
}

export async function finalizeCharacter(
	c: AppContext,
	userId: string,
	input: {
		tokenId: string;
		cameo_id: string;
		username: string;
		display_name: string;
		profile_asset_pointer: any;
	},
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL("/backend/characters/finalize", baseUrl).toString();

	const body = {
		cameo_id: input.cameo_id,
		username: input.username,
		display_name: input.display_name,
		profile_asset_pointer: input.profile_asset_pointer,
		instruction_set: null,
		safety_instruction_set: null,
	};

	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error)) ||
			`Sora finalize character failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_finalize_character_failed",
			details: {
				upstreamStatus: res.status,
				upstreamData: data ?? null,
			},
		});
	}

	return data;
}

async function uploadSoraFile(
	token: SoraToken,
	baseUrl: string,
	file: File,
	useCase: string,
): Promise<any> {
	const url = new URL("/backend/project_y/file/upload", baseUrl).toString();
	const form = new FormData();
	const filename = (file as any).name || "upload.bin";
	form.append("file", file, filename);
	form.append("use_case", useCase);

	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "application/json",
		},
		body: form,
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const rawMessage = data && (data.message || data.error);
		const msg =
			typeof rawMessage === "string"
				? rawMessage
				: `Sora file upload failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_upload_failed",
			details: {
				upstreamStatus: res.status,
				upstreamData: data ?? null,
			},
		});
	}

	return data;
}

export async function uploadProfileAsset(
	c: AppContext,
	userId: string,
	input: { tokenId: string; file: File },
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	return uploadSoraFile(token, baseUrl, input.file, "profile");
}

export async function uploadSoraImage(
	c: AppContext,
	userId: string,
	input: { tokenId?: string | null; file: File },
) {
	let sora2Token: SoraToken | null = null;
	let soraToken: SoraToken | null = null;

	// 1) 优先尝试使用 Sora2API Token（与 Nest 版保持一致：/sora/upload/image 专供 sora2api）
	try {
		sora2Token = await resolveSora2ApiToken(c, userId, input.tokenId);
	} catch (err: any) {
		const isAppError =
			err instanceof AppError ||
			(!!err &&
				typeof err === "object" &&
				"code" in err &&
				"status" in err);
		const code = isAppError ? (err as any).code : null;
		if (code !== "sora_token_missing") {
			throw err;
		}
	}

	// 2) 若未配置 sora2api，再尝试使用 Sora 官方 Token。
	if (!sora2Token) {
		try {
			soraToken = await resolveSoraToken(c, userId, input.tokenId);
		} catch (err: any) {
			const isAppError =
				err instanceof AppError ||
				(!!err &&
					typeof err === "object" &&
					"code" in err &&
					"status" in err);
			const code = isAppError ? (err as any).code : null;
			// 仅在「未找到可用的 Sora Token」时启用 OSS 兜底，其它错误继续抛出。
			if (code !== "sora_token_missing") {
				throw err;
			}
		}
	}

	const tryUploadWithToken = async (
		token: SoraToken | null,
	): Promise<any | null> => {
		if (!token) return null;
		const baseUrl = buildSoraBaseUrl(c.env, token);
		try {
			return await uploadSoraFile(
				token,
				baseUrl,
				input.file,
				"profile",
			);
		} catch (err: any) {
			const isAppError = err instanceof AppError;
			const status = isAppError ? err.status : undefined;
			const code = isAppError ? err.code : undefined;
			// 对于认证失败 / 无权限 / 路由不存在等情况，视为该 Token 不可用，继续尝试下一个。
			if (
				isAppError &&
				code === "sora_upload_failed" &&
				(status === 401 ||
					status === 403 ||
					status === 404)
			) {
				return null;
			}
			throw err;
		}
	};

	// 先尝试 sora2api，再尝试官方 Sora。
	let uploadResult = await tryUploadWithToken(sora2Token);
	if (!uploadResult) {
		uploadResult = await tryUploadWithToken(soraToken);
	}
	if (uploadResult) {
		return uploadResult;
	}

	// 3) 两种 Token 都没有：上传到 OSS（R2）兜底。
	const bucket = (c.env as any).R2_ASSETS as R2Bucket | undefined;
	if (!bucket) {
		// 环境未绑定 R2，保留原始报错语义，避免静默失败。
		throw new AppError(
			"未找到可用的 Sora/Sora2API Token，且 OSS 存储未配置",
			{
				status: 400,
				code: "sora_token_missing",
			},
		);
	}

	// 生成与 asset.hosting 类似的 key：uploads/sora/<userId>/<yyyymmdd>/<uuid>.<ext>
	const file = input.file;
	const contentType =
		(file.type && String(file.type).split(";")[0].trim()) ||
		"application/octet-stream";

	let ext = "bin";
	const name = (file as any).name as string | undefined;
	if (name && typeof name === "string") {
		const match = name.match(/\.([a-zA-Z0-9]+)$/);
		if (match && match[1]) {
			ext = match[1].toLowerCase();
		}
	}
	if (ext === "bin") {
		if (contentType.startsWith("image/")) {
			ext = contentType.slice("image/".length) || "png";
		} else if (contentType === "video/mp4") {
			ext = "mp4";
		}
	}

	const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
	const now = new Date();
	const datePrefix = `${now.getUTCFullYear()}${String(
		now.getUTCMonth() + 1,
	).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
	const random = crypto.randomUUID();
	const key = `uploads/sora/${safeUser}/${datePrefix}/${random}.${ext || "bin"}`;

	const body = await file.arrayBuffer();

	await bucket.put(key, body, {
		httpMetadata: {
			contentType,
			cacheControl: "public, max-age=31536000, immutable",
		},
	});

	const publicBase = (c.env.R2_PUBLIC_BASE_URL || "").trim().replace(
		/\/+$/,
		"",
	);
	const url = publicBase ? `${publicBase}/${key}` : `/${key}`;

	// 兼容前端期望的字段：file_id + (asset_pointer|azure_asset_pointer|url)
	return {
		file_id: `r2_${key}`,
		url,
		asset_pointer: url,
		azure_asset_pointer: url,
	};
	}

export async function uploadCharacterVideo(
	c: AppContext,
	userId: string,
	input: { tokenId: string; file: File; range: [number, number] },
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL("/backend/characters/upload", baseUrl).toString();
	const [start, end] = input.range;

	const form = new FormData();
	const filename = (input.file as any).name || "character.mp4";
	form.append("file", input.file, filename);
	form.append("timestamps", `${start},${end}`);

	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "application/json",
		},
		body: form,
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error)) ||
			`Sora upload character video failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_upload_character_failed",
		});
	}

	return data;
}

export async function listSoraPublishedVideos(
	c: AppContext,
	userId: string,
	input: { tokenId?: string | null; limit?: number },
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const url = new URL(
		"/backend/project_y/profile_feed/me",
		baseUrl,
	);
	const limit =
		typeof input.limit === "number" && !Number.isNaN(input.limit)
			? input.limit
			: 8;

	url.searchParams.set("limit", String(limit));
	url.searchParams.set("cut", "nf2");

	const res = await fetch(url.toString(), {
		method: "GET",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "application/json",
		},
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error)) ||
			`Published videos fetch failed with status ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_published_failed",
		});
	}

	const items: any[] = Array.isArray(data?.items)
		? data.items
		: [];

	const processed = items.map((item) => {
		const post = item.post || {};
		const attachments = post.attachments || [];
		const soraAttachment = attachments.find(
			(att: any) => att && att.kind === "sora",
		);

		const rawPostedAt: any = post.posted_at;
		let createdAt: number | null = null;
		if (typeof rawPostedAt === "number" && !Number.isNaN(rawPostedAt)) {
			createdAt = rawPostedAt;
		} else if (typeof rawPostedAt === "string") {
			const ts = Date.parse(rawPostedAt);
			if (!Number.isNaN(ts)) {
				createdAt = Math.floor(ts / 1000);
			}
		}

		if (!soraAttachment) {
			return {
				id: String(post.id),
				kind: "sora_published",
				title: post.text ?? null,
				prompt: post.text ?? null,
				width: null,
				height: null,
				generationType: null,
				createdAt,
				thumbnailUrl: post.preview_image_url ?? null,
				videoUrl: null,
				platform: "sora" as const,
			};
		}

		const enc = soraAttachment.encodings || {};

		const thumbnail =
			enc.thumbnail?.path || post.preview_image_url || null;
		const videoUrl =
			enc.source?.path ||
			soraAttachment.url ||
			soraAttachment.downloadable_url ||
			null;

		return {
			id: String(post.id),
			kind: "sora_published",
			title: post.text ?? null,
			prompt: soraAttachment.prompt ?? post.text ?? null,
			width: soraAttachment.width ?? null,
			height: soraAttachment.height ?? null,
			generationType: null,
			createdAt,
			thumbnailUrl: thumbnail,
			videoUrl,
			platform: "sora" as const,
		};
	});

	return {
		items: processed,
		cursor: data?.cursor ?? null,
	};
}

export async function publishSoraVideo(
	c: AppContext,
	userId: string,
	input: {
		tokenId?: string | null;
		taskId: string;
		postText?: string;
		generationId?: string;
	},
) {
	const token = await resolveSoraToken(c, userId, input.tokenId);
	const baseUrl = buildSoraBaseUrl(c.env, token);
	const finalGenerationId = input.generationId || input.taskId;

	if (!finalGenerationId) {
		throw new AppError("No generation_id provided", {
			status: 400,
			code: "sora_publish_missing_generation",
		});
	}

	let text = (input.postText || "").trim();
	if (!text) {
		throw new AppError("No post text available", {
			status: 400,
			code: "sora_publish_missing_text",
		});
	}

	// Soft truncate to avoid 413 / moderation issues
	const maxLen = 2000;
	if (text.length > maxLen) {
		text = text.slice(0, maxLen);
	}

	const url = new URL("/backend/project_y/post", baseUrl).toString();
	const body = {
		attachments_to_create: [
			{ generation_id: finalGenerationId, kind: "sora" },
		],
		post_text: text,
	};

	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token.secretToken}`,
			"User-Agent": token.userAgent || "TapCanvas/1.0",
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	let data: any = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}

	if (!res.ok) {
		const msg =
			(data && (data.message || data.error)) ||
			`Sora publish video failed: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora_publish_failed",
			details: {
				upstreamStatus: res.status,
				upstreamData: data ?? null,
			},
		});
	}

	const postId =
		(typeof data?.id === "string" && data.id) ||
		(typeof data?.post?.id === "string" && data.post.id) ||
		(typeof data?.post_id === "string" && data.post_id) ||
		null;

	if (postId) {
		const nowIso = new Date().toISOString();
		await c.env.DB.prepare(
			`UPDATE video_generation_histories
       SET updated_at = ?, notes = COALESCE(notes, ''), generation_id = COALESCE(generation_id, ?)
       WHERE user_id = ? AND task_id = ?`,
		)
			.bind(nowIso, finalGenerationId, userId, input.taskId)
			.run();
	}

	return {
		success: !!postId,
		postId,
		message: postId
			? "Video published successfully"
			: "Publish succeeded but no postId returned",
	};
}

// ---------- Sora2API / GRSAI Character helpers ----------

type Sora2ApiCharacterPayload = {
	id: string;
	progress?: number | null;
	status?: string | null;
	results?: Array<{ character_id?: string | null }>;
	error?: string | null;
	failure_reason?: string | null;
	msg?: string | null;
};

function mapSora2ApiStatus(status?: string | null): "running" | "succeeded" | "failed" {
	const normalized = (status || "").toLowerCase();
	if (normalized === "succeeded") return "succeeded";
	if (normalized === "failed") return "failed";
	return "running";
}

function clampCharacterProgress(value?: number | null): number | undefined {
	if (typeof value !== "number" || Number.isNaN(value)) return undefined;
	return Math.max(0, Math.min(100, value));
}

async function callSora2ApiWithFallbacks(
	c: AppContext,
	userId: string,
	endpoints: string[],
	body: Record<string, any>,
	vendor: "sora2api" | "grsai" = "sora2api",
): Promise<{
	id: string;
	payload: any;
	status: "running" | "succeeded" | "failed";
	progress?: number;
	endpoint: string;
}> {
	const ctx = await resolveVendorContext(c, userId, vendor);
	const baseUrl =
		normalizeBaseUrl(ctx.baseUrl) ||
		(vendor === "grsai" ? "https://api.grsai.com" : "http://localhost:8000");
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError(`未配置 ${vendor} API Key`, {
			status: 400,
			code: "sora2api_api_key_missing",
		});
	}

	const normalizeEndpoint = (endpoint: string) => {
		if (!endpoint) return endpoint;
		if (endpoint.startsWith("http")) return endpoint;
		return `${baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;
	};

	let lastError: any = null;
	for (const rawEndpoint of endpoints) {
		const endpoint = normalizeEndpoint(rawEndpoint);
		let res: Response;
		let data: any = null;
		try {
			res = await fetch(endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "text/event-stream,application/json",
					Authorization: `Bearer ${apiKey}`,
				},
				body: JSON.stringify(body),
			});
			const ct = (res.headers.get("content-type") || "").toLowerCase();
			if (ct.includes("application/json")) {
				try {
					data = await res.json();
				} catch {
					data = null;
				}
			} else {
				try {
					data = await res.text();
				} catch {
					data = null;
				}
			}
		} catch (error: any) {
			lastError = {
				status: 502,
				data: null,
				message: error?.message ?? String(error),
				endpoint,
			};
			continue;
		}

		if (res.status < 200 || res.status >= 300) {
			lastError = {
				status: res.status,
				data,
				message:
					(data &&
						(data.error?.message ||
							data.message ||
							data.error)) ||
					`sora2api 请求失败: ${res.status}`,
				endpoint,
			};
			continue;
		}

		const payload = (() => {
			if (typeof data === "string") {
				const lines = data.split(/\r?\n/).filter(Boolean);
				for (let i = lines.length - 1; i >= 0; i -= 1) {
					const line = lines[i];
					const match = line.match(/^data:\s*(\{.*\})\s*$/);
					if (!match) continue;
					try {
						return JSON.parse(match[1]);
					} catch {
						continue;
					}
				}
				return null;
			}
			return typeof data?.code === "number" && data.code === 0 && data.data
				? data.data
				: data;
		})();
		if (!payload) {
			lastError = {
				status: res.status,
				data,
				message: "sora2api 未返回有效 payload",
				endpoint,
			};
			continue;
		}
		if (typeof data?.code === "number" && data.code !== 0) {
			lastError = {
				status: res.status,
				data,
				message:
					data?.msg ||
					data?.message ||
					data?.error ||
					`sora2api 请求失败: code ${data.code}`,
				endpoint,
			};
			continue;
		}

		const id =
			(typeof payload?.id === "string" && payload.id.trim()) ||
			(typeof payload?.taskId === "string" && payload.taskId.trim()) ||
			null;
		if (!id) {
			// grsai chat/completions character-only flow may return character_id directly
			const directCharacterId =
				(typeof payload?.character_id === "string" && payload.character_id.trim()) ||
				(Array.isArray(payload?.results) && payload.results[0]?.character_id
					? String(payload.results[0].character_id).trim()
					: null) ||
				null;
			if (directCharacterId) {
				return {
					id: directCharacterId,
					payload,
					status: "succeeded",
					progress: 100,
					endpoint,
				};
			}
			lastError = {
				status: res.status,
				data,
				message: "sora2api 未返回任务 ID",
				endpoint,
			};
			continue;
		}

		const status = mapSora2ApiStatus(payload.status || data?.status);
		const progress = clampCharacterProgress(
			typeof payload?.progress === "number"
				? payload.progress
				: typeof payload?.progress_pct === "number"
					? payload.progress_pct * 100
					: undefined,
		);

		return {
			id: id.trim(),
			payload,
			status,
			progress,
			endpoint,
		};
	}

	throw new AppError(lastError?.message || "sora2api 调用失败", {
		status: lastError?.status ?? 502,
		code: "sora2api_request_failed",
		details: {
			upstreamStatus: lastError?.status ?? null,
			upstreamData: lastError?.data ?? null,
			endpointTried: lastError?.endpoint ?? null,
		},
	});
}


export async function uploadCharacterViaSora2Api(
	c: AppContext,
	userId: string,
	input: { url: string; timestamps?: string; webHook?: string; shutProgress?: boolean; vendor?: "sora2api" | "grsai" },
) {
	const vendor = input.vendor === "grsai" ? "grsai" : "sora2api";
	const ctx = await resolveVendorContext(c, userId, vendor);
	const baseUrl =
		normalizeBaseUrl(ctx.baseUrl) ||
		(vendor === "grsai" ? "https://api.grsai.com" : "http://localhost:8000");
	const isGrsaiBase = isGrsaiBaseUrl(baseUrl) || ctx.viaProxyVendor === "grsai";
	const body = {
		url: input.url,
		timestamps: input.timestamps || "0,3",
		webHook: typeof input.webHook === "string" ? input.webHook : "-1",
		shutProgress: input.shutProgress === true,
	};
	if (isGrsaiBase) {
		// grsai/Sora2API new protocol: character creation is triggered via /v1/chat/completions (stream=true, empty prompt)
		const model = "sora-video-landscape-10s";
		const completionBody = {
			model,
			stream: true,
			messages: [{ role: "user", content: "" }],
			video: input.url,
			...(input.timestamps ? { timestamps: input.timestamps } : {}),
		};
		const endpoints = ["/v1/chat/completions"];
		return callSora2ApiWithFallbacks(c, userId, endpoints, completionBody, vendor);
	}
	const endpoints = [
		"/v1/video/sora-upload-character",
		"/client/v1/video/sora-upload-character",
		"/client/video/sora-upload-character",
	];
	return callSora2ApiWithFallbacks(c, userId, endpoints, body, vendor);
}


export async function createCharacterFromPidViaSora2Api(
	c: AppContext,
	userId: string,
	input: { pid: string; timestamps?: string; webHook?: string; shutProgress?: boolean; vendor?: "sora2api" | "grsai" },
) {
	const vendor = input.vendor === "grsai" ? "grsai" : "sora2api";
	const body = {
		pid: input.pid,
		timestamps: input.timestamps || "0,3",
		webHook: typeof input.webHook === "string" ? input.webHook : "-1",
		shutProgress: input.shutProgress === true,
	};
	const endpoints = vendor === "grsai"
		? [
				"/v1/video/sora-create-character",
				"/client/v1/video/sora-create-character",
				"/client/video/sora-create-character",
				"/v1/video/characters/create",
				"/client/v1/video/characters/create",
				"/client/video/characters/create",
			]
		: [
				"/v1/video/sora-create-character",
				"/client/v1/video/sora-create-character",
				"/client/video/sora-create-character",
			];
	return callSora2ApiWithFallbacks(c, userId, endpoints, body, vendor);
}

export async function fetchSora2ApiCharacterResult(
	c: AppContext,
	userId: string,
	taskId: string,
) {
	const ctx = await resolveVendorContext(c, userId, "sora2api");
	const baseUrl = normalizeBaseUrl(ctx.baseUrl) || "http://localhost:8000";
	const apiKey = ctx.apiKey.trim();
	if (!apiKey) {
		throw new AppError("未配置 sora2api API Key", {
			status: 400,
			code: "sora2api_api_key_missing",
		});
	}

	const endpoint = `${baseUrl}/v1/draw/result`;
	let res: Response;
	let data: any = null;
	try {
		res = await fetch(endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({ id: taskId }),
		});
		try {
			data = await res.json();
		} catch {
			data = null;
		}
	} catch (error: any) {
		throw new AppError("sora2api 结果查询失败", {
			status: 502,
			code: "sora2api_result_failed",
			details: { message: error?.message ?? String(error) },
		});
	}

	if (res.status < 200 || res.status >= 300) {
		const msg =
			(data &&
				(data.error?.message ||
					data.message ||
					data.error)) ||
			`sora2api 任务查询失败: ${res.status}`;
		throw new AppError(msg, {
			status: res.status,
			code: "sora2api_result_failed",
			details: { upstreamStatus: res.status, upstreamData: data ?? null },
		});
	}

	const payload: Sora2ApiCharacterPayload =
		typeof data?.code === "number" && data.code === 0 && data.data
			? data.data
			: data;

	const status = mapSora2ApiStatus(payload.status);
	const progress = clampCharacterProgress(
		typeof payload.progress === "number"
			? payload.progress
			: typeof (payload as any).progress_pct === "number"
				? (payload as any).progress_pct * 100
				: undefined,
	);
	const firstResult =
		Array.isArray(payload.results) && payload.results.length
			? payload.results[0]
			: null;
	const characterId =
		(typeof firstResult?.character_id === "string" &&
			firstResult.character_id.trim()) ||
		null;

	return {
		id: payload.id,
		status,
		progress,
		characterId,
		raw: payload,
	};
}
