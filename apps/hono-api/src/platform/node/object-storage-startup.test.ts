import { describe, expect, it } from "vitest";
import path from "node:path";
import type { WorkerEnv } from "../../types";
import { assertObjectStorageStartupReady } from "./object-storage-startup";

function createEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
	return {
		DB: {} as WorkerEnv["DB"],
		JWT_SECRET: "test-secret",
		...overrides,
	};
}

describe("assertObjectStorageStartupReady", () => {
	it("accepts a complete local TOS configuration without exposing credentials", () => {
		expect(assertObjectStorageStartupReady(createEnv({
			OBJECT_STORAGE_PROVIDER: "tos",
			TOS_ACCESS_KEY_ID: "tos-ak",
			TOS_SECRET_ACCESS_KEY: "tos-sk",
			TOS_ENDPOINT_URL: "https://tos-s3-cn-guangzhou.volces.com",
			TOS_REGION: "cn-guangzhou",
			TOS_BUCKET: "tanvas-ai",
			TOS_PUBLIC_BASE_URL: "https://tanvas-ai.tos-cn-guangzhou.volces.com",
		}))).toEqual({
			status: "configured",
			config: {
				provider: "tos",
				endpoint: "https://tos-s3-cn-guangzhou.volces.com",
				region: "cn-guangzhou",
				bucket: "tanvas-ai",
				publicBase: "https://tanvas-ai.tos-cn-guangzhou.volces.com",
				forcePathStyle: false,
			},
		});
	});

	it("uses the repository assets/public directory when object storage is absent", () => {
		expect(assertObjectStorageStartupReady(createEnv())).toEqual({
			status: "local",
			rootDirectory: path.resolve(process.cwd(), "../../assets/public"),
			publicRoute: "/assets/local",
		});
	});

	it("fails startup when the selected TOS contract is incomplete", () => {
		expect(() => assertObjectStorageStartupReady(createEnv({
			OBJECT_STORAGE_PROVIDER: "tos",
			TOS_ACCESS_KEY_ID: "tos-ak",
		}))).toThrow(/TOS object storage env is incomplete/);
	});

});
