import type { WorkerEnv } from "./types";

export type AppConfig = {
	jwtSecret: string;
	githubClientId: string | null;
	githubClientSecret: string | null;
};

export function getConfig(env: WorkerEnv): AppConfig {
	return {
		jwtSecret: env.JWT_SECRET || "dev-secret",
		githubClientId: env.GITHUB_CLIENT_ID ?? null,
		githubClientSecret: env.GITHUB_CLIENT_SECRET ?? null,
	};
}

