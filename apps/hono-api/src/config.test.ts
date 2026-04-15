import { describe, expect, it } from "vitest";
import { getConfig } from "./config";
import type { WorkerEnv } from "./types";

function createEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
	return {
		DB: {} as WorkerEnv["DB"],
		JWT_SECRET: "jwt-secret",
		...overrides,
	};
}

describe("getConfig", () => {
	it("maps env values and debug switches", () => {
		const config = getConfig(
			createEnv({
				GITHUB_CLIENT_ID: "gh-id",
				GITHUB_CLIENT_SECRET: "gh-secret",
				LOGIN_URL: "https://example.com/login",
				RESEND_API_KEY: "rk",
				RESEND_FROM: "noreply@example.com",
				EMAIL_LOGIN_DEBUG: "1",
				PHONE_LOGIN_DEBUG: "0",
				ALIYUN_SMS_ACCESS_KEY_ID: "ak",
				ALIYUN_SMS_ACCESS_KEY_SECRET: "aks",
				ALIYUN_SMS_SIGN_NAME: "tapcanvas",
				ALIYUN_SMS_TEMPLATE_CODE: "tpl",
				ALIYUN_SMS_ENDPOINT: "sms.endpoint",
			}),
		);

		expect(config.jwtSecret).toBe("jwt-secret");
		expect(config.githubClientId).toBe("gh-id");
		expect(config.githubClientSecret).toBe("gh-secret");
		expect(config.loginUrl).toBe("https://example.com/login");
		expect(config.resendApiKey).toBe("rk");
		expect(config.resendFrom).toBe("noreply@example.com");
		expect(config.emailLoginDebug).toBe(true);
		expect(config.phoneLoginDebug).toBe(false);
		expect(config.aliyunSmsAccessKeyId).toBe("ak");
		expect(config.aliyunSmsAccessKeySecret).toBe("aks");
		expect(config.aliyunSmsSignName).toBe("tapcanvas");
		expect(config.aliyunSmsTemplateCode).toBe("tpl");
		expect(config.aliyunSmsEndpoint).toBe("sms.endpoint");
	});

	it("uses explicit defaults when env fields are missing", () => {
		const config = getConfig(createEnv({ JWT_SECRET: "" }));

		expect(config.jwtSecret).toBe("dev-secret");
		expect(config.githubClientId).toBeNull();
		expect(config.githubClientSecret).toBeNull();
		expect(config.loginUrl).toBeNull();
		expect(config.resendApiKey).toBeNull();
		expect(config.resendFrom).toBeNull();
		expect(config.emailLoginDebug).toBe(false);
		expect(config.phoneLoginDebug).toBe(false);
		expect(config.aliyunSmsAccessKeyId).toBeNull();
		expect(config.aliyunSmsAccessKeySecret).toBeNull();
		expect(config.aliyunSmsSignName).toBeNull();
		expect(config.aliyunSmsTemplateCode).toBeNull();
		expect(config.aliyunSmsEndpoint).toBeNull();
	});
});
