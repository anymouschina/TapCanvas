import { createHash } from "node:crypto";
import { getSharedRedis } from "../../platform/redis-shared";
import { getPrismaClient } from "../../platform/node/prisma";

type MemoryEntry = {
  value: string;
  expiresAt: number;
};

type BatchOperation =
  | { type: "set"; key: string; value: string; ttlSeconds: number }
  | { type: "del"; key: string };

const memory = new Map<string, MemoryEntry>();
let lastDegradedLogAt = 0;
const DEGRADED_LOG_THROTTLE_MS = 5_000;
const DURABLE_ARTIFACT_KEY = "workflow-state";

type DurableEnvelope = {
  version: 1;
  key: string;
  value: string;
  expiresAt: number;
};

function durableStoreEnabled(): boolean {
  return process.env.NODE_ENV !== "test" || process.env.VIDEO_DRAFT_DURABLE_TEST === "1";
}

function durableRunId(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 40);
  return `workflow-state-${hash}`;
}

function durableEnvelope(key: string, value: string, ttlSeconds: number): DurableEnvelope {
  return {
    version: 1,
    key,
    value,
    expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1_000,
  };
}

function parseDurableEnvelope(payload: string | null, expectedKey: string): DurableEnvelope | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as Partial<DurableEnvelope>;
    if (
      parsed.version !== 1 ||
      parsed.key !== expectedKey ||
      typeof parsed.value !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    return parsed as DurableEnvelope;
  } catch {
    return null;
  }
}

async function durableGet(key: string): Promise<string | null> {
  if (!durableStoreEnabled()) return null;
  const prisma = getPrismaClient();
  const runId = durableRunId(key);
  const row = await prisma.authoring_artifacts.findUnique({
    where: { run_id_artifact_key: { run_id: runId, artifact_key: DURABLE_ARTIFACT_KEY } },
    select: { payload: true },
  });
  const envelope = parseDurableEnvelope(row?.payload ?? null, key);
  if (!envelope) return null;
  if (envelope.expiresAt <= Date.now()) {
    await prisma.authoring_artifacts.deleteMany({
      where: { run_id: runId, artifact_key: DURABLE_ARTIFACT_KEY },
    });
    return null;
  }
  return envelope.value;
}

async function durableMget(keys: readonly string[]): Promise<Array<string | null>> {
  if (!durableStoreEnabled() || keys.length === 0) return keys.map(() => null);
  const runIds = keys.map(durableRunId);
  const rows = await getPrismaClient().authoring_artifacts.findMany({
    where: {
      run_id: { in: runIds },
      artifact_key: DURABLE_ARTIFACT_KEY,
    },
    select: { run_id: true, payload: true },
  });
  const rowByRunId = new Map(rows.map((row) => [row.run_id, row.payload]));
  return keys.map((key, index) => {
    const envelope = parseDurableEnvelope(rowByRunId.get(runIds[index]!) ?? null, key);
    return envelope && envelope.expiresAt > Date.now() ? envelope.value : null;
  });
}

async function durableSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  if (!durableStoreEnabled()) return;
  const prisma = getPrismaClient();
  const runId = durableRunId(key);
  const envelope = durableEnvelope(key, value, ttlSeconds);
  const payload = JSON.stringify(envelope);
  const contentHash = createHash("sha256").update(payload).digest("hex").slice(0, 32);
  const nowIso = new Date().toISOString();
  await prisma.authoring_artifacts.upsert({
    where: { run_id_artifact_key: { run_id: runId, artifact_key: DURABLE_ARTIFACT_KEY } },
    create: {
      id: `${runId}-${DURABLE_ARTIFACT_KEY}`,
      run_id: runId,
      artifact_key: DURABLE_ARTIFACT_KEY,
      content_hash: contentHash,
      derived_from: "[]",
      status: "ready",
      payload,
      error: null,
      created_at: nowIso,
      updated_at: nowIso,
    },
    update: {
      content_hash: contentHash,
      status: "ready",
      payload,
      error: null,
      updated_at: nowIso,
    },
  });
}

async function durableBatch(operations: readonly BatchOperation[]): Promise<void> {
  if (!durableStoreEnabled() || operations.length === 0) return;
  const prisma = getPrismaClient();
  await prisma.$transaction(async (db) => {
    const nowIso = new Date().toISOString();
    for (const operation of operations) {
      const runId = durableRunId(operation.key);
      if (operation.type === "del") {
        await db.authoring_artifacts.deleteMany({
          where: { run_id: runId, artifact_key: DURABLE_ARTIFACT_KEY },
        });
        continue;
      }
      const payload = JSON.stringify(durableEnvelope(
        operation.key,
        operation.value,
        operation.ttlSeconds,
      ));
      const contentHash = createHash("sha256").update(payload).digest("hex").slice(0, 32);
      await db.authoring_artifacts.upsert({
        where: { run_id_artifact_key: { run_id: runId, artifact_key: DURABLE_ARTIFACT_KEY } },
        create: {
          id: `${runId}-${DURABLE_ARTIFACT_KEY}`,
          run_id: runId,
          artifact_key: DURABLE_ARTIFACT_KEY,
          content_hash: contentHash,
          derived_from: "[]",
          status: "ready",
          payload,
          error: null,
          created_at: nowIso,
          updated_at: nowIso,
        },
        update: {
          content_hash: contentHash,
          status: "ready",
          payload,
          error: null,
          updated_at: nowIso,
        },
      });
    }
  });
}

function logDegraded(operation: string, error?: unknown): void {
  const now = Date.now();
  if (now - lastDegradedLogAt < DEGRADED_LOG_THROTTLE_MS) return;
  lastDegradedLogAt = now;
  console.warn(
    "[video-draft-store] a fast state backend is unavailable; continuing from durable/local recovery",
    { operation, reason: error instanceof Error ? error.message : String(error ?? "backend_not_configured") },
  );
}

function readMemory(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function setMemory(key: string, value: string, ttlSeconds: number): void {
  memory.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1_000,
  });
}

function applyMemoryBatch(operations: readonly BatchOperation[]): void {
  for (const operation of operations) {
    if (operation.type === "del") memory.delete(operation.key);
    else setMemory(operation.key, operation.value, operation.ttlSeconds);
  }
}

async function backfillRedis(key: string, value: string, ttlSeconds: number): Promise<void> {
  const redis = getSharedRedis();
  if (!redis) return;
  try {
    await redis.set(key, value, "EX", ttlSeconds);
  } catch (error) {
    logDegraded("backfill", error);
  }
}

export async function resilientDraftGet(key: string, ttlSeconds: number): Promise<string | null> {
  try {
    const durable = await durableGet(key);
    if (durable !== null) {
      setMemory(key, durable, ttlSeconds);
      await backfillRedis(key, durable, ttlSeconds);
      return durable;
    }
  } catch (error) {
    logDegraded("durable_get", error);
  }
  const redis = getSharedRedis();
  if (redis) {
    try {
      const value = await redis.get(key);
      if (value !== null) {
        setMemory(key, value, ttlSeconds);
        try {
          await durableSet(key, value, ttlSeconds);
        } catch (error) {
          logDegraded("durable_backfill", error);
        }
        return value;
      }
      const recovered = readMemory(key);
      if (recovered !== null) await backfillRedis(key, recovered, ttlSeconds);
      return recovered;
    } catch (error) {
      logDegraded("get", error);
    }
  } else {
    logDegraded("get");
  }
  return readMemory(key);
}

export async function resilientDraftMget(
  keys: readonly string[],
  ttlSeconds: number,
): Promise<Array<string | null>> {
  if (keys.length === 0) return [];
  let durableValues: Array<string | null> = keys.map(() => null);
  try {
    durableValues = await durableMget(keys);
    if (durableValues.every((value) => value !== null)) {
      await Promise.all(durableValues.map(async (value, index) => {
        setMemory(keys[index]!, value!, ttlSeconds);
        await backfillRedis(keys[index]!, value!, ttlSeconds);
      }));
      return durableValues;
    }
  } catch (error) {
    logDegraded("durable_mget", error);
  }
  const redis = getSharedRedis();
  if (redis) {
    try {
      const values = await redis.mget(...keys);
      for (const [index, value] of values.entries()) {
        if (durableValues[index] !== null) {
          values[index] = durableValues[index];
          setMemory(keys[index]!, durableValues[index]!, ttlSeconds);
        } else if (value !== null) {
          setMemory(keys[index]!, value, ttlSeconds);
          try {
            await durableSet(keys[index]!, value, ttlSeconds);
          } catch (error) {
            logDegraded("durable_backfill", error);
          }
        }
      }
      await Promise.all(values.map(async (value, index) => {
        if (value !== null) return;
        const recovered = readMemory(keys[index]!);
        if (recovered !== null) {
          values[index] = recovered;
          await backfillRedis(keys[index]!, recovered, ttlSeconds);
        }
      }));
      return values;
    } catch (error) {
      logDegraded("mget", error);
    }
  } else {
    logDegraded("mget");
  }
  return keys.map((key, index) => durableValues[index] ?? readMemory(key));
}

export async function resilientDraftSet(
  key: string,
  value: string,
  ttlSeconds: number,
): Promise<void> {
  try {
    await durableSet(key, value, ttlSeconds);
  } catch (error) {
    logDegraded("durable_set", error);
  }
  setMemory(key, value, ttlSeconds);
  const redis = getSharedRedis();
  if (!redis) {
    logDegraded("set");
    return;
  }
  try {
    await redis.set(key, value, "EX", ttlSeconds);
  } catch (error) {
    logDegraded("set", error);
  }
}

export async function resilientDraftExpire(key: string, ttlSeconds: number): Promise<void> {
  let value = readMemory(key);
  if (value === null) {
    try {
      value = await durableGet(key);
    } catch (error) {
      logDegraded("durable_expire_read", error);
    }
  }
  if (value !== null) setMemory(key, value, ttlSeconds);
  if (value !== null) {
    try {
      await durableSet(key, value, ttlSeconds);
    } catch (error) {
      logDegraded("durable_expire", error);
    }
  }
  const redis = getSharedRedis();
  if (!redis) {
    logDegraded("expire");
    return;
  }
  try {
    await redis.expire(key, ttlSeconds);
  } catch (error) {
    logDegraded("expire", error);
  }
}

export async function resilientDraftBatch(operations: readonly BatchOperation[]): Promise<void> {
  try {
    await durableBatch(operations);
  } catch (error) {
    logDegraded("durable_batch", error);
  }
  applyMemoryBatch(operations);
  const redis = getSharedRedis();
  if (!redis) {
    logDegraded("batch");
    return;
  }
  try {
    const transaction = redis.multi();
    for (const operation of operations) {
      if (operation.type === "del") transaction.del(operation.key);
      else transaction.set(operation.key, operation.value, "EX", operation.ttlSeconds);
    }
    await transaction.exec();
  } catch (error) {
    logDegraded("batch", error);
  }
}

export async function resilientDraftSetRepair(input: {
  draftKey: string;
  repairKey: string;
  expectedRevision: string;
  repairJson: string;
  ttlSeconds: number;
}): Promise<boolean> {
  const redis = getSharedRedis();
  if (redis) {
    try {
      const changed = await redis.eval(
        `local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local draft = cjson.decode(raw)
if draft.revision ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
return 1`,
        2,
        input.draftKey,
        input.repairKey,
        input.expectedRevision,
        input.repairJson,
        String(input.ttlSeconds),
      );
      if (Number(changed) !== 1) return false;
      try {
        await durableSet(input.repairKey, input.repairJson, input.ttlSeconds);
      } catch (error) {
        logDegraded("durable_set_repair", error);
      }
      setMemory(input.repairKey, input.repairJson, input.ttlSeconds);
      return true;
    } catch (error) {
      logDegraded("set_repair", error);
    }
  } else {
    logDegraded("set_repair");
  }
  const raw = await resilientDraftGet(input.draftKey, input.ttlSeconds);
  if (!raw) return false;
  try {
    const draft = JSON.parse(raw) as { revision?: unknown };
    if (draft.revision !== input.expectedRevision) return false;
  } catch {
    return false;
  }
  await resilientDraftSet(input.repairKey, input.repairJson, input.ttlSeconds);
  return true;
}

export async function resilientDraftCompareAndSetBeat(input: {
  currentKey: string;
  previousHistoryKey: string;
  nextHistoryKey: string;
  revisionKey: string;
  repairKey: string;
  observedRaw: string;
  observedRevision: string;
  nextRaw: string;
  nextRevision: string;
  ttlSeconds: number;
}): Promise<boolean> {
  const redis = getSharedRedis();
  if (redis) {
    try {
      const changed = await redis.eval(
        `local existing = redis.call('GET', KEYS[1])
if ARGV[1] == '' then
  if existing then return 0 end
elseif existing ~= ARGV[1] then
  return 0
end
if existing and ARGV[2] ~= '' then
  redis.call('SET', KEYS[2], existing, 'EX', ARGV[5])
end
redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[5])
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[5])
redis.call('SET', KEYS[4], ARGV[4], 'EX', ARGV[5])
return 1`,
        5,
        input.currentKey,
        input.previousHistoryKey,
        input.nextHistoryKey,
        input.revisionKey,
        input.repairKey,
        input.observedRaw,
        input.observedRevision,
        input.nextRaw,
        input.nextRevision,
        String(input.ttlSeconds),
      );
      if (Number(changed) !== 1) return false;
      const operations: BatchOperation[] = [
        {
          type: "set",
          key: input.nextHistoryKey,
          value: input.nextRaw,
          ttlSeconds: input.ttlSeconds,
        },
        {
          type: "set",
          key: input.currentKey,
          value: input.nextRaw,
          ttlSeconds: input.ttlSeconds,
        },
        {
          type: "set",
          key: input.revisionKey,
          value: input.nextRevision,
          ttlSeconds: input.ttlSeconds,
        },
      ];
      if (input.observedRaw && input.observedRevision) {
        operations.unshift({
          type: "set",
          key: input.previousHistoryKey,
          value: input.observedRaw,
          ttlSeconds: input.ttlSeconds,
        });
      }
      try {
        await durableBatch(operations);
      } catch (error) {
        logDegraded("durable_cas_beat", error);
      }
      applyMemoryBatch(operations);
      return true;
    } catch (error) {
      logDegraded("cas_beat", error);
    }
  } else {
    logDegraded("cas_beat");
  }
  const existing = await resilientDraftGet(input.currentKey, input.ttlSeconds) ?? "";
  if (existing !== input.observedRaw) return false;
  const operations: BatchOperation[] = [
    {
      type: "set",
      key: input.nextHistoryKey,
      value: input.nextRaw,
      ttlSeconds: input.ttlSeconds,
    },
    {
      type: "set",
      key: input.currentKey,
      value: input.nextRaw,
      ttlSeconds: input.ttlSeconds,
    },
    {
      type: "set",
      key: input.revisionKey,
      value: input.nextRevision,
      ttlSeconds: input.ttlSeconds,
    },
  ];
  if (existing && input.observedRevision) {
    operations.unshift({
      type: "set",
      key: input.previousHistoryKey,
      value: existing,
      ttlSeconds: input.ttlSeconds,
    });
  }
  await resilientDraftBatch(operations);
  return true;
}

export function resetResilientDraftStoreForTests(): void {
  memory.clear();
  lastDegradedLogAt = 0;
}
