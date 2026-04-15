import { createTapCanvasApp } from "../app";
import { loadLocalEnvFiles } from "../platform/node/local-env";
import { createNodeWorkerEnv } from "../platform/node/node-env";
import { getPrismaClient } from "../platform/node/prisma";

export type RealAuthTestAccount = {
	id: string;
	login: string;
	phone: string;
};

type RealAuthLoginResult = {
	token: string;
	account: RealAuthTestAccount;
};

type RealAuthTestApp = Awaited<ReturnType<typeof createTapCanvasApp>>;
type RealAuthTestEnv = Awaited<ReturnType<typeof createNodeWorkerEnv>>;

let cachedAppPromise: Promise<RealAuthTestApp> | null = null;
let cachedEnvPromise: Promise<RealAuthTestEnv> | null = null;

function readEnv(name: string): string {
	return String(process.env[name] || "").trim();
}

function readRequiredEnv(name: string): string {
	const value = readEnv(name);
	if (!value) {
		throw new Error(`missing required env: ${name}`);
	}
	return value;
}

function normalizePhoneE164(raw: string): string {
	const trimmed = String(raw || "").trim();
	if (!trimmed) return "";
	const cleaned = trimmed.replace(/[^\d+]/g, "");
	if (!cleaned) return "";
	if (cleaned.startsWith("+")) {
		const digits = cleaned.slice(1).replace(/\D/g, "");
		return digits ? `+${digits}` : "";
	}
	const digits = cleaned.replace(/\D/g, "");
	if (!digits) return "";
	if (digits.length === 11 && digits.startsWith("1")) return `+86${digits}`;
	return `+${digits}`;
}

function getRealAuthTestApp(): Promise<RealAuthTestApp> {
	if (!cachedAppPromise) {
		cachedAppPromise = createTapCanvasApp();
	}
	return cachedAppPromise;
}

function getRealAuthTestEnv(): Promise<RealAuthTestEnv> {
	if (!cachedEnvPromise) {
		loadLocalEnvFiles();
		cachedEnvPromise = createNodeWorkerEnv();
	}
	return cachedEnvPromise;
}

export async function requestWithRealEnv(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const [app, env] = await Promise.all([getRealAuthTestApp(), getRealAuthTestEnv()]);
	const request = input instanceof Request ? input : new Request(input, init);
	return app.fetch(request, env);
}

export function hasRealAuthTestEnv(): boolean {
	return Boolean(readEnv("REAL_AUTH_TEST_PASSWORD")) &&
		(Boolean(readEnv("REAL_AUTH_TEST_LOGIN")) || Boolean(readEnv("REAL_AUTH_TEST_PHONE")));
}

export async function resolveRealAuthTestAccount(): Promise<RealAuthTestAccount> {
	const login = readEnv("REAL_AUTH_TEST_LOGIN");
	const phone = normalizePhoneE164(readEnv("REAL_AUTH_TEST_PHONE"));
	if (!login && !phone) {
		throw new Error("missing REAL_AUTH_TEST_LOGIN or REAL_AUTH_TEST_PHONE");
	}

	const user = await getPrismaClient().users.findFirst({
		where: login
			? {
					login,
					deleted_at: null,
			  }
			: {
					phone,
					deleted_at: null,
			  },
		select: {
			id: true,
			login: true,
			phone: true,
			password_hash: true,
			password_salt: true,
			disabled: true,
		},
	});

	if (!user) {
		throw new Error("real auth test account not found in prisma");
	}
	if (!user.phone) {
		throw new Error("real auth test account has no phone");
	}
	if (!user.password_hash || !user.password_salt) {
		throw new Error("real auth test account has no password configured");
	}
	if (Number(user.disabled ?? 0) !== 0) {
		throw new Error("real auth test account is disabled");
	}

	return {
		id: user.id,
		login: user.login,
		phone: user.phone,
	};
}

export async function loginAndGetRealToken(): Promise<RealAuthLoginResult> {
	const password = readRequiredEnv("REAL_AUTH_TEST_PASSWORD");
	const account = await resolveRealAuthTestAccount();
	const response = await requestWithRealEnv("http://localhost/auth/phone/password-login", {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({
			phone: account.phone,
			password,
		}),
	});

	const payload = (await response.json()) as {
		token?: string;
		error?: string;
	};

	if (!response.ok) {
		throw new Error(
			`real auth login failed: status=${response.status} error=${String(payload.error || "")}`,
		);
	}

	const token = typeof payload.token === "string" ? payload.token.trim() : "";
	if (!token) {
		throw new Error("real auth login returned empty token");
	}

	return { token, account };
}
