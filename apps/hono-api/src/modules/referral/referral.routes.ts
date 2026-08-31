import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { AppError } from "../../middleware/error";
import {
	getCampaignForPublic,
	getOrCreateInviteCode,
	getReferralStats,
	ensureCampaignImage,
	scheduleEnsureCampaignImage,
} from "./referral.service";
import {
	getReferralConfig,
	updateReferralConfig,
	listReferralOverview,
	listReferralBindings,
	listReferralGrants,
	type ReferralConfigRow,
} from "./referral.repo";

export const referralRouter = new Hono<AppEnv>();

referralRouter.get("/campaign", async (c) => {
	const data = await getCampaignForPublic(c);
	return c.json(data);
});

referralRouter.use("/me", authMiddleware);
referralRouter.use("/stats", authMiddleware);

referralRouter.get("/me", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const code = await getOrCreateInviteCode(c, userId);
	const envOrigin =
		typeof (c.env as any)?.SITE_ORIGIN === "string"
			? String((c.env as any).SITE_ORIGIN).trim()
			: "";
	const origin = envOrigin || new URL(c.req.url).origin;
	return c.json({ inviteCode: code, inviteUrl: `${origin}/?ref=${code}` });
});

referralRouter.get("/stats", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const stats = await getReferralStats(c, userId);
	return c.json(stats);
});

export const adminReferralRouter = new Hono<AppEnv>();

adminReferralRouter.use("*", authMiddleware, async (c, next) => {
	const auth = c.get("auth") as { role?: string } | undefined;
	if (auth?.role !== "admin") {
		throw new AppError("Forbidden", { status: 403, code: "forbidden" });
	}
	await next();
});

adminReferralRouter.get("/config", async (c) => {
	const config = await getReferralConfig(c.env.DB);
	return c.json(config);
});

// Cover image is auto-generated via gpt-image-2 (port 4455) and stored in TOS;
// admins no longer set image_url manually — only campaign copy and the
// registration welcome credit are editable here.
const ADMIN_PATCH_KEYS = [
	"enabled",
	"title",
	"body",
	"cta_text",
	"invitee_welcome_credits",
	"anti_self_check",
	"anti_self_window_days",
] as const satisfies ReadonlyArray<keyof ReferralConfigRow>;

adminReferralRouter.put("/config", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
	const patch: Record<string, unknown> = {};
	for (const k of ADMIN_PATCH_KEYS) {
		if (k in body) patch[k] = body[k];
	}
	await updateReferralConfig(
		c.env.DB,
		patch as Partial<Omit<ReferralConfigRow, "id" | "updated_at">>,
		new Date().toISOString(),
	);
	const after = await getReferralConfig(c.env.DB);
	if (after?.enabled && !(after.image_url && after.image_url.trim())) {
		scheduleEnsureCampaignImage(c);
	}
	return c.json(after);
});

adminReferralRouter.get("/overview", async (c) => {
	const limit = Number(c.req.query("limit") ?? 100);
	const search = c.req.query("search") ?? null;
	const rows = await listReferralOverview(c.env.DB, { limit, search });
	return c.json({ items: rows });
});

adminReferralRouter.get("/bindings", async (c) => {
	const referrerUserId = c.req.query("referrerUserId") ?? undefined;
	const limit = Number(c.req.query("limit") ?? 200);
	const rows = await listReferralBindings(c.env.DB, {
		referrerUserId,
		limit,
	});
	return c.json({ items: rows });
});

adminReferralRouter.get("/grants", async (c) => {
	const referrerUserId = c.req.query("referrerUserId") ?? undefined;
	const limit = Number(c.req.query("limit") ?? 200);
	const rows = await listReferralGrants(c.env.DB, { referrerUserId, limit });
	return c.json({ items: rows });
});

adminReferralRouter.post("/image:regenerate", async (c) => {
	try {
		await ensureCampaignImage(c, { force: true });
	} catch (err) {
		throw new AppError(
			err instanceof Error ? err.message : "image generation failed",
			{ status: 502, code: "image_generation_failed" },
		);
	}
	const after = await getReferralConfig(c.env.DB);
	return c.json(after);
});
