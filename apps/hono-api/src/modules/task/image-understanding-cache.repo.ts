import type { PrismaClient } from "../../types";
import type { ImageAnalysisCacheStore } from "./image-understanding-cache";

/** Reuse the existing durable task-status store; no schema migration or Redis lease. */
export function imageAnalysisCacheStore(db: Pick<PrismaClient, "task_statuses">, ownerId: string, key: string): ImageAnalysisCacheStore {
  const provider = "image-understanding";
  const where = { id: key, user_id: ownerId, provider };
  return {
    async claim() {
      const now = new Date().toISOString();
      const created = await db.task_statuses.createMany({ data: [{
        id: key, task_id: key, provider, user_id: ownerId, status: "running",
        created_at: now, updated_at: now,
      }], skipDuplicates: true });
      if (created.count === 1) return true;
      const reclaimed = await db.task_statuses.updateMany({
        where: { ...where, status: "rejected_pre_upstream" },
        data: { status: "running", data: null, updated_at: now },
      });
      return reclaimed.count === 1;
    },
    read: () => db.task_statuses.findFirst({ where, select: { status: true, data: true, updated_at: true } }),
    async touch() {
      await db.task_statuses.updateMany({ where: { ...where, status: "running" }, data: { updated_at: new Date().toISOString() } });
    },
    async finish(status, data) {
      // A late uncertain writer cannot overwrite a recovered success.
      const result = await db.task_statuses.updateMany({
        where: { ...where, status: { in: ["running", "uncertain"] } },
        data: { status, data, updated_at: new Date().toISOString(), ...(status === "succeeded" ? { completed_at: new Date().toISOString() } : {}) },
      });
      if (result.count === 0) {
        const existing = await db.task_statuses.findFirst({ where, select: { status: true } });
        if (existing?.status !== "succeeded") throw new Error("Image analysis claim could not be completed");
      }
    },
  };
}
