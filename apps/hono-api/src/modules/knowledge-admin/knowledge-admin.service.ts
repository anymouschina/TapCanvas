import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import {
  maybeStartAgentsBridgeOnDemand,
  readAgentsBridgeBaseUrl,
  readAgentsBridgeTimeoutMs,
  readAgentsBridgeToken,
} from "../task/task.agents-bridge";
import { isAdminRequest } from "../team/team.service";
import {
  KnowledgeAdminCardSchema,
  KnowledgeAdminListResponseSchema,
  KnowledgeAdminSyncSummarySchema,
  KnowledgeAdminUpsertResponseSchema,
  type KnowledgeAdminCardInputDto,
  type KnowledgeAdminListResponseDto,
  type KnowledgeAdminListQueryDto,
  type KnowledgeAdminSyncSummaryDto,
  type KnowledgeAdminUpsertResponseDto,
} from "./knowledge-admin.schemas";

function requireAdmin(c: AppContext): void {
  if (!c.get("userId")) {
    throw new AppError("Unauthorized", { status: 401, code: "unauthorized" });
  }
  if (!isAdminRequest(c)) {
    throw new AppError("Forbidden", { status: 403, code: "forbidden" });
  }
}

function readUpstreamError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
  const record = payload as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message.trim() : "";
  if (message) return message;
  const error = typeof record.error === "string" ? record.error.trim() : "";
  return error || fallback;
}

async function requestKnowledgeBridge(
  c: AppContext,
  input: { method: "GET" | "POST"; pathname: string; body?: unknown },
): Promise<unknown> {
  let baseUrl = readAgentsBridgeBaseUrl(c);
  if (!baseUrl) baseUrl = await maybeStartAgentsBridgeOnDemand(c);
  if (!baseUrl) {
    throw new AppError("Agents bridge 未配置（缺少 AGENTS_BRIDGE_BASE_URL）", {
      status: 503,
      code: "agents_bridge_not_configured",
    });
  }

  const token = readAgentsBridgeToken(c);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${input.pathname}`, {
      method: input.method,
      headers: {
        ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: AbortSignal.timeout(readAgentsBridgeTimeoutMs(c)),
    });
  } catch (error: unknown) {
    throw new AppError("知识库管理无法连接 agents bridge", {
      status: 502,
      code: "knowledge_admin_bridge_fetch_failed",
      details: { reason: error instanceof Error ? error.message : String(error) },
    });
  }

  const rawBody = await response.text().catch(() => "");
  let payload: unknown = null;
  if (rawBody.trim()) {
    try {
      payload = JSON.parse(rawBody) as unknown;
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    throw new AppError(
      readUpstreamError(payload, `知识库管理请求失败: ${response.status}`),
      {
        status: response.status >= 500 ? 502 : response.status,
        code: "knowledge_admin_bridge_failed",
        details: { upstreamStatus: response.status },
      },
    );
  }
  return payload;
}

export async function listAdminKnowledge(
  c: AppContext,
  input: KnowledgeAdminListQueryDto,
): Promise<KnowledgeAdminListResponseDto> {
  requireAdmin(c);
  const query = new URLSearchParams({
    collection: input.collection,
    page: String(input.page),
    pageSize: String(input.pageSize),
  });
  if (input.query) query.set("query", input.query);
  if (input.domain) query.set("domain", input.domain);
  if (input.facet) query.set("facet", input.facet);
  if (input.roleScope) query.set("roleScope", input.roleScope);
  const payload = await requestKnowledgeBridge(c, {
    method: "GET",
    pathname: `/admin/knowledge?${query.toString()}`,
  });
  return KnowledgeAdminListResponseSchema.parse(payload);
}

export async function getAdminKnowledgeCard(c: AppContext, cardId: string): Promise<KnowledgeAdminListResponseDto["cards"][number]> {
  requireAdmin(c);
  const normalizedId = cardId.trim();
  if (!normalizedId) {
    throw new AppError("cardId 不能为空", { status: 400, code: "invalid_request" });
  }
  const payload = await requestKnowledgeBridge(c, {
    method: "GET",
    pathname: `/admin/knowledge/${encodeURIComponent(normalizedId)}`,
  });
  // The bridge returns one card for this endpoint; use the list schema's card
  // contract so frontend and bridge cannot silently drift.
  return KnowledgeAdminCardSchema.parse(payload);
}

export async function upsertAdminKnowledge(
  c: AppContext,
  input: KnowledgeAdminCardInputDto,
): Promise<KnowledgeAdminUpsertResponseDto> {
  requireAdmin(c);
  const payload = await requestKnowledgeBridge(c, {
    method: "POST",
    pathname: "/admin/knowledge",
    body: input,
  });
  return KnowledgeAdminUpsertResponseSchema.parse(payload);
}

export async function syncAdminKnowledge(c: AppContext): Promise<KnowledgeAdminSyncSummaryDto> {
  requireAdmin(c);
  const payload = await requestKnowledgeBridge(c, {
    method: "POST",
    pathname: "/admin/knowledge/sync",
  });
  return KnowledgeAdminSyncSummarySchema.parse(payload);
}
