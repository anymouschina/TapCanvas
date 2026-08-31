import { describe, expect, it } from "vitest";
import { buildTrustedInternalExecutionApiKey } from "./agents-bridge-continuation-auth";

describe("buildTrustedInternalExecutionApiKey", () => {
	it("为可信 worker 执行构造带原 API Key 归属的内部凭据", () => {
		expect(
			buildTrustedInternalExecutionApiKey({
				trustedInternalExecution: true,
				internalWorkerToken: " worker-secret ",
				userId: " user-1 ",
				apiKeyId: " key-1 ",
			})?.startsWith("tc_internal:v2:"),
		).toBe(true);
	});

	it("普通请求不得取得内部用户代理凭据", () => {
		expect(
			buildTrustedInternalExecutionApiKey({
				trustedInternalExecution: false,
				internalWorkerToken: "worker-secret",
				userId: "user-1",
			}),
		).toBeNull();
	});

	it("缺少 worker token 时明确返回不可构造", () => {
		expect(
			buildTrustedInternalExecutionApiKey({
				trustedInternalExecution: true,
				internalWorkerToken: "",
				userId: "user-1",
			}),
		).toBeNull();
	});
});
