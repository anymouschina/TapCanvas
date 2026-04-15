import type { WorkerEnv } from "./types";

export type AppConfig = {
	jwtSecret: string;
	githubClientId: string | null;
	githubClientSecret: string | null;
	loginUrl: string | null;
	resendApiKey: string | null;
	resendFrom: string | null;
	emailLoginDebug: boolean;
	phoneLoginDebug: boolean;
	aliyunSmsAccessKeyId: string | null;
	aliyunSmsAccessKeySecret: string | null;
	aliyunSmsSignName: string | null;
	aliyunSmsTemplateCode: string | null;
	aliyunSmsEndpoint: string | null;
};

export function getConfig(env: WorkerEnv): AppConfig {
	return {
		jwtSecret: env.JWT_SECRET || "dev-secret",
		githubClientId: env.GITHUB_CLIENT_ID ?? null,
		githubClientSecret: env.GITHUB_CLIENT_SECRET ?? null,
		loginUrl: env.LOGIN_URL ?? null,
		resendApiKey: env.RESEND_API_KEY ?? null,
		resendFrom: env.RESEND_FROM ?? null,
		emailLoginDebug: String(env.EMAIL_LOGIN_DEBUG || "").trim() === "1",
		phoneLoginDebug: String(env.PHONE_LOGIN_DEBUG || "").trim() === "1",
		aliyunSmsAccessKeyId: env.ALIYUN_SMS_ACCESS_KEY_ID ?? null,
		aliyunSmsAccessKeySecret: env.ALIYUN_SMS_ACCESS_KEY_SECRET ?? null,
		aliyunSmsSignName: env.ALIYUN_SMS_SIGN_NAME ?? null,
		aliyunSmsTemplateCode: env.ALIYUN_SMS_TEMPLATE_CODE ?? null,
		aliyunSmsEndpoint: env.ALIYUN_SMS_ENDPOINT ?? null,
	};
}
