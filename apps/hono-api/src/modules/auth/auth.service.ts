import { getConfig } from "../../config";
import type { AppContext } from "../../types";
import { signJwtHS256 } from "../../jwt";
import type { UserPayload } from "./auth.schemas";

export async function exchangeGithubCode(c: AppContext, code: string) {
	const config = getConfig(c.env);

	if (!config.githubClientId || !config.githubClientSecret) {
		return c.json(
			{
				success: false,
				error: "GitHub OAuth is not configured",
			},
			500,
		);
	}

	const tokenResp = await fetch(
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

	const userResp = await fetch("https://api.github.com/user", {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: "application/vnd.github+json",
			"User-Agent": "TapCanvas/1.0",
		},
	});

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
		const emailResp = await fetch("https://api.github.com/user/emails", {
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: "application/vnd.github+json",
				"User-Agent": "TapCanvas/1.0",
			},
		});
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
		guest: false,
	};

	const nowIso = new Date().toISOString();

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

	await c.env.DB.prepare(
		`
      INSERT INTO users (id, login, name, avatar_url, email, guest, created_at, updated_at)
      VALUES (?, ?, ?, NULL, NULL, 1, ?, ?)
    `,
	)
		.bind(id, login, name, nowIso, nowIso)
		.run();

	const payload: UserPayload = {
		sub: id,
		login,
		name,
		guest: true,
	};

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
