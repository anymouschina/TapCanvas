const PROVIDERS = new Set(["tos", "r2"]);

export function toHostedAssetKey(provider, key) {
	if (!PROVIDERS.has(provider)) throw new Error("Object storage provider must be either tos or r2");
	const normalizedKey = key.trim().replace(/^\/+/, "");
	if (!normalizedKey) throw new Error("Object storage asset key is required");
	return provider === "tos" ? `tapcanvas/legacy/${normalizedKey}` : normalizedKey;
}

export function buildObjectStorageUrl(publicBase, key) {
	return `${publicBase.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

function requireEnv(env, key) {
	const value = env[key]?.trim();
	if (!value) throw new Error(`Missing required environment variable: ${key}`);
	return value;
}

function requireHttpsUrl(value, key) {
	let parsed;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error(`${key} must be an absolute URL`);
	}
	if (parsed.protocol !== "https:") throw new Error(`${key} must use HTTPS`);
	return parsed.toString().replace(/\/+$/, "");
}

export function resolveObjectStorageTarget(env = process.env) {
	const provider = requireEnv(env, "OBJECT_STORAGE_PROVIDER").toLowerCase();
	if (!PROVIDERS.has(provider)) {
		throw new Error("OBJECT_STORAGE_PROVIDER must be either tos or r2");
	}

	const prefix = provider === "tos" ? "TOS" : "R2";
	const endpointKey = `${prefix}_ENDPOINT_URL`;
	const publicBaseKey = `${prefix}_PUBLIC_BASE_URL`;
	const endpoint = requireHttpsUrl(requireEnv(env, endpointKey), endpointKey);
	const publicBase = requireHttpsUrl(requireEnv(env, publicBaseKey), publicBaseKey);
	const region = requireEnv(env, `${prefix}_REGION`);
	const endpointHost = new URL(endpoint).hostname;

	if (provider === "tos" && !endpointHost.startsWith("tos-s3-")) {
		throw new Error("TOS_ENDPOINT_URL must use the TOS S3-compatible endpoint (tos-s3-...)");
	}
	if (provider === "r2" && !endpointHost.endsWith(".r2.cloudflarestorage.com")) {
		throw new Error("R2_ENDPOINT_URL must use a Cloudflare R2 S3 endpoint (*.r2.cloudflarestorage.com)");
	}
	if (provider === "r2" && region !== "auto") {
		throw new Error("R2_REGION must be auto");
	}

	const sessionToken = env[`${prefix}_SESSION_TOKEN`]?.trim();
	return {
		provider,
		bucket: requireEnv(env, `${prefix}_BUCKET`),
		publicBase,
		s3ClientConfig: {
			endpoint,
			region,
			forcePathStyle: false,
			credentials: {
				accessKeyId: requireEnv(env, `${prefix}_ACCESS_KEY_ID`),
				secretAccessKey: requireEnv(env, `${prefix}_SECRET_ACCESS_KEY`),
				...(sessionToken ? { sessionToken } : {}),
			},
		},
	};
}
