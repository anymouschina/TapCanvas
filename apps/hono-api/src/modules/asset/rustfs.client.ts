import { S3Client } from "@aws-sdk/client-s3";
import type { WorkerEnv } from "../../types";

type RustfsEnv = {
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	R2_ENDPOINT_URL?: string;
	R2_REGION?: string;
	R2_BUCKET?: string;
	R2_BUCKET_URL?: string;
	R2_PUBLIC_BASE_URL?: string;
	RUSTFS_ACCESS_KEY_ID?: string;
	RUSTFS_SECRET_ACCESS_KEY?: string;
	RUSTFS_ENDPOINT_URL?: string;
	RUSTFS_REGION?: string;
	RUSTFS_BUCKET?: string;
	RUSTFS_PUBLIC_BASE_URL?: string;
};

function readEnvValue(env: RustfsEnv, key: keyof RustfsEnv): string | undefined {
	const direct = env[key];
	if (typeof direct === "string" && direct.trim()) {
		return direct.trim();
	}
	const processRef = globalThis as typeof globalThis & {
		process?: { env?: Record<string, string | undefined> };
	};
	const fromProcess = processRef.process?.env?.[key];
	return typeof fromProcess === "string" && fromProcess.trim()
		? fromProcess.trim()
		: undefined;
}

function readFirstEnvValue(
	env: RustfsEnv,
	keys: ReadonlyArray<keyof RustfsEnv>,
): string | undefined {
	for (const key of keys) {
		const value = readEnvValue(env, key);
		if (value) return value;
	}
	return undefined;
}

function isR2Hostname(hostname: string): boolean {
	return hostname.endsWith(".r2.cloudflarestorage.com");
}

function isR2Endpoint(endpoint: string): boolean {
	try {
		return isR2Hostname(new URL(endpoint).hostname);
	} catch {
		return false;
	}
}

type ParsedBucketUrl = {
	endpoint: string;
	bucket: string;
};

function parseBucketUrl(
	raw: string,
	options?: { allowPathBucket?: boolean },
): ParsedBucketUrl | null {
	const trimmed = raw.trim();
	if (!trimmed) return null;

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		return null;
	}

	const pathParts = url.pathname.split("/").filter(Boolean);
	if (options?.allowPathBucket !== false && pathParts.length === 1) {
		const bucket = pathParts[0]!;
		url.pathname = "";
		url.search = "";
		url.hash = "";
		return {
			endpoint: url.toString().replace(/\/+$/, ""),
			bucket,
		};
	}

	if (pathParts.length === 0 && isR2Hostname(url.hostname)) {
		const hostParts = url.hostname.split(".");
		if (hostParts.length >= 5) {
			const [bucket, ...endpointParts] = hostParts;
			if (bucket && endpointParts.length >= 4) {
				url.hostname = endpointParts.join(".");
				url.search = "";
				url.hash = "";
				return {
					endpoint: url.toString().replace(/\/+$/, ""),
					bucket,
				};
			}
		}
	}

	return null;
}

function buildPathStylePublicBase(endpoint: string, bucket: string): string {
	try {
		const url = new URL(endpoint);
		const hostHasBucket =
			url.hostname === bucket || url.hostname.startsWith(`${bucket}.`);
		if (!hostHasBucket) {
			const normalizedPath = url.pathname.replace(/\/+$/, "");
			const bucketPath = `/${bucket}`;
			if (!normalizedPath || normalizedPath === "/") {
				url.pathname = bucketPath;
			} else if (!normalizedPath.endsWith(bucketPath)) {
				url.pathname = `${normalizedPath}${bucketPath}`;
			}
		}
		return url.toString().replace(/\/+$/, "");
	} catch {
		return endpoint.replace(/\/+$/, "");
	}
}

export type RustfsConfig = {
	provider: "r2" | "rustfs";
	accessKeyId: string;
	secretAccessKey: string;
	endpoint: string;
	region: string;
	bucket: string;
	publicBase: string;
	forcePathStyle: boolean;
};

export type ObjectStorageConfigDiagnostics = {
	provider: RustfsConfig["provider"];
	endpoint: string;
	bucket: string;
	region: string;
	forcePathStyle: boolean;
	publicBase: string;
};

type ObjectStorageErrorLike = {
	name?: unknown;
	message?: unknown;
	code?: unknown;
	Code?: unknown;
	requestId?: unknown;
	RequestId?: unknown;
	HostId?: unknown;
	$metadata?: {
		httpStatusCode?: unknown;
		requestId?: unknown;
		extendedRequestId?: unknown;
		cfId?: unknown;
	};
};

export type ObjectStorageErrorDetails = {
	name?: string;
	message: string;
	code?: string;
	httpStatus?: number;
	requestId?: string;
	extendedRequestId?: string;
	cfId?: string;
	hostId?: string;
};

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function toObjectStorageConfigDiagnostics(
	config: RustfsConfig,
): ObjectStorageConfigDiagnostics {
	return {
		provider: config.provider,
		endpoint: config.endpoint,
		bucket: config.bucket,
		region: config.region,
		forcePathStyle: config.forcePathStyle,
		publicBase: config.publicBase,
	};
}

export function extractObjectStorageErrorDetails(
	error: unknown,
): ObjectStorageErrorDetails {
	const typed = (error && typeof error === "object"
		? error
		: {}) as ObjectStorageErrorLike;

	return {
		name: readString(typed.name),
		message:
			readString(typed.message) ||
			(error instanceof Error ? error.message : String(error)),
		code: readString(typed.code) || readString(typed.Code),
		httpStatus: readNumber(typed.$metadata?.httpStatusCode),
		requestId:
			readString(typed.$metadata?.requestId) ||
			readString(typed.requestId) ||
			readString(typed.RequestId),
		extendedRequestId: readString(typed.$metadata?.extendedRequestId),
		cfId: readString(typed.$metadata?.cfId),
		hostId: readString(typed.HostId),
	};
}

export function resolveRustfsConfig(env: WorkerEnv): RustfsConfig | null {
	const accessKeyId = readFirstEnvValue(env, [
		"R2_ACCESS_KEY_ID",
		"RUSTFS_ACCESS_KEY_ID",
	]);
	const secretAccessKey = readFirstEnvValue(env, [
		"R2_SECRET_ACCESS_KEY",
		"RUSTFS_SECRET_ACCESS_KEY",
	]);
	const rawEndpoint = readFirstEnvValue(env, [
		"R2_BUCKET_URL",
		"R2_ENDPOINT_URL",
		"RUSTFS_ENDPOINT_URL",
	]);
	if (!accessKeyId || !secretAccessKey || !rawEndpoint) return null;

	const explicitBucket = readFirstEnvValue(env, ["R2_BUCKET", "RUSTFS_BUCKET"]);
	const parsedBucketUrl = parseBucketUrl(rawEndpoint, {
		allowPathBucket: isR2Endpoint(rawEndpoint) || !explicitBucket,
	});
	const endpoint = (parsedBucketUrl?.endpoint || rawEndpoint).replace(/\/+$/, "");
	const hasR2Env = Boolean(
		readFirstEnvValue(env, [
			"R2_ACCESS_KEY_ID",
			"R2_SECRET_ACCESS_KEY",
			"R2_ENDPOINT_URL",
			"R2_BUCKET",
			"R2_BUCKET_URL",
			"R2_PUBLIC_BASE_URL",
		]),
	);
	const provider =
		hasR2Env || isR2Endpoint(endpoint)
			? "r2"
			: "rustfs";
	const bucket = explicitBucket || parsedBucketUrl?.bucket || "";
	const region =
		readFirstEnvValue(env, ["R2_REGION", "RUSTFS_REGION"]) ||
		(provider === "r2" ? "auto" : "cn-east-1");
	const publicBaseFromEnv = readFirstEnvValue(env, [
		"R2_PUBLIC_BASE_URL",
		"RUSTFS_PUBLIC_BASE_URL",
	]);

	if (!bucket) return null;

	const publicBase =
		provider === "r2"
			? (publicBaseFromEnv || "").replace(/\/+$/, "")
			: buildPathStylePublicBase(publicBaseFromEnv || endpoint, bucket);

	return {
		provider,
		accessKeyId,
		secretAccessKey,
		endpoint,
		region,
		bucket,
		publicBase,
		forcePathStyle: provider !== "r2",
	};
}

export function createRustfsClient(env: WorkerEnv): S3Client {
	const config = resolveRustfsConfig(env);
	if (!config) {
		throw new Error("Object storage env is not configured");
	}
	return createRustfsClientFromConfig(config);
}

export function createRustfsClientFromConfig(config: RustfsConfig): S3Client {
	return new S3Client({
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
		endpoint: config.endpoint,
		forcePathStyle: config.forcePathStyle,
	});
}
