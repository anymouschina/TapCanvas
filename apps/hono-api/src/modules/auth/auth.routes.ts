import { Hono } from "hono";
import type { AppEnv } from "../../types";
import {
	AuthResponseSchema,
	GithubExchangeRequestSchema,
	GuestLoginRequestSchema,
} from "./auth.schemas";
import { exchangeGithubCode, createGuestUser } from "./auth.service";

export const authRouter = new Hono<AppEnv>();

authRouter.post("/github/exchange", async (c) => {
	const body = await c.req.json().catch(() => ({}));
	const parsed = GithubExchangeRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const result = await exchangeGithubCode(c, parsed.data.code);

	// exchangeGithubCode may return a Hono Response on error
	if (result instanceof Response) {
		return result;
	}

	const validated = AuthResponseSchema.parse(result);
	return c.json(validated);
});

authRouter.post("/guest", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = GuestLoginRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const result = await createGuestUser(c, parsed.data.nickname);
	const validated = AuthResponseSchema.parse(result);
	return c.json(validated);
});
