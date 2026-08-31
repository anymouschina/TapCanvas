import { describe, expect, it } from "vitest";
import type { AppContext, WorkerEnv } from "../../types";
import { resolvePublicAssetBaseUrl } from "./asset.publicBase";
import {
	extractObjectStorageObjectKey,
	extractObjectStorageErrorDetails,
	resolveObjectStorageConfig,
	toObjectStorageConfigDiagnostics,
} from "./rustfs.client";

function createEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
	return {
		DB: {} as WorkerEnv["DB"],
		JWT_SECRET: "jwt-secret",
		...overrides,
	};
}

describe("resolveObjectStorageConfig", () => {
	it("resolves the complete TOS S3-compatible storage contract", () => {
		const config = resolveObjectStorageConfig(
			createEnv({
				OBJECT_STORAGE_PROVIDER: "tos",
				TOS_ACCESS_KEY_ID: "tos-ak",
				TOS_SECRET_ACCESS_KEY: "tos-sk",
				TOS_ENDPOINT_URL: "https://tos-s3-cn-guangzhou.volces.com/",
				TOS_REGION: "cn-guangzhou",
				TOS_BUCKET: "tanvas-ai",
				TOS_PUBLIC_BASE_URL: "https://tanvas-ai.tos-cn-guangzhou.volces.com/",
			}),
		);

		expect(config).toEqual({
			provider: "tos",
			accessKeyId: "tos-ak",
			secretAccessKey: "tos-sk",
			endpoint: "https://tos-s3-cn-guangzhou.volces.com",
			region: "cn-guangzhou",
			bucket: "tanvas-ai",
			publicBase: "https://tanvas-ai.tos-cn-guangzhou.volces.com",
			forcePathStyle: false,
		});
	});

	it("resolves the complete Cloudflare R2 contract", () => {
		const config = resolveObjectStorageConfig(createEnv({
			OBJECT_STORAGE_PROVIDER: "r2",
			R2_ACCESS_KEY_ID: "r2-ak",
			R2_SECRET_ACCESS_KEY: "r2-sk",
			R2_ENDPOINT_URL: "https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com/",
			R2_REGION: "auto",
			R2_BUCKET: "canvas-pro",
			R2_PUBLIC_BASE_URL: "https://file.beqlee.icu/",
		}));

		expect(config).toEqual({
			provider: "r2",
			accessKeyId: "r2-ak",
			secretAccessKey: "r2-sk",
			endpoint: "https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com",
			region: "auto",
			bucket: "canvas-pro",
			publicBase: "https://file.beqlee.icu",
			forcePathStyle: false,
		});
	});

	it("uses only the provider selected by the explicit switch", () => {
		const config = resolveObjectStorageConfig(createEnv({
			OBJECT_STORAGE_PROVIDER: "r2",
			TOS_ACCESS_KEY_ID: "unused-tos-ak",
			TOS_SECRET_ACCESS_KEY: "unused-tos-sk",
			TOS_ENDPOINT_URL: "https://invalid-unused-tos-endpoint.example.com",
			TOS_REGION: "unused-region",
			TOS_BUCKET: "unused-bucket",
			TOS_PUBLIC_BASE_URL: "https://unused-tos-public.example.com",
			R2_ACCESS_KEY_ID: "r2-ak",
			R2_SECRET_ACCESS_KEY: "r2-sk",
			R2_ENDPOINT_URL: "https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com",
			R2_REGION: "auto",
			R2_BUCKET: "canvas-pro",
			R2_PUBLIC_BASE_URL: "https://file.beqlee.icu",
		}));

		expect(config?.provider).toBe("r2");
		expect(config?.endpoint).toBe(
			"https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com",
		);
		expect(config?.publicBase).toBe("https://file.beqlee.icu");
	});

	it("requires an explicit provider when storage fields are configured", () => {
		expect(() => resolveObjectStorageConfig(createEnv({
			TOS_ACCESS_KEY_ID: "tos-ak",
		}))).toThrow(/OBJECT_STORAGE_PROVIDER is required/);
	});

	it("ignores removed RustFS-only configuration", () => {
		expect(resolveObjectStorageConfig(createEnv({
			RUSTFS_ACCESS_KEY_ID: "removed-rustfs-ak",
		}))).toBeNull();
	});

	it("fails explicitly when the TOS contract is incomplete", () => {
		expect(() => resolveObjectStorageConfig(
			createEnv({
				OBJECT_STORAGE_PROVIDER: "tos",
				TOS_ACCESS_KEY_ID: "tos-ak",
			}),
		)).toThrow(/TOS object storage env is incomplete/);
	});

	it("rejects the native TOS endpoint because S3 signing requires tos-s3", () => {
		expect(() => resolveObjectStorageConfig(createEnv({
			OBJECT_STORAGE_PROVIDER: "tos",
			TOS_ACCESS_KEY_ID: "tos-ak",
			TOS_SECRET_ACCESS_KEY: "tos-sk",
			TOS_ENDPOINT_URL: "https://tos-cn-guangzhou.volces.com",
			TOS_REGION: "cn-guangzhou",
			TOS_BUCKET: "tanvas-ai",
			TOS_PUBLIC_BASE_URL: "https://tanvas-ai.tos-cn-guangzhou.volces.com",
		}))).toThrow(/S3-compatible endpoint/);
	});

	it("requires the Cloudflare R2 S3 region to be auto", () => {
		expect(() => resolveObjectStorageConfig(createEnv({
			OBJECT_STORAGE_PROVIDER: "r2",
			R2_ACCESS_KEY_ID: "r2-ak",
			R2_SECRET_ACCESS_KEY: "r2-sk",
			R2_ENDPOINT_URL: "https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com",
			R2_REGION: "us-east-1",
			R2_BUCKET: "canvas-pro",
			R2_PUBLIC_BASE_URL: "https://file.beqlee.icu",
		}))).toThrow(/R2_REGION must be auto/);
	});
});

describe("object storage diagnostics", () => {
	it("exposes safe config context without credentials", () => {
		const config = resolveObjectStorageConfig(
			createEnv({
				OBJECT_STORAGE_PROVIDER: "tos",
				TOS_ACCESS_KEY_ID: "tos-ak",
				TOS_SECRET_ACCESS_KEY: "tos-sk",
				TOS_ENDPOINT_URL: "https://tos-s3-cn-guangzhou.volces.com",
				TOS_REGION: "cn-guangzhou",
				TOS_BUCKET: "tanvas-ai",
				TOS_PUBLIC_BASE_URL: "https://tanvas-ai.tos-cn-guangzhou.volces.com",
			}),
		);

		expect(config).not.toBeNull();
		expect(toObjectStorageConfigDiagnostics(config!)).toEqual({
			provider: "tos",
			endpoint: "https://tos-s3-cn-guangzhou.volces.com",
			bucket: "tanvas-ai",
			region: "cn-guangzhou",
			forcePathStyle: false,
			publicBase: "https://tanvas-ai.tos-cn-guangzhou.volces.com",
		});
	});

	it("extracts HTTP metadata from s3-like errors", () => {
		expect(
			extractObjectStorageErrorDetails({
				name: "Unauthorized",
				message: "Unauthorized",
				Code: "SignatureDoesNotMatch",
				RequestId: "req_123",
				HostId: "host_456",
				$metadata: {
					httpStatusCode: 401,
					requestId: "req_meta_789",
					extendedRequestId: "ext_abc",
				},
			}),
		).toEqual({
			name: "Unauthorized",
			message: "Unauthorized",
			code: "SignatureDoesNotMatch",
			httpStatus: 401,
			requestId: "req_meta_789",
			extendedRequestId: "ext_abc",
			hostId: "host_456",
		});
	});
});

describe("extractObjectStorageObjectKey", () => {
	const config = resolveObjectStorageConfig(
		createEnv({
			OBJECT_STORAGE_PROVIDER: "tos",
			TOS_ACCESS_KEY_ID: "tos-ak",
			TOS_SECRET_ACCESS_KEY: "tos-sk",
			TOS_ENDPOINT_URL: "https://tos-s3-cn-guangzhou.volces.com",
			TOS_REGION: "cn-guangzhou",
			TOS_BUCKET: "tanvas-ai",
			TOS_PUBLIC_BASE_URL: "https://tanvas-ai.tos-cn-guangzhou.volces.com",
		}),
	)!;

	it("extracts an object key from the configured public TOS origin", () => {
		expect(extractObjectStorageObjectKey(
			config,
			"https://tanvas-ai.tos-cn-guangzhou.volces.com/tapcanvas/legacy/a%20b.webp?x=1",
		)).toBe("tapcanvas/legacy/a b.webp");
	});

	it("extracts an object key from a signed virtual-hosted TOS S3 URL", () => {
		expect(extractObjectStorageObjectKey(
			config,
			"https://tanvas-ai.tos-s3-cn-guangzhou.volces.com/gen/video.mp4?X-Amz-Signature=test",
		)).toBe("gen/video.mp4");
	});

	it("rejects foreign origins", () => {
		expect(extractObjectStorageObjectKey(
			config,
			"https://file.beqlee.icu/gen/video.mp4",
		)).toBeNull();
	});

	it("rejects malformed percent-encoded paths without throwing", () => {
		expect(extractObjectStorageObjectKey(
			config,
			"https://tanvas-ai.tos-cn-guangzhou.volces.com/gen/bad%path.webp",
		)).toBeNull();
	});

	it("extracts keys from R2 public and path-style signed URLs", () => {
		const r2Config = resolveObjectStorageConfig(createEnv({
			OBJECT_STORAGE_PROVIDER: "r2",
			R2_ACCESS_KEY_ID: "r2-ak",
			R2_SECRET_ACCESS_KEY: "r2-sk",
			R2_ENDPOINT_URL: "https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com",
			R2_REGION: "auto",
			R2_BUCKET: "canvas-pro",
			R2_PUBLIC_BASE_URL: "https://file.beqlee.icu",
		}))!;

		expect(extractObjectStorageObjectKey(
			r2Config,
			"https://file.beqlee.icu/gen/video%20one.mp4",
		)).toBe("gen/video one.mp4");
		expect(extractObjectStorageObjectKey(
			r2Config,
			"https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com/canvas-pro/gen/video.mp4?X-Amz-Signature=test",
		)).toBe("gen/video.mp4");
	});
});

describe("resolvePublicAssetBaseUrl", () => {
	it("returns the backend local asset proxy when object storage is absent", () => {
		const context = {
			env: createEnv(),
			req: {
				url: "http://127.0.0.1:8788/tasks/run",
				header: (name: string) => {
					if (name === "x-forwarded-host") return "api.tapcanvas.test";
					if (name === "x-forwarded-proto") return "https";
					return undefined;
				},
			},
		} as unknown as Pick<AppContext, "env" | "req">;

		expect(resolvePublicAssetBaseUrl(context)).toBe(
			"https://api.tapcanvas.test/assets/local",
		);
	});

	it("uses the browser-reachable local proxy configured for background workers", () => {
		const context = {
			env: createEnv({
				LOCAL_ASSET_PUBLIC_BASE_URL: "http://localhost:18080/assets/local/",
			}),
			req: {
				url: "http://async-image-worker/execute",
			},
		} as unknown as Pick<AppContext, "env" | "req">;

		expect(resolvePublicAssetBaseUrl(context)).toBe(
			"http://localhost:18080/assets/local",
		);
	});

	it("fails explicitly when the configured local proxy URL is invalid", () => {
		const context = {
			env: createEnv({ LOCAL_ASSET_PUBLIC_BASE_URL: "not-a-url" }),
			req: {
				url: "http://async-image-worker/execute",
			},
		} as unknown as Pick<AppContext, "env" | "req">;

		expect(() => resolvePublicAssetBaseUrl(context)).toThrow(
			"LOCAL_ASSET_PUBLIC_BASE_URL must be a valid URL",
		);
	});

	it("returns the configured TOS public base", () => {
		const context = {
			env: createEnv({
				OBJECT_STORAGE_PROVIDER: "tos",
				TOS_ACCESS_KEY_ID: "tos-ak",
				TOS_SECRET_ACCESS_KEY: "tos-sk",
				TOS_ENDPOINT_URL: "https://tos-s3-cn-guangzhou.volces.com",
				TOS_REGION: "cn-guangzhou",
				TOS_BUCKET: "tanvas-ai",
				TOS_PUBLIC_BASE_URL: "https://tanvas-ai.tos-cn-guangzhou.volces.com",
			}),
			req: {
				url: "https://api.example.com/public/oss/upload",
			},
		} as unknown as Pick<AppContext, "env" | "req">;

		expect(resolvePublicAssetBaseUrl(context)).toBe(
			"https://tanvas-ai.tos-cn-guangzhou.volces.com",
		);
	});
});
