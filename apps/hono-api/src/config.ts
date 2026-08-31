import type { WorkerEnv } from "./types";

export type AppConfig = {
	jwtSecret: string;
	githubClientId: string | null;
	githubClientSecret: string | null;
	loginUrl: string | null;
	resendApiKey: string | null;
	resendFrom: string | null;
	emailLoginDebug: boolean;
	aliyunEmailAccessKeyId: string | null;
	aliyunEmailAccessKeySecret: string | null;
	aliyunEmailFrom: string | null;
	aliyunEmailFromAlias: string | null;
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
		aliyunEmailAccessKeyId: env.ALIYUN_EMAIL_ACCESS_KEY_ID ?? null,
		aliyunEmailAccessKeySecret: env.ALIYUN_EMAIL_ACCESS_KEY_SECRET ?? null,
		aliyunEmailFrom: env.ALIYUN_EMAIL_FROM ?? null,
		aliyunEmailFromAlias: env.ALIYUN_EMAIL_FROM_ALIAS ?? "TapCanvas",
	};
}
