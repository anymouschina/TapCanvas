import { describe, expect, it } from "vitest";
import type { AppContext, WorkerEnv } from "../../types";
import { resolvePublicAssetBaseUrl } from "./asset.publicBase";
import {
	extractObjectStorageErrorDetails,
	resolveRustfsConfig,
	toObjectStorageConfigDiagnostics,
} from "./rustfs.client";

function createEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
	return {
		DB: {} as WorkerEnv["DB"],
		JWT_SECRET: "jwt-secret",
		...overrides,
	};
}

describe("resolveRustfsConfig", () => {
	it("parses a Cloudflare R2 bucket URL into endpoint and bucket", () => {
		const config = resolveRustfsConfig(
			createEnv({
				R2_ACCESS_KEY_ID: "r2-ak",
				R2_SECRET_ACCESS_KEY: "r2-sk",
				R2_BUCKET_URL:
					"https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com/canvas-pro",
			}),
		);

		expect(config).toEqual({
			provider: "r2",
			accessKeyId: "r2-ak",
			secretAccessKey: "r2-sk",
			endpoint: "https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com",
			region: "auto",
			bucket: "canvas-pro",
			publicBase: "",
			forcePathStyle: false,
		});
	});

	it("preserves legacy RustFS path-style public base fallback", () => {
		const config = resolveRustfsConfig(
			createEnv({
				RUSTFS_ACCESS_KEY_ID: "legacy-ak",
				RUSTFS_SECRET_ACCESS_KEY: "legacy-sk",
				RUSTFS_ENDPOINT_URL: "https://oss.example.com",
				RUSTFS_BUCKET: "canvas-pro",
			}),
		);

		expect(config).toEqual({
			provider: "rustfs",
			accessKeyId: "legacy-ak",
			secretAccessKey: "legacy-sk",
			endpoint: "https://oss.example.com",
			region: "cn-east-1",
			bucket: "canvas-pro",
			publicBase: "https://oss.example.com/canvas-pro",
			forcePathStyle: true,
		});
	});

	it("does not strip a legacy endpoint path when bucket is configured separately", () => {
		const config = resolveRustfsConfig(
			createEnv({
				RUSTFS_ACCESS_KEY_ID: "legacy-ak",
				RUSTFS_SECRET_ACCESS_KEY: "legacy-sk",
				RUSTFS_ENDPOINT_URL: "https://oss.example.com/api",
				RUSTFS_BUCKET: "canvas-pro",
			}),
		);

		expect(config).toEqual({
			provider: "rustfs",
			accessKeyId: "legacy-ak",
			secretAccessKey: "legacy-sk",
			endpoint: "https://oss.example.com/api",
			region: "cn-east-1",
			bucket: "canvas-pro",
			publicBase: "https://oss.example.com/api/canvas-pro",
			forcePathStyle: true,
		});
	});
});

describe("object storage diagnostics", () => {
	it("exposes safe config context without credentials", () => {
		const config = resolveRustfsConfig(
			createEnv({
				R2_ACCESS_KEY_ID: "r2-ak",
				R2_SECRET_ACCESS_KEY: "r2-sk",
				R2_BUCKET_URL:
					"https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com/canvas-pro",
				R2_PUBLIC_BASE_URL: "https://assets.example.com",
			}),
		);

		expect(config).not.toBeNull();
		expect(toObjectStorageConfigDiagnostics(config!)).toEqual({
			provider: "r2",
			endpoint: "https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com",
			bucket: "canvas-pro",
			region: "auto",
			forcePathStyle: false,
			publicBase: "https://assets.example.com",
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
					cfId: "cf_xyz",
				},
			}),
		).toEqual({
			name: "Unauthorized",
			message: "Unauthorized",
			code: "SignatureDoesNotMatch",
			httpStatus: 401,
			requestId: "req_meta_789",
			extendedRequestId: "ext_abc",
			cfId: "cf_xyz",
			hostId: "host_456",
		});
	});
});

describe("resolvePublicAssetBaseUrl", () => {
	it("falls back to the API proxy route when R2 has no public base", () => {
		const context = {
			env: createEnv({
				R2_ACCESS_KEY_ID: "r2-ak",
				R2_SECRET_ACCESS_KEY: "r2-sk",
				R2_BUCKET_URL:
					"https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com/canvas-pro",
			}),
			req: {
				url: "https://api.example.com/public/oss/upload",
			},
		} as unknown as Pick<AppContext, "env" | "req">;

		expect(resolvePublicAssetBaseUrl(context)).toBe(
			"https://api.example.com/assets/r2",
		);
	});
});
