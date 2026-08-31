// Server-side video poster extraction.
//
// WHY: canvas video shells are poster-first — without a server poster every client has to mount a
// throwaway <video> per clip just to paint frame 0 (a whole chapter of mp4 fetches + decodes on
// every visit, per browser). Extracting a representative opening frame ONCE here, while the video bytes are
// already on local disk for the TOS upload, kills that entire client-side pipeline: the shell gets
// a plain <img> URL (videoResults[].thumbnailUrl) and never touches the mp4.
//
// Best-effort by design: a poster failure must never fail the video hosting itself.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { promisify } from "node:util";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";

import { FFMPEG_EXEC_OPTS } from "../task/subprocess-limits";
import {
	type LocalAssetStorageConfig,
	writeLocalAssetBytes,
} from "./local-asset-storage";

const execFileAsync = promisify(execFile);

// Poster is a thumbnail, not a full frame — cap the long edge (matches the client-side capture cap).
const MAX_POSTER_EDGE = 640;

// 内联微 poster 尺寸/体积（~320px 低质 jpeg base64，目标 ≤8KB、硬上限 12KB）：
// 随节点数据持久化，画布首绘零网络请求（对齐 Neowow data-URI poster）。
const INLINE_POSTER_EDGE = 320;
const INLINE_POSTER_MAX_BYTES = 12 * 1024;

/**
 * Derive the tiny base64 inline poster from a local media file (video OR an already-extracted
 * poster jpg — ffmpeg treats both as "grab first frame"). Best-effort: returns null on any
 * failure or when the encode exceeds the inline budget. Standalone so BOTH poster paths
 * (media-worker gRPC and local-ffmpeg fallback) can attach an inline variant.
 */
export async function extractInlineVideoPoster(
	mediaFilePath: string,
): Promise<string | null> {
	const outFile = join(
		dirname(mediaFilePath),
		`poster-inline-${randomUUID()}.jpg`,
	);
	try {
		await execFileAsync(
			"ffmpeg",
			[
				"-y",
				"-i",
				mediaFilePath,
				"-frames:v",
				"1",
				"-vf",
				`scale='if(gt(iw,ih),min(${INLINE_POSTER_EDGE},iw),-2)':'if(gt(iw,ih),-2,min(${INLINE_POSTER_EDGE},ih))'`,
				"-q:v",
				"12",
				outFile,
			],
			FFMPEG_EXEC_OPTS,
		);
		const bytes = await readFile(outFile);
		if (bytes.length > 0 && bytes.length <= INLINE_POSTER_MAX_BYTES) {
			return `data:image/jpeg;base64,${bytes.toString("base64")}`;
		}
		return null;
	} catch {
		return null;
	} finally {
		await rm(outFile, { force: true }).catch(() => {});
	}
}

/**
 * Extract a representative opening frame from a video already sitting on local disk, encode
 * it as a small jpg and upload it next to the video under gen/thumbnails. Also derives a tiny
 * base64 inline variant (~320px) for zero-request first paint on the canvas. Returns
 * `{ url, inline }`, or null on any failure (missing ffmpeg, unreadable codec, storage hiccup, ...);
 * `inline` is best-effort and may be null while `url` succeeds.
 */
export async function extractVideoPosterToStorage(input: {
	client: S3Client;
	bucket: string;
	publicBase: string; // already trimmed of trailing slashes; may be ""
	userId: string;
	videoFilePath: string;
}): Promise<{ url: string; inline: string | null } | null> {
	const outFile = join(
		dirname(input.videoFilePath),
		`poster-${randomUUID()}.jpg`,
	);
	try {
		await execFileAsync(
			"ffmpeg",
			[
				"-y",
				"-i",
				input.videoFilePath,
				"-vf",
				// Select a representative image from the opening frames so fade-ins do not
				// publish a black frame, then downscale without upscaling.
				`thumbnail=60,scale='if(gt(iw,ih),min(${MAX_POSTER_EDGE},iw),-2)':'if(gt(iw,ih),-2,min(${MAX_POSTER_EDGE},ih))'`,
				"-frames:v",
				"1",
				"-q:v",
				"4",
				outFile,
			],
			FFMPEG_EXEC_OPTS,
		);
		const size = (await stat(outFile)).size;
		if (!size) return null;

		const bytes = await readFile(outFile);
		const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
		const key = `gen/thumbnails/${encodeURIComponent(input.userId)}/${datePrefix}/${randomUUID()}.jpg`;
		await input.client.send(
			new PutObjectCommand({
				Bucket: input.bucket,
				Key: key,
				Body: bytes,
				ContentType: "image/jpeg",
				CacheControl: "public, max-age=31536000, immutable",
			}),
		);
		// 内联微 poster：从 640 poster 再降到 ≤320px 低质。失败/超限只丢 inline，不影响 TOS poster。
		const inline = await extractInlineVideoPoster(outFile);
		return {
			url: input.publicBase ? `${input.publicBase}/${key}` : `/${key}`,
			inline,
		};
	} catch (err) {
		console.warn(
			"[asset-hosting] video poster extraction failed (non-fatal)",
			err instanceof Error ? err.message : String(err),
		);
		return null;
	} finally {
		await rm(outFile, { force: true }).catch(() => {});
	}
}

export async function extractVideoPosterToLocalStorage(input: {
	config: LocalAssetStorageConfig;
	publicBase: string;
	userId: string;
	videoFilePath: string;
}): Promise<{ url: string; inline: string | null } | null> {
	const outFile = join(
		dirname(input.videoFilePath),
		`poster-${randomUUID()}.jpg`,
	);
	try {
		await execFileAsync(
			"ffmpeg",
			[
				"-y",
				"-i",
				input.videoFilePath,
				"-vf",
				`thumbnail=60,scale='if(gt(iw,ih),min(${MAX_POSTER_EDGE},iw),-2)':'if(gt(iw,ih),-2,min(${MAX_POSTER_EDGE},ih))'`,
				"-frames:v",
				"1",
				"-q:v",
				"4",
				outFile,
			],
			FFMPEG_EXEC_OPTS,
		);
		const size = (await stat(outFile)).size;
		if (!size) return null;

		const bytes = await readFile(outFile);
		const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
		const safeUserId = input.userId.replace(/[^a-zA-Z0-9_-]/g, "_") || "anon";
		const key = `gen/thumbnails/${safeUserId}/${datePrefix}/${randomUUID()}.jpg`;
		await writeLocalAssetBytes({ config: input.config, key, bytes });
		const inline = await extractInlineVideoPoster(outFile);
		return {
			url: `${input.publicBase.replace(/\/+$/, "")}/${key}`,
			inline,
		};
	} catch (error: unknown) {
		console.warn(
			"[asset-hosting] local video poster extraction failed (non-fatal)",
			error instanceof Error ? error.message : String(error),
		);
		return null;
	} finally {
		await rm(outFile, { force: true }).catch(() => undefined);
	}
}
