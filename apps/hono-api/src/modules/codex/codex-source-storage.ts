import { createHash } from "node:crypto";
import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { WorkerEnv } from "../../types";

const SOURCE_UPLOAD_TTL_SECONDS = 15 * 60;
const SOURCE_DOWNLOAD_TTL_SECONDS = 10 * 60;

export type CodexSourceStorageEnvironment = Pick<
	WorkerEnv,
	| "CODEX_SOURCE_S3_ACCESS_KEY_ID"
	| "CODEX_SOURCE_S3_SECRET_ACCESS_KEY"
	| "CODEX_SOURCE_S3_SESSION_TOKEN"
	| "CODEX_SOURCE_S3_ENDPOINT_URL"
	| "CODEX_SOURCE_S3_REGION"
	| "CODEX_SOURCE_S3_BUCKET"
>;

export type CodexSourceStorageConfig = {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
	endpoint: string;
	region: string;
	bucket: string;
};

const signS3Url = getSignedUrl as unknown as (
	client: S3Client,
	command: PutObjectCommand | GetObjectCommand,
	options: { expiresIn: number },
) => Promise<string>;

function read(
	env: CodexSourceStorageEnvironment,
	name: keyof CodexSourceStorageEnvironment,
): string {
	const value = env[name];
	return typeof value === "string" ? value.trim() : "";
}

function requireHttpsUrl(value: string, name: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${name} must be an absolute URL`);
	}
	if (url.protocol !== "https:") {
		throw new Error(`${name} must use https`);
	}
	return url.toString().replace(/\/+$/, "");
}

export function resolveCodexSourceStorageConfig(
	env: CodexSourceStorageEnvironment,
): CodexSourceStorageConfig {
	const values = {
		accessKeyId: read(env, "CODEX_SOURCE_S3_ACCESS_KEY_ID"),
		secretAccessKey: read(env, "CODEX_SOURCE_S3_SECRET_ACCESS_KEY"),
		sessionToken: read(env, "CODEX_SOURCE_S3_SESSION_TOKEN"),
		endpoint: read(env, "CODEX_SOURCE_S3_ENDPOINT_URL"),
		region: read(env, "CODEX_SOURCE_S3_REGION"),
		bucket: read(env, "CODEX_SOURCE_S3_BUCKET"),
	};
	const missing = Object.entries(values)
		.filter(([name, value]) => name !== "sessionToken" && !value)
		.map(([name]) => name);
	if (missing.length > 0) {
		throw new Error(
			`Codex private source storage is incomplete: missing ${missing.join(", ")}`,
		);
	}
	return {
		accessKeyId: values.accessKeyId,
		secretAccessKey: values.secretAccessKey,
		...(values.sessionToken
			? { sessionToken: values.sessionToken }
			: {}),
		endpoint: requireHttpsUrl(
			values.endpoint,
			"CODEX_SOURCE_S3_ENDPOINT_URL",
		),
		region: values.region,
		bucket: values.bucket,
	};
}

function createClient(config: CodexSourceStorageConfig): S3Client {
	return new S3Client({
		region: config.region,
		endpoint: config.endpoint,
		forcePathStyle: false,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
			...(config.sessionToken
				? { sessionToken: config.sessionToken }
				: {}),
		},
	});
}

function userToken(userId: string): string {
	return createHash("sha256").update(userId).digest("hex").slice(0, 32);
}

export function codexSourceObjectKey(input: {
	userId: string;
	taskId: string;
	sourceSha256: string;
}): string {
	return [
		"codex-private-sources",
		userToken(input.userId),
		input.taskId,
		`${input.sourceSha256}.tgz`,
	].join("/");
}

export async function createCodexSourceUpload(input: {
	env: WorkerEnv;
	userId: string;
	taskId: string;
	sourceSha256: string;
}): Promise<{
	uploadUrl: string;
	objectKey: string;
	expiresAt: string;
	requiredHeaders: {
		"content-type": "application/gzip";
		"x-amz-meta-sha256": string;
	};
}> {
	const config = resolveCodexSourceStorageConfig(input.env);
	const client = createClient(config);
	const objectKey = codexSourceObjectKey(input);
	const uploadUrl = await signS3Url(
		client,
		new PutObjectCommand({
			Bucket: config.bucket,
			Key: objectKey,
			ContentType: "application/gzip",
			Metadata: { sha256: input.sourceSha256 },
			CacheControl: "private, no-store",
		}),
		{ expiresIn: SOURCE_UPLOAD_TTL_SECONDS },
	);
	return {
		uploadUrl,
		objectKey,
		expiresAt: new Date(
			Date.now() + SOURCE_UPLOAD_TTL_SECONDS * 1_000,
		).toISOString(),
		requiredHeaders: {
			"content-type": "application/gzip",
			"x-amz-meta-sha256": input.sourceSha256,
		},
	};
}

export async function verifyCodexSourceObject(input: {
	env: WorkerEnv;
	objectKey: string;
	sourceSha256: string;
	archiveBytes: number;
}): Promise<void> {
	const config = resolveCodexSourceStorageConfig(input.env);
	const response = await createClient(config).send(
		new HeadObjectCommand({
			Bucket: config.bucket,
			Key: input.objectKey,
		}),
	);
	if (response.ContentLength !== input.archiveBytes) {
		throw new Error(
			`Codex source size mismatch: expected ${input.archiveBytes}, got ${String(response.ContentLength)}`,
		);
	}
	if (response.Metadata?.sha256 !== input.sourceSha256) {
		throw new Error("Codex source sha256 metadata mismatch");
	}
}

export async function createCodexSourceDownloadUrl(input: {
	env: WorkerEnv;
	objectKey: string;
}): Promise<string> {
	const config = resolveCodexSourceStorageConfig(input.env);
	return signS3Url(
		createClient(config),
		new GetObjectCommand({
			Bucket: config.bucket,
			Key: input.objectKey,
		}),
		{ expiresIn: SOURCE_DOWNLOAD_TTL_SECONDS },
	);
}

export async function deleteCodexSourceObject(input: {
	env: WorkerEnv;
	objectKey: string;
}): Promise<void> {
	const config = resolveCodexSourceStorageConfig(input.env);
	await createClient(config).send(
		new DeleteObjectCommand({
			Bucket: config.bucket,
			Key: input.objectKey,
		}),
	);
}
