import { S3Client } from "@aws-sdk/client-s3";
import type { WorkerEnv } from "../../types";

type ObjectStorageEnv = {
	OBJECT_STORAGE_PROVIDER?: string;
	TOS_ACCESS_KEY_ID?: string;
	TOS_SECRET_ACCESS_KEY?: string;
	TOS_SESSION_TOKEN?: string;
	TOS_ENDPOINT_URL?: string;
	TOS_REGION?: string;
	TOS_BUCKET?: string;
	TOS_PUBLIC_BASE_URL?: string;
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	R2_SESSION_TOKEN?: string;
	R2_ENDPOINT_URL?: string;
	R2_REGION?: string;
	R2_BUCKET?: string;
	R2_PUBLIC_BASE_URL?: string;
};

export type ObjectStorageProvider = "tos" | "r2";

const REQUIRED_STORAGE_ENV_KEYS = {
	tos: [
		"TOS_ACCESS_KEY_ID",
		"TOS_SECRET_ACCESS_KEY",
		"TOS_ENDPOINT_URL",
		"TOS_REGION",
		"TOS_BUCKET",
		"TOS_PUBLIC_BASE_URL",
	],
	r2: [
		"R2_ACCESS_KEY_ID",
		"R2_SECRET_ACCESS_KEY",
		"R2_ENDPOINT_URL",
		"R2_REGION",
		"R2_BUCKET",
		"R2_PUBLIC_BASE_URL",
	],
} as const satisfies Record<ObjectStorageProvider, ReadonlyArray<keyof ObjectStorageEnv>>;

const ALL_STORAGE_ENV_KEYS = [
	...REQUIRED_STORAGE_ENV_KEYS.tos,
	"TOS_SESSION_TOKEN",
	...REQUIRED_STORAGE_ENV_KEYS.r2,
	"R2_SESSION_TOKEN",
] as const satisfies ReadonlyArray<keyof ObjectStorageEnv>;

function readEnvValue(env: ObjectStorageEnv, key: keyof ObjectStorageEnv): string | undefined {
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

function requireAbsoluteHttpsUrl(value: string, envKey: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`${envKey} must be an absolute URL`);
	}
	if (parsed.protocol !== "https:") {
		throw new Error(`${envKey} must use https`);
	}
	return parsed.toString().replace(/\/+$/, "");
}

export type ObjectStorageConfig = {
	provider: ObjectStorageProvider;
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
	endpoint: string;
	region: string;
	bucket: string;
	publicBase: string;
	forcePathStyle: false;
};

export type ObjectStorageConfigDiagnostics = {
	provider: ObjectStorageConfig["provider"];
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
	};
};

export type ObjectStorageErrorDetails = {
	name?: string;
	message: string;
	code?: string;
	httpStatus?: number;
	requestId?: string;
	extendedRequestId?: string;
	hostId?: string;
};

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function toObjectStorageConfigDiagnostics(
	config: ObjectStorageConfig,
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
		hostId: readString(typed.HostId),
	};
}

export function resolveObjectStorageConfig(env: WorkerEnv): ObjectStorageConfig | null {
	const rawProvider = readEnvValue(env, "OBJECT_STORAGE_PROVIDER")?.toLowerCase();
	const hasStorageConfig = ALL_STORAGE_ENV_KEYS.some((key) => readEnvValue(env, key));
	if (!rawProvider && !hasStorageConfig) return null;
	if (!rawProvider) {
		throw new Error("OBJECT_STORAGE_PROVIDER is required when object storage is configured");
	}
	if (rawProvider !== "tos" && rawProvider !== "r2") {
		throw new Error("OBJECT_STORAGE_PROVIDER must be either tos or r2");
	}
	return resolveObjectStorageConfigForProvider(env, rawProvider);
}

export function resolveObjectStorageConfigForProvider(
	env: WorkerEnv,
	provider: ObjectStorageProvider,
): ObjectStorageConfig {
	const prefix = provider === "tos" ? "TOS" : "R2";
	const requiredKeys = REQUIRED_STORAGE_ENV_KEYS[provider];
	const missingKeys = requiredKeys.filter((key) => !readEnvValue(env, key));
	if (missingKeys.length > 0) {
		throw new Error(`${prefix} object storage env is incomplete: missing ${missingKeys.join(", ")}`);
	}

	const accessKeyIdKey = provider === "tos" ? "TOS_ACCESS_KEY_ID" : "R2_ACCESS_KEY_ID";
	const secretAccessKeyKey = provider === "tos" ? "TOS_SECRET_ACCESS_KEY" : "R2_SECRET_ACCESS_KEY";
	const sessionTokenKey = provider === "tos" ? "TOS_SESSION_TOKEN" : "R2_SESSION_TOKEN";
	const endpointKey = provider === "tos" ? "TOS_ENDPOINT_URL" : "R2_ENDPOINT_URL";
	const publicBaseKey = provider === "tos" ? "TOS_PUBLIC_BASE_URL" : "R2_PUBLIC_BASE_URL";
	const regionKey = provider === "tos" ? "TOS_REGION" : "R2_REGION";
	const bucketKey = provider === "tos" ? "TOS_BUCKET" : "R2_BUCKET";
	const accessKeyId = readEnvValue(env, accessKeyIdKey)!;
	const secretAccessKey = readEnvValue(env, secretAccessKeyKey)!;
	const sessionToken = readEnvValue(env, sessionTokenKey);
	const endpoint = requireAbsoluteHttpsUrl(readEnvValue(env, endpointKey)!, endpointKey);
	const publicBase = requireAbsoluteHttpsUrl(readEnvValue(env, publicBaseKey)!, publicBaseKey);
	const region = readEnvValue(env, regionKey)!;
	const bucket = readEnvValue(env, bucketKey)!;

	if (provider === "tos" && !new URL(endpoint).hostname.startsWith("tos-s3-")) {
		throw new Error("TOS_ENDPOINT_URL must use the TOS S3-compatible endpoint (tos-s3-...)");
	}
	if (provider === "r2" && !new URL(endpoint).hostname.endsWith(".r2.cloudflarestorage.com")) {
		throw new Error("R2_ENDPOINT_URL must use a Cloudflare R2 S3 endpoint (*.r2.cloudflarestorage.com)");
	}
	if (provider === "r2" && region !== "auto") {
		throw new Error("R2_REGION must be auto");
	}

	return {
		provider,
		accessKeyId,
		secretAccessKey,
		...(sessionToken ? { sessionToken } : {}),
		endpoint,
		region,
		bucket,
		publicBase,
		forcePathStyle: false,
	};
}

export function createObjectStorageClient(env: WorkerEnv): S3Client {
	const config = resolveObjectStorageConfig(env);
	if (!config) {
		throw new Error("Object storage env is not configured");
	}
	return createObjectStorageClientFromConfig(config);
}

export function createObjectStorageClientFromConfig(config: ObjectStorageConfig): S3Client {
	return new S3Client({
		region: config.region,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
			...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
		},
		endpoint: config.endpoint,
		forcePathStyle: false,
	});
}

export function extractObjectStorageObjectKey(
	config: ObjectStorageConfig,
	rawUrl: string,
): string | null {
	const value = rawUrl.trim();
	if (!value) return null;

	const publicBase = config.publicBase.replace(/\/+$/, "");
	if (value.startsWith(`${publicBase}/`)) {
		const key = value.slice(publicBase.length + 1).split(/[?#]/)[0];
		if (!key) return null;
		try {
			return decodeURIComponent(key);
		} catch {
			return null;
		}
	}

	try {
		const parsed = new URL(value);
		const endpointHost = new URL(config.endpoint).hostname;
		const path = parsed.pathname.replace(/^\/+/, "");
		const key = parsed.hostname === `${config.bucket}.${endpointHost}`
			? path
			: parsed.hostname === endpointHost && path.startsWith(`${config.bucket}/`)
				? path.slice(config.bucket.length + 1)
				: "";
		return key ? decodeURIComponent(key) : null;
	} catch {
		return null;
	}
}
