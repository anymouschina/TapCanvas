import { S3Client } from "@aws-sdk/client-s3";
import type { WorkerEnv } from "../../types";

type RustfsEnv = {
	RUSTFS_ACCESS_KEY_ID?: string;
	RUSTFS_SECRET_ACCESS_KEY?: string;
	RUSTFS_ENDPOINT_URL?: string;
	RUSTFS_REGION?: string;
	RUSTFS_BUCKET?: string;
	RUSTFS_PUBLIC_BASE_URL?: string;
};

function readEnvValue(env: RustfsEnv, key: keyof RustfsEnv): string | undefined {
	if (env[key]) return env[key];
	const processEnv = (globalThis as any)?.process?.env as
		| Record<string, string | undefined>
		| undefined;
	return processEnv?.[key as string];
}

export type RustfsConfig = {
	accessKeyId: string;
	secretAccessKey: string;
	endpoint: string;
	region: string;
	bucket: string;
	publicBase: string;
};

export function resolveRustfsConfig(env: WorkerEnv): RustfsConfig | null {
	const accessKeyId = readEnvValue(env, "RUSTFS_ACCESS_KEY_ID");
	const secretAccessKey = readEnvValue(env, "RUSTFS_SECRET_ACCESS_KEY");
	const endpoint = readEnvValue(env, "RUSTFS_ENDPOINT_URL");
	const region = readEnvValue(env, "RUSTFS_REGION") || "cn-east-1";
	const bucket = readEnvValue(env, "RUSTFS_BUCKET") || "pixel-mind-new";
	const publicBaseFromEnv = readEnvValue(env, "RUSTFS_PUBLIC_BASE_URL");
	let publicBase = publicBaseFromEnv || endpoint || "";

	if (!accessKeyId || !secretAccessKey || !endpoint) return null;

	if (!publicBaseFromEnv && publicBase) {
		try {
			const url = new URL(publicBase);
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
			publicBase = url.toString();
		} catch {
			// keep original publicBase
		}
	}

	return {
		accessKeyId,
		secretAccessKey,
		endpoint,
		region,
		bucket,
		publicBase: publicBase.replace(/\/+$/, ""),
	};
}

export function createRustfsClient(env: WorkerEnv): S3Client {
	const config = resolveRustfsConfig(env);
	if (!config) {
		throw new Error("RustFS env is not configured");
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
		forcePathStyle: true,
	});
}
