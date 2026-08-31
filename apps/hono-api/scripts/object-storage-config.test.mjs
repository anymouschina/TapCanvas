import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildObjectStorageUrl,
	resolveObjectStorageTarget,
	toHostedAssetKey,
} from "./object-storage-config.mjs";

const tosEnv = {
	TOS_ACCESS_KEY_ID: "tos-ak",
	TOS_SECRET_ACCESS_KEY: "tos-sk",
	TOS_ENDPOINT_URL: "https://tos-s3-cn-guangzhou.volces.com",
	TOS_REGION: "cn-guangzhou",
	TOS_BUCKET: "tanvas-ai",
	TOS_PUBLIC_BASE_URL: "https://tanvas-ai.tos-cn-guangzhou.volces.com",
};

const r2Env = {
	R2_ACCESS_KEY_ID: "r2-ak",
	R2_SECRET_ACCESS_KEY: "r2-sk",
	R2_ENDPOINT_URL: "https://4081ef0b6d72113281b2311ebedc3edb.r2.cloudflarestorage.com",
	R2_REGION: "auto",
	R2_BUCKET: "canvas-pro",
	R2_PUBLIC_BASE_URL: "https://file.beqlee.icu",
};

describe("resolveObjectStorageTarget", () => {
	it("selects TOS without reading the inactive R2 configuration", () => {
		const target = resolveObjectStorageTarget({
			OBJECT_STORAGE_PROVIDER: "tos",
			...tosEnv,
			...r2Env,
			R2_REGION: "invalid-unused-region",
		});

		assert.equal(target.provider, "tos");
		assert.equal(target.bucket, "tanvas-ai");
		assert.equal(target.s3ClientConfig.region, "cn-guangzhou");
	});

	it("selects R2 without reading the inactive TOS configuration", () => {
		const target = resolveObjectStorageTarget({
			OBJECT_STORAGE_PROVIDER: "r2",
			...tosEnv,
			TOS_ENDPOINT_URL: "https://invalid-unused-tos.example.com",
			...r2Env,
		});

		assert.equal(target.provider, "r2");
		assert.equal(target.bucket, "canvas-pro");
		assert.equal(target.publicBase, "https://file.beqlee.icu");
	});

	it("requires the R2 S3 region to be auto", () => {
		assert.throws(() => resolveObjectStorageTarget({
			OBJECT_STORAGE_PROVIDER: "r2",
			...r2Env,
			R2_REGION: "us-east-1",
		}), /R2_REGION must be auto/);
	});

	it("maps hosted static asset keys to each provider's existing key space", () => {
		assert.equal(
			toHostedAssetKey("tos", "/static/portal/hero.webp"),
			"tapcanvas/legacy/static/portal/hero.webp",
		);
		assert.equal(toHostedAssetKey("r2", "/static/portal/hero.webp"), "static/portal/hero.webp");
		assert.equal(
			buildObjectStorageUrl("https://file.beqlee.icu/", "/static/portal/hero.webp"),
			"https://file.beqlee.icu/static/portal/hero.webp",
		);
		assert.throws(() => toHostedAssetKey("unknown", "static/portal/hero.webp"), /either tos or r2/);
	});
});
