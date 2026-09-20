import { describe, expect, it } from "vitest";
import { buildProviderTaskFailureMessage, readProviderTaskFailureCode } from "./provider-task-failure";

describe("provider failure protocol", () => {
	it("preserves a type-only upstream error without interpreting its message", () => {
		const result = { raw: { response: { status: "failed", error: {
			type: "video_status_timeout", message: "上游视频状态查询超时，请稍后重试",
		} } } };
		expect(readProviderTaskFailureCode(result)).toBe("video_status_timeout");
		expect(buildProviderTaskFailureMessage(result)).toBe("上游视频状态查询超时，请稍后重试 (video_status_timeout)");
	});
	it("retains exact code when the provider supplies both code and type", () => {
		expect(readProviderTaskFailureCode({ error: { code: "provider_code", type: "provider_type" } })).toBe("provider_code");
	});
	it("does not infer a protocol identifier from prose or malformed errors", () => {
		for (const result of [null, [], { error: "timeout" }, { error: { message: "timeout" } }]) {
			expect(readProviderTaskFailureCode(result)).toBeNull();
		}
	});
});

it("preserves task-store hosting failure reason and code", () => {
  const result = { status: "failed", raw: { failureReason: "OSS 上传失败：写入对象存储失败", code: "asset_hosting_put_failed" } };
  expect(buildProviderTaskFailureMessage(result)).toBe("OSS 上传失败：写入对象存储失败");
  expect(readProviderTaskFailureCode(result)).toBe("asset_hosting_put_failed");
});
