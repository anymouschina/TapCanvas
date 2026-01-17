import type { AppContext } from "../../types";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import { AppError } from "../../middleware/error";
import {
	TaskAssetSchema,
	type TaskAssetDto,
	type TaskKind,
} from "../task/task.schemas";
import {
	createAssetRow,
	findGeneratedAssetBySourceUrl,
	updateAssetDataRow,
} from "./asset.repo";
import { resolvePublicAssetBaseUrl } from "./asset.publicBase";

type HostedAssetMeta = {
	type: "image" | "video";
	url: string;
	thumbnailUrl?: string | null;
	vendor?: string;
	taskKind?: TaskKind;
	prompt?: string | null;
	modelKey?: string | null;
	taskId?: string | null;
	sourceUrl?: string | null;
};

function isAssetHostingDisabled(c: AppContext): boolean {
	const hostingDisabledFlag = String(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		((c.env as any).ASSET_HOSTING_DISABLED ?? ""),
	)
		.trim()
		.toLowerCase();
	return (
		hostingDisabledFlag === "1" ||
		hostingDisabledFlag === "true" ||
		hostingDisabledFlag === "yes" ||
		hostingDisabledFlag === "on"
	);
}

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
	bucket: R2Bucket;
	publicBase: string;
}): Promise<{ key: string; url: string }> {
	const { c, userId, bucket } = options;
	const publicBase = options.publicBase.trim().replace(/\/+$/, "");
	const sourceUrl = (options.sourceUrl || "").trim();
	if (!sourceUrl) {
		throw new AppError("Asset hosting failed: sourceUrl is empty", {
			status: 502,
			code: "asset_hosting_source_url_missing",
		});
	}
	if (!/^https?:\/\//i.test(sourceUrl)) {
		throw new AppError("Asset hosting failed: sourceUrl must be http(s)", {
			status: 502,
			code: "asset_hosting_source_url_invalid",
			details: { sourceUrl },
		});
	}

	let res: Response;
	try {
		res = await fetchWithHttpDebugLog(c, sourceUrl, undefined, {
			tag: "asset:fetchSource",
		});
	} catch (err: any) {
		throw new AppError("OSS 上传失败：拉取源文件失败", {
			status: 502,
			code: "asset_hosting_fetch_failed",
			details: { message: err?.message || String(err), sourceUrl },
		});
	}

	if (!res.ok) {
		throw new AppError("OSS 上传失败：拉取源文件返回非 200", {
			status: 502,
			code: "asset_hosting_fetch_non_200",
			details: { upstreamStatus: res.status, sourceUrl },
		});
	}

	const rawContentType =
		res.headers.get("content-type") || "application/octet-stream";
	const contentType = rawContentType.split(";")[0].trim();
	const ext = detectExtension(sourceUrl, contentType);
	const key = buildR2Key(userId, ext, options.prefix);

	try {
		const stream = res.body;
		if (stream) {
			const obj = await bucket.put(key, stream, {
				httpMetadata: {
					contentType,
					cacheControl: "public, max-age=31536000, immutable",
				},
			});
			console.log("[asset-hosting] R2 put ok", obj);
		} else {
			const buf = await res.arrayBuffer();
			const obj = await bucket.put(key, buf, {
				httpMetadata: {
					contentType,
					cacheControl: "public, max-age=31536000, immutable",
				},
			});
			console.log("[asset-hosting] R2 put ok", obj);
		}
	} catch (err: any) {
		throw new AppError("OSS 上传失败：写入对象存储失败", {
			status: 500,
			code: "asset_hosting_put_failed",
			details: { message: err?.message || String(err), sourceUrl },
		});
	}

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
				taskId:
					typeof meta.taskId === "string" && meta.taskId.trim()
						? meta.taskId.trim()
						: null,
				sourceUrl:
					typeof meta.sourceUrl === "string"
						? meta.sourceUrl
						: null,
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
		taskId?: string | null;
	};
}): Promise<TaskAssetDto[]> {
	const { c, userId, assets, meta } = options;
	if (!userId || !assets?.length) return assets || [];

	const hosted: TaskAssetDto[] = [];
	const publicBase = resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");
	const hostingDisabled = isAssetHostingDisabled(c);
	let cachedBucket: R2Bucket | null = null;
	const getBucketOrThrow = (): R2Bucket => {
		if (cachedBucket) return cachedBucket;
		const bucket = (c.env as any).R2_ASSETS as R2Bucket | undefined;
		if (!bucket) {
			throw new AppError("OSS storage is not configured", {
				status: 500,
				code: "oss_not_configured",
				details: { binding: "R2_ASSETS" },
			});
		}
		cachedBucket = bucket;
		return bucket;
	};
	const isHostedUrl = (url: string): boolean => {
		const trimmed = (url || "").trim();
		if (!trimmed) return false;
		if (publicBase) return trimmed.startsWith(`${publicBase}/`);
		return /^\/?gen\//.test(trimmed);
	};

	for (const asset of assets) {
		const parsed = TaskAssetSchema.safeParse(asset);
		if (!parsed.success) continue;
		let value = parsed.data;

		const originalUrl = (value.url || "").trim();
		if (!originalUrl) {
			continue;
		}

		let reusedExisting = false;
		let didUpload = false;
		let existingRowId: string | null = null;
		let existingRowData: any = null;

		try {
			const existing = await findGeneratedAssetBySourceUrl(
				c.env.DB,
				userId,
				originalUrl,
			);
			if (existing && existing.data) {
				existingRowId = existing.id;
				let parsedData: any = null;
				try {
					parsedData = JSON.parse(existing.data);
				} catch {
					parsedData = null;
				}
				existingRowData = parsedData;
				const existingUrl =
					parsedData && typeof parsedData.url === "string"
						? parsedData.url.trim()
						: "";
				const existingThumb =
					parsedData &&
					typeof parsedData.thumbnailUrl === "string"
						? parsedData.thumbnailUrl
						: value.thumbnailUrl ?? null;

				if (existingUrl && isHostedUrl(existingUrl)) {
					value = TaskAssetSchema.parse({
						...value,
						url: existingUrl,
						thumbnailUrl: existingThumb,
					});
					reusedExisting = true;
				}
			}
		} catch (err: any) {
			console.warn(
				"[asset-hosting] findGeneratedAssetBySourceUrl failed",
				err?.message || err,
			);
		}

		if (!reusedExisting) {
			if (!hostingDisabled && !isHostedUrl(originalUrl)) {
				const uploaded = await uploadToR2FromUrl({
					c,
					userId,
					sourceUrl: originalUrl,
					prefix:
						value.type === "video"
							? "gen/videos"
							: "gen/images",
					bucket: getBucketOrThrow(),
					publicBase,
				});
				value = TaskAssetSchema.parse({
					...value,
					url: uploaded.url,
				});
				didUpload = true;
			}
		}

		if (!hostingDisabled) {
			const thumbRaw =
				typeof value.thumbnailUrl === "string"
					? value.thumbnailUrl.trim()
					: "";
			if (
				thumbRaw &&
				thumbRaw !== value.url &&
				!isHostedUrl(thumbRaw)
			) {
				const uploadedThumb = await uploadToR2FromUrl({
					c,
					userId,
					sourceUrl: thumbRaw,
					prefix: "gen/thumbnails",
					bucket: getBucketOrThrow(),
					publicBase,
				});
				value = TaskAssetSchema.parse({
					...value,
					thumbnailUrl: uploadedThumb.url,
				});
			}
		}

		hosted.push(value);

		if (!reusedExisting) {
			if (existingRowId && !didUpload) {
				// 已存在旧记录（可能是未托管 URL）；本次未成功上传时不重复写入
			} else {
				try {
					if (existingRowId && didUpload) {
						const nowIso = new Date().toISOString();
						const baseData =
							existingRowData && typeof existingRowData === "object"
								? existingRowData
								: {};
						await updateAssetDataRow(
							c.env.DB,
							userId,
							existingRowId,
							{
								...baseData,
								kind: "generation",
								type: value.type,
								url: value.url,
								thumbnailUrl: value.thumbnailUrl ?? null,
								vendor: meta?.vendor || null,
								taskKind: meta?.taskKind || null,
								prompt: meta?.prompt || null,
								modelKey: meta?.modelKey ?? null,
								taskId: meta?.taskId ?? null,
								sourceUrl: originalUrl,
							},
							nowIso,
						);
					} else {
						await persistGeneratedAsset(c, userId, {
							type: value.type,
							url: value.url,
							thumbnailUrl: value.thumbnailUrl ?? null,
							vendor: meta?.vendor,
							taskKind: meta?.taskKind,
							prompt: meta?.prompt,
							modelKey: meta?.modelKey ?? null,
							taskId: meta?.taskId ?? null,
							sourceUrl: originalUrl,
						});
					}
				} catch (err: any) {
					console.warn(
						"[asset-hosting] persistGeneratedAsset failed",
						err?.message || err,
					);
				}
			}
		}
	}

	return hosted;
}
