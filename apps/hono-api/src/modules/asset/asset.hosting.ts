import type { AppContext } from "../../types";
import {
	TaskAssetSchema,
	type TaskAssetDto,
	type TaskKind,
} from "../task/task.schemas";
import { createAssetRow } from "./asset.repo";

type HostedAssetMeta = {
	type: "image" | "video";
	url: string;
	thumbnailUrl?: string | null;
	vendor?: string;
	taskKind?: TaskKind;
	prompt?: string | null;
	modelKey?: string | null;
};

function detectExtension(url: string, contentType: string): string {
	const known: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
		"video/mp4": "mp4",
		"video/webm": "webm",
		"video/quicktime": "mov",
	};
	if (contentType && known[contentType]) return known[contentType];
	try {
		const parsed = new URL(url);
		const parts = parsed.pathname.split(".");
		if (parts.length > 1) {
			const ext = parts.pop() || "";
			if (ext && /^[a-z0-9]+$/i.test(ext)) return ext.toLowerCase();
		}
	} catch {
		// ignore
	}
	return "bin";
}

function buildR2Key(userId: string, ext: string, prefix?: string): string {
	const safeUser = (userId || "anon").replace(/[^a-zA-Z0-9_-]/g, "_");
	const date = new Date();
	const datePrefix = `${date.getUTCFullYear()}${String(
		date.getUTCMonth() + 1,
	).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
	const random = crypto.randomUUID();
	const dir = prefix ? prefix.replace(/^\/+|\/+$/g, "") : "gen";
	return `${dir}/${safeUser}/${datePrefix}/${random}.${ext || "bin"}`;
}

async function uploadToR2FromUrl(options: {
	c: AppContext;
	userId: string;
	sourceUrl: string;
	prefix?: string;
}): Promise<{ key: string; url: string } | null> {
	const { c, userId } = options;
	const sourceUrl = (options.sourceUrl || "").trim();
	if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) {
		return null;
	}

	const bucket = (c.env as any).R2_ASSETS as R2Bucket | undefined;
	if (!bucket) {
		console.warn(
			"[asset-hosting] R2_ASSETS binding missing, skip upload",
		);
		// 未绑定 R2，直接使用源地址
		return null;
	}

	let res: Response;
	try {
		res = await fetch(sourceUrl);
	} catch (err: any) {
		console.warn("[asset-hosting] fetch source failed", err?.message || err);
		return null;
	}

	if (!res.ok) {
		console.warn("[asset-hosting] fetch source non-200", res.status);
		return null;
	}

	let body: ArrayBuffer;
	try {
		body = await res.arrayBuffer();
	} catch (err: any) {
		console.warn("[asset-hosting] read source body failed", err?.message || err);
		return null;
	}

	const rawContentType =
		res.headers.get("content-type") || "application/octet-stream";
	const contentType = rawContentType.split(";")[0].trim();
	const ext = detectExtension(sourceUrl, contentType);
	const key = buildR2Key(userId, ext, options.prefix);

	try {
		const obj = await bucket.put(key, body, {
			httpMetadata: {
				contentType,
				cacheControl: "public, max-age=31536000, immutable",
			},
		});
		console.log("[asset-hosting] R2 put ok", obj);
	} catch (err: any) {
		console.warn("[asset-hosting] R2 put failed", err?.message || err);
		return null;
	}

	const publicBase = (c.env.R2_PUBLIC_BASE_URL || "").trim().replace(
		/\/+$/,
		"",
	);
	const url = publicBase ? `${publicBase}/${key}` : `/${key}`;

	return { key, url };
}

function buildGeneratedAssetName(payload: {
	type: "image" | "video";
	prompt?: string | null;
}) {
	const prefix = payload.type === "video" ? "Video" : "Image";
	const cleanedPrompt = (payload.prompt || "").replace(/\s+/g, " ").trim();
	if (cleanedPrompt) {
		const shortened =
			cleanedPrompt.length > 64
				? `${cleanedPrompt.slice(0, 64)}...`
				: cleanedPrompt;
		return `${prefix} | ${shortened}`;
	}
	const now = new Date().toISOString().replace("T", " ").slice(0, 19);
	return `${prefix} ${now}`;
}

async function persistGeneratedAsset(
	c: AppContext,
	userId: string,
	meta: HostedAssetMeta,
) {
	const safeUrl = (meta.url || "").trim();
	if (!safeUrl) return;

	const name = buildGeneratedAssetName({
		type: meta.type,
		prompt: meta.prompt,
	});

	const nowIso = new Date().toISOString();
	await createAssetRow(
		c.env.DB,
		userId,
		{
			name,
			data: {
				kind: "generation",
				type: meta.type,
				url: safeUrl,
				thumbnailUrl: meta.thumbnailUrl ?? null,
				vendor: meta.vendor || null,
				taskKind: meta.taskKind || null,
				prompt: meta.prompt || null,
				modelKey: meta.modelKey || null,
			},
			projectId: null,
		},
		nowIso,
	);
}

export async function hostTaskAssetsInWorker(options: {
	c: AppContext;
	userId: string;
	assets: TaskAssetDto[] | undefined;
	meta?: {
		taskKind?: TaskKind;
		prompt?: string | null;
		vendor?: string;
		modelKey?: string | null;
	};
}): Promise<TaskAssetDto[]> {
	const { c, userId, assets, meta } = options;
	if (!userId || !assets?.length) return assets || [];

	const hosted: TaskAssetDto[] = [];

	for (const asset of assets) {
		const parsed = TaskAssetSchema.safeParse(asset);
		if (!parsed.success) continue;
		let value = parsed.data;

		try {
			const uploaded = await uploadToR2FromUrl({
				c,
				userId,
				sourceUrl: value.url,
				prefix:
					value.type === "video"
						? "gen/videos"
						: "gen/images",
			});
			if (uploaded?.url) {
				value = TaskAssetSchema.parse({
					...value,
					url: uploaded.url,
				});
			}
		} catch (err: any) {
			console.warn(
				"[asset-hosting] uploadToR2FromUrl failed",
				err?.message || err,
			);
		}

		hosted.push(value);

		try {
			await persistGeneratedAsset(c, userId, {
				type: value.type,
				url: value.url,
				thumbnailUrl: value.thumbnailUrl ?? null,
				vendor: meta?.vendor,
				taskKind: meta?.taskKind,
				prompt: meta?.prompt,
				modelKey: meta?.modelKey ?? null,
			});
		} catch (err: any) {
			console.warn(
				"[asset-hosting] persistGeneratedAsset failed",
				err?.message || err,
			);
		}
	}

	return hosted;
}
