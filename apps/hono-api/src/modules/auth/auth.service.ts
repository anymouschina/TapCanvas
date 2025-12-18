import { getConfig } from "../../config";
import type { AppContext } from "../../types";
import { signJwtHS256 } from "../../jwt";
import { fetchWithHttpDebugLog } from "../../httpDebugLog";
import type { UserPayload } from "./auth.schemas";

export async function exchangeGithubCode(c: AppContext, code: string) {
	const config = getConfig(c.env);

	if (!config.githubClientId || !config.githubClientSecret) {
		return c.json(
			{
				success: false,
				error: "GitHub OAuth is not configured",
				code: "github_oauth_not_configured",
				missing: {
					GITHUB_CLIENT_ID: !config.githubClientId,
					GITHUB_CLIENT_SECRET: !config.githubClientSecret,
				},
			},
			501,
		);
	}

	const tokenResp = await fetchWithHttpDebugLog(
		c,
		"https://github.com/login/oauth/access_token",
		{
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"User-Agent": "TapCanvas/1.0",
			},
			body: JSON.stringify({
				client_id: config.githubClientId,
				client_secret: config.githubClientSecret,
				code,
			}),
		},
		{ tag: "github:oauth" },
	);

	if (!tokenResp.ok) {
		const text = await tokenResp.text().catch(() => "");
		console.error("[auth/github] token exchange failed", {
			status: tokenResp.status,
			statusText: tokenResp.statusText,
			bodySnippet: text.slice(0, 500),
		});
		return c.json(
			{
				success: false,
				error:
					"Failed to exchange GitHub code: " +
					(tokenResp.statusText || text),
			},
			502,
		);
	}

	const tokenJson = (await tokenResp.json()) as {
		access_token?: string;
	};
	const accessToken = tokenJson.access_token;

	if (!accessToken) {
		return c.json(
			{
				success: false,
				error: "No access token from GitHub",
			},
			502,
		);
	}

	const userResp = await fetchWithHttpDebugLog(
		c,
		"https://api.github.com/user",
		{
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/vnd.github+json",
				"User-Agent": "TapCanvas/1.0",
			},
		},
		{ tag: "github:user" },
	);

	if (!userResp.ok) {
		const text = await userResp.text().catch(() => "");
		console.error("[auth/github] fetch user failed", {
			status: userResp.status,
			statusText: userResp.statusText,
			bodySnippet: text.slice(0, 500),
		});
		return c.json(
			{
				success: false,
				error:
					"Failed to fetch GitHub user: " +
					(userResp.statusText || text),
			},
			502,
		);
	}

	const user = (await userResp.json()) as {
		id: number | string;
		login: string;
		name?: string | null;
		avatar_url?: string | null;
	};

	let primaryEmail: string | undefined;
	try {
		const emailResp = await fetchWithHttpDebugLog(
			c,
			"https://api.github.com/user/emails",
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
					Accept: "application/vnd.github+json",
					"User-Agent": "TapCanvas/1.0",
				},
			},
			{ tag: "github:emails" },
		);
		if (emailResp.ok) {
			const emailData = (await emailResp.json()) as any[];
			if (Array.isArray(emailData) && emailData.length > 0) {
				const primary =
					emailData.find((e: any) => e.primary) ?? emailData[0];
				if (primary?.email && typeof primary.email === "string") {
					primaryEmail = primary.email;
				}
			}
		}
	} catch {
		// ignore email errors, keep primaryEmail undefined
	}

	const payload: UserPayload = {
		sub: String(user.id),
		login: user.login,
		name: user.name || user.login,
		avatarUrl: user.avatar_url ?? null,
		email: primaryEmail ?? null,
		role: null,
		guest: false,
	};

	const nowIso = new Date().toISOString();

	try {
		await c.env.DB.prepare(
			`
        INSERT INTO users (id, login, name, avatar_url, email, guest, last_seen_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          login = excluded.login,
          name = excluded.name,
          avatar_url = excluded.avatar_url,
          email = excluded.email,
          guest = 0,
          last_seen_at = excluded.last_seen_at,
          updated_at = excluded.updated_at
      `,
		)
			.bind(
				payload.sub,
				payload.login,
				payload.name,
				payload.avatarUrl,
				payload.email,
				nowIso,
				nowIso,
				nowIso,
			)
			.run();
	} catch (err: any) {
		// Backward-compatible: local DB might not be migrated yet (no last_seen_at/role columns).
		const msg = String(err?.message || "");
		if (msg.includes("no such column") || msg.includes("SQLITE_ERROR")) {
			await c.env.DB.prepare(
				`
          INSERT INTO users (id, login, name, avatar_url, email, guest, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            login = excluded.login,
            name = excluded.name,
            avatar_url = excluded.avatar_url,
            email = excluded.email,
            guest = 0,
            updated_at = excluded.updated_at
        `,
			)
				.bind(
					payload.sub,
					payload.login,
					payload.name,
					payload.avatarUrl,
					payload.email,
					nowIso,
					nowIso,
				)
				.run();
		} else {
			throw err;
		}
	}

	try {
		const row = await c.env.DB.prepare(
			`SELECT role FROM users WHERE id = ? LIMIT 1`,
		)
			.bind(payload.sub)
			.first<any>();
		payload.role =
			row && typeof row.role === "string" && row.role.trim().length
				? row.role.trim()
				: null;
	} catch {
		payload.role = null;
	}

	const token = await signJwtHS256(
		payload,
		config.jwtSecret,
		7 * 24 * 60 * 60,
	);

	return {
		token,
		user: payload,
	};
}

export async function createGuestUser(c: AppContext, nickname?: string) {
	const config = getConfig(c.env);

	const id = crypto.randomUUID();
	const trimmed =
		typeof nickname === "string" ? nickname.trim().slice(0, 32) : "";
	const normalizedLogin = trimmed
		? trimmed.replace(/[^\w-]/g, "").toLowerCase()
		: "";
	const login = normalizedLogin || `guest_${id.slice(0, 8)}`;
	const name = trimmed || `Guest ${id.slice(0, 4).toUpperCase()}`;

	const nowIso = new Date().toISOString();

	try {
		await c.env.DB.prepare(
			`
        INSERT INTO users (id, login, name, avatar_url, email, guest, last_seen_at, created_at, updated_at)
        VALUES (?, ?, ?, NULL, NULL, 1, ?, ?, ?)
      `,
		)
			.bind(id, login, name, nowIso, nowIso, nowIso)
			.run();
	} catch (err: any) {
		const msg = String(err?.message || "");
		if (msg.includes("no such column") || msg.includes("SQLITE_ERROR")) {
			await c.env.DB.prepare(
				`
          INSERT INTO users (id, login, name, avatar_url, email, guest, created_at, updated_at)
          VALUES (?, ?, ?, NULL, NULL, 1, ?, ?)
        `,
			)
				.bind(id, login, name, nowIso, nowIso)
				.run();
		} else {
			throw err;
		}
	}

	const payload: UserPayload = {
		sub: id,
		login,
		name,
		role: null,
		guest: true,
	};

	try {
		const row = await c.env.DB.prepare(
			`SELECT role FROM users WHERE id = ? LIMIT 1`,
		)
			.bind(payload.sub)
			.first<any>();
		payload.role =
			row && typeof row.role === "string" && row.role.trim().length
				? row.role.trim()
				: null;
	} catch {
		payload.role = null;
	}

	const token = await signJwtHS256(
		payload,
		config.jwtSecret,
		7 * 24 * 60 * 60,
	);

	return {
		token,
		user: payload,
	};
}
