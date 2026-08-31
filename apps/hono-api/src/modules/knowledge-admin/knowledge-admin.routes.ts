import { Hono } from "hono";

import { authMiddleware } from "../../middleware/auth";
import type { AppEnv } from "../../types";
import {
  KnowledgeAdminCardInputSchema,
  KnowledgeAdminCardSchema,
  KnowledgeAdminListQuerySchema,
  KnowledgeAdminListResponseSchema,
  KnowledgeAdminSyncSummarySchema,
  KnowledgeAdminUpsertResponseSchema,
} from "./knowledge-admin.schemas";
import {
  getAdminKnowledgeCard,
  listAdminKnowledge,
  syncAdminKnowledge,
  upsertAdminKnowledge,
} from "./knowledge-admin.service";

export const knowledgeAdminRouter = new Hono<AppEnv>();

knowledgeAdminRouter.use("*", authMiddleware);

knowledgeAdminRouter.get("/", async (c) => {
  const parsed = KnowledgeAdminListQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: "Invalid knowledge query", issues: parsed.error.issues }, 400);
  }
  const result = await listAdminKnowledge(c, parsed.data);
  return c.json(KnowledgeAdminListResponseSchema.parse(result));
});

knowledgeAdminRouter.get("/:cardId", async (c) => {
  const result = await getAdminKnowledgeCard(c, c.req.param("cardId"));
  return c.json(KnowledgeAdminCardSchema.parse(result));
});

knowledgeAdminRouter.post("/", async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const parsed = KnowledgeAdminCardInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid knowledge card", issues: parsed.error.issues }, 400);
  }
  const result = await upsertAdminKnowledge(c, parsed.data);
  return c.json(KnowledgeAdminUpsertResponseSchema.parse(result));
});

knowledgeAdminRouter.post("/sync", async (c) => {
  const result = await syncAdminKnowledge(c);
  return c.json(KnowledgeAdminSyncSummarySchema.parse(result));
});
