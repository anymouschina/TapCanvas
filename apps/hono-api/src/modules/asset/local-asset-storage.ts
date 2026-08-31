import { createReadStream, createWriteStream } from "node:fs";
import {
	link,
	mkdir,
	open,
	realpath,
	rm,
	stat,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { resolveProjectDataRepoRoot } from "./project-data-root";

export const LOCAL_ASSET_ROUTE_PREFIX = "/assets/local";

export type LocalAssetStorageConfig = {
	kind: "local";
	rootDirectory: string;
};

export type LocalAssetByteRange = {
	start: number;
	end: number;
	length: number;
};

export type LocalAssetReadResult = {
	contentLength: number;
	contentType: string;
	range: LocalAssetByteRange | null;
	stream: ReadableStream<Uint8Array>;
	totalSize: number;
};

export class LocalAssetRangeError extends RangeError {
	readonly totalSize: number;

	constructor(message: string, totalSize: number) {
		super(message);
		this.name = "LocalAssetRangeError";
		this.totalSize = totalSize;
	}
}

const MIME_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
	avif: "image/avif",
	bmp: "image/bmp",
	gif: "image/gif",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	m4a: "audio/mp4",
	mov: "video/quicktime",
	mp3: "audio/mpeg",
	mp4: "video/mp4",
	ogg: "audio/ogg",
	png: "image/png",
	svg: "image/svg+xml",
	tif: "image/tiff",
	tiff: "image/tiff",
	wav: "audio/wav",
	webm: "video/webm",
	webp: "image/webp",
};

function isNodeRuntime(): boolean {
	const runtime = globalThis as typeof globalThis & {
		process?: { versions?: { node?: string } };
	};
	return typeof runtime.process?.versions?.node === "string";
}

export function resolveLocalAssetStorageConfig(
	startDirectory: string = process.cwd(),
): LocalAssetStorageConfig | null {
	if (!isNodeRuntime()) return null;
	const repoRoot = resolveProjectDataRepoRoot(startDirectory);
	return {
		kind: "local",
		rootDirectory: path.join(repoRoot, "assets", "public"),
	};
}

export function resolveLocalAssetPublicBase(requestUrl: string): string {
	const origin = new URL(requestUrl).origin;
	return `${origin}${LOCAL_ASSET_ROUTE_PREFIX}`;
}

export function resolveLocalAssetFilePath(
	config: LocalAssetStorageConfig,
	key: string,
): string {
	const normalizedKey = key.replaceAll("\\", "/").replace(/^\/+/, "");
	if (!normalizedKey || normalizedKey.includes("\0")) {
		throw new Error("Local asset key is required");
	}
	const segments = normalizedKey.split("/");
	if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
		throw new Error("Local asset key is invalid");
	}

	const root = path.resolve(config.rootDirectory);
	const target = path.resolve(root, ...segments);
	if (!target.startsWith(`${root}${path.sep}`)) {
		throw new Error("Local asset key escapes the asset root");
	}
	return target;
}

export async function ensureLocalAssetRoot(
	config: LocalAssetStorageConfig,
): Promise<void> {
	await mkdir(config.rootDirectory, { recursive: true });
}

async function assertRealPathWithinRoot(
	config: LocalAssetStorageConfig,
	existingPath: string,
): Promise<void> {
	const [rootRealPath, targetRealPath] = await Promise.all([
		realpath(config.rootDirectory),
		realpath(existingPath),
	]);
	if (
		targetRealPath !== rootRealPath &&
		!targetRealPath.startsWith(`${rootRealPath}${path.sep}`)
	) {
		throw new Error("Local asset path escapes the real asset root");
	}
}

export async function writeLocalAssetBytes(input: {
	config: LocalAssetStorageConfig;
	key: string;
	bytes: Uint8Array;
}): Promise<string> {
	const filePath = resolveLocalAssetFilePath(input.config, input.key);
	await ensureLocalAssetRoot(input.config);
	await mkdir(path.dirname(filePath), { recursive: true });
	await assertRealPathWithinRoot(input.config, path.dirname(filePath));
	const handle = await open(filePath, "wx");
	try {
		await handle.writeFile(input.bytes);
	} finally {
		await handle.close();
	}
	return filePath;
}

export async function writeLocalAssetResponse(input: {
	config: LocalAssetStorageConfig;
	key: string;
	response: Response;
	beforeCommit?: (temporaryFilePath: string) => Promise<void>;
	afterCommit?: (filePath: string) => Promise<void>;
}): Promise<string> {
	if (!input.response.body) {
		throw new Error("Upstream response has no body to write locally");
	}

	const filePath = resolveLocalAssetFilePath(input.config, input.key);
	await ensureLocalAssetRoot(input.config);
	await mkdir(path.dirname(filePath), { recursive: true });
	await assertRealPathWithinRoot(input.config, path.dirname(filePath));
	const temporaryFilePath = `${filePath}.${crypto.randomUUID()}.tmp`;
	try {
		await pipeline(
			Readable.fromWeb(
				input.response.body as Parameters<typeof Readable.fromWeb>[0],
			),
			createWriteStream(temporaryFilePath, { flags: "wx" }),
		);
		if (input.beforeCommit) {
			await input.beforeCommit(temporaryFilePath);
		}
		await link(temporaryFilePath, filePath);
		if (input.afterCommit) {
			await input.afterCommit(filePath);
		}
		return filePath;
	} finally {
		await rm(temporaryFilePath, { force: true }).catch(() => undefined);
	}
}

function parseRangeHeader(
	rawHeader: string | undefined,
	totalSize: number,
): LocalAssetByteRange | null {
	const raw = rawHeader?.trim() ?? "";
	if (!raw) return null;
	const match = /^bytes=(\d*)-(\d*)$/i.exec(raw);
	if (!match) throw new LocalAssetRangeError("Unsupported Range header", totalSize);
	const startText = match[1] ?? "";
	const endText = match[2] ?? "";
	if (!startText && !endText) {
		throw new LocalAssetRangeError("Invalid Range header", totalSize);
	}

	let start: number;
	let end: number;
	if (!startText) {
		const suffixLength = Number(endText);
		if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
			throw new LocalAssetRangeError("Invalid Range suffix", totalSize);
		}
		start = Math.max(0, totalSize - suffixLength);
		end = totalSize - 1;
	} else {
		start = Number(startText);
		end = endText ? Number(endText) : totalSize - 1;
		if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
			throw new LocalAssetRangeError("Invalid Range bounds", totalSize);
		}
	}

	if (start < 0 || start >= totalSize || end < start) {
		throw new LocalAssetRangeError("Range is not satisfiable", totalSize);
	}
	end = Math.min(end, totalSize - 1);
	return { start, end, length: end - start + 1 };
}

function detectContentType(filePath: string): string {
	const extension = path.extname(filePath).slice(1).toLowerCase();
	return MIME_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}

export async function readLocalAsset(input: {
	config: LocalAssetStorageConfig;
	key: string;
	rangeHeader?: string;
}): Promise<LocalAssetReadResult> {
	const filePath = resolveLocalAssetFilePath(input.config, input.key);
	await assertRealPathWithinRoot(input.config, filePath);
	const fileStat = await stat(filePath);
	if (!fileStat.isFile()) throw new Error("Local asset is not a file");
	const range = parseRangeHeader(input.rangeHeader, fileStat.size);
	const nodeStream = range
		? createReadStream(filePath, { start: range.start, end: range.end })
		: createReadStream(filePath);
	return {
		contentLength: range?.length ?? fileStat.size,
		contentType: detectContentType(filePath),
		range,
		stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
		totalSize: fileStat.size,
	};
}
