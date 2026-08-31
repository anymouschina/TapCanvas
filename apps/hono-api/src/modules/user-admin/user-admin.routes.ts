import { Hono } from "hono";
import type { AppEnv, AppContext } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	AdminAdjustUserCreditsRequestSchema,
	AdminCreditGrantListResponseSchema,
	AdminCreditGrantQuerySchema,
	AdminSetUserMembershipRequestSchema,
	AdminUserListResponseSchema,
	AdminUpdateUserRequestSchema,
	AdminUserSchema,
	LedgerListQuerySchema,
	LedgerListResponseSchema,
	ListAdminUsersQuerySchema,
	TaskLogBundleSchema,
	UserCreditsOverviewSchema,
} from "./user-admin.schemas";
import {
	adjustAdminUserCredits,
	deleteAdminUser,
	getUserCreditsLedger,
	getUserCreditsOverview,
	getUserTaskLog,
	listAdminCreditGrants,
	listAdminUsers,
	setAdminUserMembership,
	updateAdminUser,
} from "./user-admin.service";
import { getPrismaClient } from "../../platform/node/prisma";
import { getConfig } from "../../config";
import {
	isAdminRequest,
	requireSufficientTeamCredits,
	settleTeamCreditsOnSuccess,
	releaseTeamCreditsOnFailure,
} from "../team/team.service";
import { resolveTeamCreditsCostForTask } from "../billing/billing.service";
import { sendAliyunEmail } from "../auth/aliyun-email";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { createObjectStorageClientFromConfig, resolveObjectStorageConfig } from "../asset/rustfs.client";
import { resolvePublicAssetBaseUrl } from "../asset/asset.publicBase";
import { z } from "zod";

export const userAdminRouter = new Hono<AppEnv>();

userAdminRouter.use("*", authMiddleware);

userAdminRouter.get("/credit-grants", async (c) => {
	const parsed = AdminCreditGrantQuerySchema.safeParse(c.req.query());
	if (!parsed.success) {
		return c.json({ error: "Invalid query", issues: parsed.error.issues }, 400);
	}
	const data = await listAdminCreditGrants(c as AppContext, parsed.data);
	return c.json(AdminCreditGrantListResponseSchema.parse(data));
});

userAdminRouter.get("/", async (c) => {
	const parsed = ListAdminUsersQuerySchema.safeParse(c.req.query());
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid query", issues: parsed.error.issues },
			400,
		);
	}

	const includeDeleted = (() => {
		const raw = parsed.data.includeDeleted;
		if (!raw) return false;
		const v = raw.trim().toLowerCase();
		return v === "1" || v === "true" || v === "yes" || v === "on";
	})();

	const items = await listAdminUsers(c as any, {
		q: parsed.data.q,
		page: parsed.data.page,
		pageSize: parsed.data.pageSize,
		includeDeleted,
	});

	return c.json(AdminUserListResponseSchema.parse(items));
});

userAdminRouter.patch("/:userId", async (c) => {
	const actorUserId = c.get("userId");
	if (!actorUserId) return c.json({ error: "Unauthorized" }, 401);

	const userId = c.req.param("userId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = AdminUpdateUserRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const updated = await updateAdminUser(c as any, {
		actorUserId,
		userId,
		...parsed.data,
	});
	return c.json(AdminUserSchema.parse(updated));
});

userAdminRouter.delete("/:userId", async (c) => {
	const actorUserId = c.get("userId");
	if (!actorUserId) return c.json({ error: "Unauthorized" }, 401);
	const userId = c.req.param("userId");
	await deleteAdminUser(c as any, { actorUserId, userId });
	return c.body(null, 204);
});

userAdminRouter.post("/:userId/credits", async (c) => {
	const actorUserId = c.get("userId");
	if (!actorUserId) return c.json({ error: "Unauthorized" }, 401);

	const userId = c.req.param("userId");
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = AdminAdjustUserCreditsRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const updated = await adjustAdminUserCredits(c as AppContext, {
		actorUserId,
		userId,
		delta: parsed.data.delta,
		...(parsed.data.note ? { note: parsed.data.note } : {}),
	});
	return c.json(AdminUserSchema.parse(updated));
});

userAdminRouter.put("/:userId/membership", async (c) => {
	const actorUserId = c.get("userId");
	if (!actorUserId) return c.json({ error: "Unauthorized" }, 401);
	const body: unknown = await c.req.json().catch(() => ({}));
	const parsed = AdminSetUserMembershipRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const updated = await setAdminUserMembership(c as AppContext, {
		actorUserId,
		userId: c.req.param("userId"),
		productId: parsed.data.productId,
		skuId: parsed.data.skuId ?? null,
		endAt: parsed.data.endAt ?? null,
	});
	return c.json(AdminUserSchema.parse(updated));
});

userAdminRouter.get("/:userId/credits", async (c) => {
	const userId = c.req.param("userId");
	const data = await getUserCreditsOverview(c as any, { userId });
	return c.json(UserCreditsOverviewSchema.parse(data));
});

userAdminRouter.get("/:userId/credits/ledger", async (c) => {
	const parsed = LedgerListQuerySchema.safeParse(c.req.query());
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid query", issues: parsed.error.issues },
			400,
		);
	}
	const userId = c.req.param("userId");
	const entryTypes = (parsed.data.entryTypes || "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const data = await getUserCreditsLedger(c as any, {
		userId,
		entryTypes: entryTypes.length ? entryTypes : null,
		taskIdLike: parsed.data.taskIdLike ?? null,
		since: parsed.data.since ?? null,
		until: parsed.data.until ?? null,
		cursor: parsed.data.cursor ?? null,
		cursorAt: parsed.data.cursorAt ?? null,
		limit: parsed.data.limit,
	});
	return c.json(LedgerListResponseSchema.parse(data));
});

userAdminRouter.get("/:userId/tasks/:taskId/log", async (c) => {
	const userId = c.req.param("userId");
	const taskId = c.req.param("taskId");
	const data = await getUserTaskLog(c as any, { userId, taskId });
	return c.json(TaskLogBundleSchema.parse(data));
});

const EmailCampaignRequestSchema = z.object({
	subject: z.string().min(1).max(200),
	body: z.string().min(1).max(5000),
});

function buildCampaignHtml(subject: string, imageUrl: string | null): string {
	const homeUrl = "https://tapcanvas.com/";
	const contentBlock = imageUrl
		? `<img src="${imageUrl}" alt="${subject}" style="width:100%;max-width:552px;border-radius:10px;display:block">`
		: "";
	return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#e0e0e0;margin:0;padding:0}
.wrap{max-width:600px;margin:0 auto;padding:32px 24px}
.logo{font-size:24px;font-weight:700;color:#a78bfa;margin-bottom:32px}
.footer{margin-top:24px;font-size:12px;color:#555;line-height:1.6}
a{color:#a78bfa}
</style></head><body>
<div class="wrap">
  <div class="logo">TapCanvas</div>
  ${contentBlock}
  <div class="footer">
    你收到这封邮件是因为你注册了 TapCanvas。<br>
    <a href="${homeUrl}">取消订阅邮件推送</a>
  </div>
</div>
</body></html>`;
}

function readCampaignEnv(c: AppContext, key: string): string {
	const envValue = typeof (c.env as any)?.[key] === "string" ? String((c.env as any)[key]) : "";
	if (envValue.trim()) return envValue.trim();
	return typeof (globalThis as any)?.process?.env?.[key] === "string"
		? String((globalThis as any).process.env[key]).trim() : "";
}

async function generateCampaignImageForUser(
	c: AppContext,
	userId: string,
	prompt: string,
): Promise<string> {
	const MODEL_KEY = "gpt-image-2";
	const SPEC_KEY = "image:1024x1024";
	const TASK_KIND = "text_to_image";

	let required = 0;
	try {
		required = await resolveTeamCreditsCostForTask(c, {
			taskKind: TASK_KIND, modelKey: MODEL_KEY, specKey: SPEC_KEY,
		});
	} catch (err) {
		console.warn("[email-campaign] credit cost resolution failed, proceeding without deduction", err);
	}

	let reservation: Awaited<ReturnType<typeof requireSufficientTeamCredits>> = null;
	if (required > 0) {
		reservation = await requireSufficientTeamCredits(c, userId, {
			required, taskKind: TASK_KIND, vendor: "newapi:campaign",
			modelKey: MODEL_KEY, specKey: SPEC_KEY,
		});
	}

	try {
		const url = await generateAndUploadImage(c, prompt);
		if (reservation && required > 0) {
			await settleTeamCreditsOnSuccess(c, userId, {
				taskId: reservation.reservationTaskId, taskKind: TASK_KIND, amount: required,
				vendor: "newapi:campaign", modelKey: MODEL_KEY, specKey: SPEC_KEY,
			}).catch((err) => console.warn("[email-campaign] settle credits failed", err));
		}
		return url;
	} catch (err) {
		if (reservation) {
			await releaseTeamCreditsOnFailure(c, userId, {
				taskId: reservation.reservationTaskId, taskKind: TASK_KIND,
				vendor: "newapi:campaign", modelKey: MODEL_KEY, specKey: SPEC_KEY,
			}).catch(() => {});
		}
		throw err;
	}
}

async function generateAndUploadImage(c: AppContext, prompt: string): Promise<string> {
	const baseUrl = (readCampaignEnv(c, "NEW_API_INTERNAL_BASE_URL") || "http://localhost:4455")
		.trim().replace(/\/+$/, "");
	const token = readCampaignEnv(c, "NEW_API_INTERNAL_TOKEN");

	const resp = await fetch(`${baseUrl}/v1/images/generations`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify({ model: MODEL_KEY_CAMPAIGN, prompt, n: 1, size: "1024x1024", response_format: "url" }),
		signal: AbortSignal.timeout(3 * 60_000),
	});
	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		throw new Error(`image generation failed (${resp.status}): ${text}`);
	}
	const data = (await resp.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
	const first = data.data?.[0];
	if (!first) throw new Error("image generation returned no result");

	const storage = resolveObjectStorageConfig(c.env);
	if (!storage) throw new Error("object storage not configured");
	const publicBase = resolvePublicAssetBaseUrl(c).trim().replace(/\/+$/, "");

	let body: Uint8Array;
	let contentType = "image/png";
	const dp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

	if (first.url) {
		const imgResp = await fetch(first.url);
		if (!imgResp.ok) throw new Error(`fetch image failed (${imgResp.status})`);
		contentType = (imgResp.headers.get("content-type") || "image/png").split(";")[0].trim();
		body = new Uint8Array(await imgResp.arrayBuffer());
	} else if (first.b64_json) {
		const cleaned = first.b64_json.replace(/\s+/g, "");
		const anyG = globalThis as any;
		body = anyG?.Buffer
			? new Uint8Array(anyG.Buffer.from(cleaned, "base64"))
			: (() => { const bin = atob(cleaned); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return b; })();
	} else {
		throw new Error("image generation returned neither url nor b64_json");
	}

	const extMap: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
	const ext = extMap[contentType] || "png";
	const key = `gen/campaign/${dp}/${crypto.randomUUID()}.${ext}`;

	const client = createObjectStorageClientFromConfig(storage);
	await client.send(new PutObjectCommand({
		Bucket: storage.bucket, Key: key, Body: body,
		ContentType: contentType, CacheControl: "public, max-age=31536000, immutable",
		ContentLength: body.byteLength,
	}));

	return publicBase ? `${publicBase}/${key}` : `/${key}`;
}

const MODEL_KEY_CAMPAIGN = "gpt-image-2";

userAdminRouter.get("/email-campaign/recipients", async (c) => {
	if (!isAdminRequest(c as any)) {
		return c.json({ error: "Forbidden" }, 403);
	}
	const page = Math.max(1, Number(c.req.query("page") || 1));
	const pageSize = Math.min(100, Math.max(1, Number(c.req.query("pageSize") || 10)));
	const offset = (page - 1) * pageSize;
	const prisma = getPrismaClient();
	const [rows, countRows] = await Promise.all([
		prisma.$queryRaw<Array<{ id: string; email: string; login: string }>>`
			SELECT id, email, login
			FROM users
			WHERE email IS NOT NULL
			  AND email != ''
			  AND email_marketing_opt_out = 0
			  AND disabled = 0
			  AND deleted_at IS NULL
			  AND guest = 0
			ORDER BY created_at DESC
			LIMIT ${pageSize} OFFSET ${offset}
		`,
		prisma.$queryRaw<Array<{ count: bigint }>>`
			SELECT COUNT(*) as count
			FROM users
			WHERE email IS NOT NULL
			  AND email != ''
			  AND email_marketing_opt_out = 0
			  AND disabled = 0
			  AND deleted_at IS NULL
			  AND guest = 0
		`,
	]);
	const total = Number(countRows[0]?.count ?? 0);
	return c.json({ items: rows, total, page, pageSize });
});

userAdminRouter.post("/email-campaign", async (c) => {
	if (!isAdminRequest(c as any)) {
		return c.json({ error: "Forbidden" }, 403);
	}

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = EmailCampaignRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}
	const { subject, body: imagePrompt } = parsed.data;
	const senderUserId = c.get("userId") as string;

	const config = getConfig(c.env);
	if (!config.aliyunEmailAccessKeyId || !config.aliyunEmailAccessKeySecret || !config.aliyunEmailFrom) {
		return c.json({ error: "Email service not configured" }, 503);
	}

	// 生成一张图供所有邮件共用，扣发件人积分
	let campaignImageUrl: string | null = null;
	try {
		campaignImageUrl = await generateCampaignImageForUser(c as unknown as AppContext, senderUserId, imagePrompt);
	} catch (err) {
		console.error("[email-campaign] image generation failed", err);
		return c.json({ error: "图片生成失败，请稍后重试", details: String(err) }, 500);
	}

	// 查询所有符合条件的用户
	const prisma = getPrismaClient();
	const recipients = await prisma.$queryRaw<Array<{ id: string; email: string; login: string }>>`
		SELECT id, email, login
		FROM users
		WHERE email IS NOT NULL
		  AND email != ''
		  AND email_marketing_opt_out = 0
		  AND disabled = 0
		  AND deleted_at IS NULL
		  AND guest = 0
	`;

	const total = recipients.length;
	let sent = 0;
	let failed = 0;
	const skippedNoEmail = 0;

	const CONCURRENCY = 10;
	const queue = [...recipients];

	async function sendOne(user: { id: string; email: string; login: string }): Promise<void> {
		try {
			const result = await sendAliyunEmail({
				config: {
					accessKeyId: config.aliyunEmailAccessKeyId!,
					accessKeySecret: config.aliyunEmailAccessKeySecret!,
					accountName: config.aliyunEmailFrom!,
					fromAlias: config.aliyunEmailFromAlias ?? "TapCanvas",
				},
				to: user.email,
				subject,
				htmlBody: buildCampaignHtml(subject, campaignImageUrl),
			});
			if (result.ok) {
				sent++;
			} else {
				failed++;
				console.error(`[email-campaign] failed for ${user.email}: ${result.errorMessage}`);
			}
		} catch (err) {
			failed++;
			console.error(`[email-campaign] error for ${user.email}:`, err);
		}
	}

	// 并发 worker pool，最多同时 CONCURRENCY 个请求
	await Promise.all(
		Array.from({ length: CONCURRENCY }, async () => {
			while (queue.length > 0) {
				const user = queue.shift();
				if (user) await sendOne(user);
			}
		}),
	);

	return c.json({ total, sent, failed, skippedNoEmail });
});
