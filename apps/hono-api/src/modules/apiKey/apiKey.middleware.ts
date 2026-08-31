import type { Next } from "hono";
import type { AppContext } from "../../types";
import { AppError } from "../../middleware/error";
import { resolveAuth, tryGetUserDbAuthState } from "../../middleware/auth";
import {
	resolveDevPublicBypassFromContext,
} from "../../middleware/devPublicBypass";
import { touchApiKeyLastUsedAt } from "./apiKey.repo";
import {
	readApiKeyFromRequest,
	resolveApiKeyRowFromRequest,
} from "./apiKey-auth-resolver";
import { getApiKeyByIdForOwner } from "./apiKey.repo";
import { isInternalApiKey, parseInternalApiKey } from "./internal-api-key";
import { resolveAgentsCliGrant } from "../auth/agents-cli-auth.routes";

export { assertOriginAllowedForApiKey } from "./apiKey-auth-resolver";

function parseScopes(raw: string): string[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed.filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
			: [];
	} catch {
		return [];
	}
}

function isAgentExecutionPath(pathname: string): boolean {
	const publicPath = pathname.startsWith("/public/") ? pathname.slice("/public".length) : pathname;
	return publicPath === "/mcp"
		|| publicPath.startsWith("/agents/")
		|| publicPath.startsWith("/codex/")
		|| publicPath === "/v1/agent-memory";
}

export function apiKeyScopeMiddleware(c: AppContext, next: Next) {
	const apiKeyId = c.get("apiKeyId");
	if (!apiKeyId) return next();
	const scopes = c.get("apiKeyScopes") ?? [];
	const required = isAgentExecutionPath(new URL(c.req.url).pathname)
		? "agent:execute"
		: c.req.method === "GET" || c.req.method === "HEAD"
			? "public:read"
			: "public:write";
	if (scopes.includes("*") || scopes.includes(required)) return next();
	throw new AppError("API key scope does not permit this operation", {
		status: 403,
		code: "api_key_scope_forbidden",
		details: { required },
	});
}

export function buildApiKeyUserAuthPayload(input: {
	userId: string;
	role: string | null;
	hasPassword: boolean;
}) {
	return {
		sub: input.userId,
		login: input.userId,
		role: input.role,
		hasPassword: input.hasPassword,
	};
}

/**
 * Origin 白名单运行时校验（浏览器防盗用）：
 * - 请求不带 Origin 头（server-to-server / curl）→ 放行——白名单管的是「网页里嵌了别人的 key」，
 *   不是服务端调用；服务端调用本就持有完整 key，无 Origin 可言。
 * - 白名单含 "*"、为空或历史数据解析失败 → 放行（宽容旧 key）。
 * - 带 Origin 且不在白名单 → 抛 403（JWT 有效时外层按「坏 key 可忽略」处理，与无效 key 同语义）。
 */
export async function apiKeyAuthMiddleware(c: AppContext, next: Next) {
	const apiKey = readApiKeyFromRequest(c);

	// 与 authMiddleware 对齐：透传浏览器选中的账户（X-Team-Id）。
	// 此前 public 路由（/public/agents/chat 等）从不读该头，resolveBillingTeamId 只能走
	// fallback 链（第一个企业团队），导致用户在 UI 选「个人账户」发起的对话仍扣团队积分。
	// resolveBillingTeamId 对企业团队会做成员校验、个人 sentinel 归到本人，不存在伪造扣他人账户的风险。
	const teamIdHeader = c.req.header("X-Team-Id");
	c.set("activeTeamId", teamIdHeader && teamIdHeader.trim() ? teamIdHeader.trim() : null);

	// 【编排域状态机·内部服务鉴权（2026-07-11 ch17 首航 critic 401 根治）】
	// 服务端派发的 writer 子agent 回调 /public/agents/tools/execute 时没有用户 tc_sk（TAPCANVAS_API_KEY
	// env 为空、驱动上下文亦无请求头可继承）→ 版本化 `tc_internal:v2:*` 内部委托令牌
	// 走 server-to-server 鉴权并代跑该 run 属主身份（x-api-key 头承载）。v2 凭据为短期 HMAC
	// 签名载荷，不携带 INTERNAL_WORKER_TOKEN；签名或有效期不匹配一律 401，
	// 不回退普通链路——内部令牌只在 compose 内网流转，零对外放宽。
	if (isInternalApiKey(apiKey)) {
		const expected = String(c.env.INTERNAL_WORKER_TOKEN ?? "").trim();
		const identity = parseInternalApiKey(apiKey ?? "", expected);
		if (!identity) {
			throw new AppError("Unauthorized", { status: 401, code: "internal_token_invalid" });
		}
		const ownerState = await tryGetUserDbAuthState(c.env.DB, identity.userId);
		if (!ownerState) {
			throw new AppError("Unauthorized", {
				status: 401,
				code: "internal_delegation_owner_missing",
			});
		}
		if (ownerState.deletedAt) {
			throw new AppError("Account deleted", {
				status: 403,
				code: "internal_delegation_owner_deleted",
			});
		}
		if (ownerState.disabled) {
			throw new AppError("Account disabled", {
				status: 403,
				code: "internal_delegation_owner_disabled",
			});
		}
		if (identity.apiKeyId) {
			const delegatedKey = await getApiKeyByIdForOwner(
				c.env.DB,
				identity.apiKeyId,
				identity.userId,
			);
			const expiresAtMs = delegatedKey?.expires_at
				? Date.parse(delegatedKey.expires_at)
				: null;
			if (
				!delegatedKey
				|| delegatedKey.enabled !== 1
				|| Boolean(delegatedKey.revoked_at)
				|| (expiresAtMs !== null && (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()))
			) {
				throw new AppError("Unauthorized", {
					status: 401,
					code: "internal_delegated_api_key_invalid",
				});
			}
			c.set("apiKeyId", delegatedKey.id);
			c.set("apiKeyScopes", parseScopes(delegatedKey.scopes));
			const billingTeamId = delegatedKey.billing_team_id?.trim() ?? "";
			if (billingTeamId) c.set("apiKeyBillingTeamId", billingTeamId);
			try {
				await touchApiKeyLastUsedAt(c.env.DB, delegatedKey.id, new Date().toISOString());
			} catch {
				// Authentication remains valid if the last-used audit write is unavailable.
			}
		}
		c.set("userId", identity.userId);
		c.set("apiKeyOwnerId", identity.userId);
		c.set("auth", buildApiKeyUserAuthPayload({
			userId: identity.userId,
			role: ownerState.role,
			hasPassword: ownerState.hasPassword,
		}));
		return next();
	}

	const devBypass = resolveDevPublicBypassFromContext(c);
	if (devBypass) {
		c.set("userId", devBypass.userId);
		c.set("auth", { sub: devBypass.userId, login: devBypass.userId, role: devBypass.role });
		c.set("devPublicBypass", true);
		return next();
	}

	const agentsCliGrant = await resolveAgentsCliGrant(c).catch(() => null);
	if (agentsCliGrant) {
		if (!agentsCliGrant.scopes.includes("agents:chat")) {
			throw new AppError("Agents CLI grant does not permit agent execution", {
				status: 403,
				code: "agents_cli_scope_forbidden",
				details: { required: "agents:chat" },
			});
		}
		const userState = await tryGetUserDbAuthState(c.env.DB, agentsCliGrant.userId);
		if (!userState) {
			throw new AppError("Unauthorized", { status: 401, code: "agents_cli_grant_user_missing" });
		}
		if (userState.deletedAt) {
			throw new AppError("Account deleted", { status: 403, code: "user_deleted" });
		}
		if (userState.disabled) {
			throw new AppError("Account disabled", { status: 403, code: "user_disabled" });
		}
		c.set("userId", agentsCliGrant.userId);
		c.set("apiKeyOwnerId", agentsCliGrant.userId);
		c.set("agentsCliScopes", agentsCliGrant.scopes);
		c.set("agentsCliBridgeBaseUrl", agentsCliGrant.bridgeBaseUrl);
		c.set("auth", {
			sub: agentsCliGrant.userId,
			login: agentsCliGrant.login,
			role: userState.role,
			hasPassword: userState.hasPassword,
			type: "agents_cli_grant",
		});
		return next();
	}

	// Prefer JWT as end-user identity (canvas usage); API key becomes optional.
	const resolved = await resolveAuth(c).catch(() => null);

	const jwtUserId = resolved?.payload?.sub ? String(resolved.payload.sub) : "";
	const hasJwt = Boolean(jwtUserId);

	if (hasJwt) {
		const userState = await tryGetUserDbAuthState(c.env.DB, jwtUserId);
		if (userState?.deletedAt) {
			throw new AppError("Account deleted", {
				status: 403,
				code: "user_deleted",
			});
		}
		if (userState?.disabled) {
			throw new AppError("Account disabled", {
				status: 403,
				code: "user_disabled",
			});
		}
		c.set("userId", jwtUserId);
		c.set("auth", {
			...resolved!.payload,
			role: userState?.role ?? resolved!.payload.role ?? null,
		});
	}

	let apiKeyRow:
		| Awaited<ReturnType<typeof resolveApiKeyRowFromRequest>>
		| null = null;
	let apiKeyOwnerState: Awaited<ReturnType<typeof tryGetUserDbAuthState>> = null;
	if (apiKey) {
		try {
			const row = await resolveApiKeyRowFromRequest(c);
			if (row) {
				const ownerState = await tryGetUserDbAuthState(c.env.DB, row.owner_id);
				if (ownerState?.deletedAt) {
					throw new AppError("Account deleted", {
						status: 403,
						code: "api_key_owner_deleted",
					});
				}
				if (ownerState?.disabled) {
					throw new AppError("Account disabled", {
						status: 403,
						code: "api_key_owner_disabled",
					});
				}
				if (!ownerState) {
					throw new AppError("Unauthorized", {
						status: 401,
						code: "api_key_owner_missing",
					});
				}
				apiKeyRow = row;
				apiKeyOwnerState = ownerState;
			}
		} catch (err) {
			// If JWT is valid, allow ignoring a bad API key (either one is enough).
			if (!hasJwt) throw err;
		}
	}

	// Require at least one valid auth method.
	if (!hasJwt && !apiKeyRow) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: apiKey ? "api_key_invalid" : "auth_missing",
		});
	}

	if (apiKeyRow) {
		c.set("apiKeyId", apiKeyRow.id);
		c.set("apiKeyScopes", parseScopes(apiKeyRow.scopes));
		c.set("apiKeyOwnerId", apiKeyRow.owner_id);
		if (!hasJwt) {
			c.set("userId", apiKeyRow.owner_id);
			c.set("auth", buildApiKeyUserAuthPayload({
				userId: apiKeyRow.owner_id,
				role: apiKeyOwnerState?.role ?? null,
				hasPassword: apiKeyOwnerState?.hasPassword ?? false,
			}));
		}

		// 计费归属：key 上显式配置了 billing_team_id 时透传，resolveBillingTeamId 会优先信任它
		// （分配给谁就扣谁的积分）。空则维持现状（扣 key 拥有者解析出的团队）。
		const billingTeamId =
			typeof (apiKeyRow as { billing_team_id?: string | null }).billing_team_id === "string"
				? (apiKeyRow as { billing_team_id?: string | null }).billing_team_id!.trim()
				: "";
		if (billingTeamId) c.set("apiKeyBillingTeamId", billingTeamId);

		try {
			await touchApiKeyLastUsedAt(
				c.env.DB,
				apiKeyRow.id,
				new Date().toISOString(),
			);
		} catch {
			// best-effort only
		}
	}

	return next();
}
