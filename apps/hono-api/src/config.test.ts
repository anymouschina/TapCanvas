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
			}),
		);

		expect(config.jwtSecret).toBe("jwt-secret");
		expect(config.githubClientId).toBe("gh-id");
		expect(config.githubClientSecret).toBe("gh-secret");
		expect(config.loginUrl).toBe("https://example.com/login");
		expect(config.resendApiKey).toBe("rk");
		expect(config.resendFrom).toBe("noreply@example.com");
		expect(config.emailLoginDebug).toBe(true);
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
	});
});
