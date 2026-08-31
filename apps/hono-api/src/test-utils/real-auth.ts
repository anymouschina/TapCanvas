import { getPrismaClient } from "../platform/node/prisma";

export type RealAuthTestAccount = {
	id: string;
	login: string;
	phone: string | null;
};

type RealAuthLoginResult = {
	token: string;
	account: RealAuthTestAccount;
};

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

function getRealAuthTestBaseUrl(): URL {
	const raw = readRequiredEnv("REAL_AUTH_TEST_BASE_URL");
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch (error: unknown) {
		throw new Error(
			`REAL_AUTH_TEST_BASE_URL must be an absolute URL: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("REAL_AUTH_TEST_BASE_URL must use http or https");
	}
	return parsed;
}

export async function requestRealAuthApi(
	path: string,
	init?: RequestInit,
): Promise<Response> {
	if (!path.startsWith("/")) {
		throw new Error("real auth integration request path must start with /");
	}
	return fetch(new URL(path, getRealAuthTestBaseUrl()), init);
}

export function hasRealAuthTestEnv(): boolean {
	return Boolean(readEnv("REAL_AUTH_TEST_BASE_URL")) &&
		Boolean(readEnv("REAL_AUTH_TEST_PASSWORD")) &&
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
	const response = await requestRealAuthApi("/auth/login", {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({
			username: account.login,
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
