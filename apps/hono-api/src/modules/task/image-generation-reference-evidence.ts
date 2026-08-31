import { getPrismaClient } from "../../platform/node/prisma";

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === "http:" || url.protocol === "https:" ? normalized : null;
  } catch {
    return null;
  }
}

export function readImageGenerationReferenceUrls(requestJson: string | null): string[] {
  if (!requestJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(requestJson) as unknown;
  } catch {
    return [];
  }
  const envelope = readRecord(parsed);
  const request = readRecord(envelope?.request);
  const extras = readRecord(request?.extras);
  if (!extras) return [];

  const urls: string[] = [];
  if (Array.isArray(extras.referenceImages)) {
    for (const value of extras.referenceImages) {
      const url = readHttpUrl(value);
      if (url) urls.push(url);
    }
  }
  if (Array.isArray(extras.assetInputs)) {
    for (const value of extras.assetInputs) {
      const url = readHttpUrl(readRecord(value)?.url);
      if (url) urls.push(url);
    }
  }
  return [...new Set(urls)];
}

export function readImageGenerationUpstreamTaskId(resultJson: string | null): string | null {
  if (!resultJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(resultJson) as unknown;
  } catch {
    return null;
  }
  const result = readRecord(parsed);
  const raw = readRecord(result?.raw);
  const upstreamTaskId = raw?.upstreamTaskId;
  return typeof upstreamTaskId === "string" && upstreamTaskId.trim()
    ? upstreamTaskId.trim()
    : null;
}

export async function loadImageGenerationReferenceUrlsByTaskId(input: {
  ownerId: string;
  taskIds: string[];
}): Promise<Map<string, string[]>> {
  const taskIds = [...new Set(input.taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
  if (!input.ownerId.trim() || taskIds.length === 0) return new Map();

  const ownerId = input.ownerId.trim();
  const prisma = getPrismaClient();
  const taskResultRows = await prisma.task_results.findMany({
    where: {
      user_id: ownerId,
      task_id: { in: taskIds },
    },
    select: {
      task_id: true,
      result: true,
    },
  });
  const upstreamTaskIdByLocalTaskId = new Map<string, string>();
  for (const row of taskResultRows) {
    const upstreamTaskId = readImageGenerationUpstreamTaskId(row.result);
    if (upstreamTaskId) upstreamTaskIdByLocalTaskId.set(row.task_id, upstreamTaskId);
  }

  const vendorTaskIds = [
    ...new Set([...taskIds, ...upstreamTaskIdByLocalTaskId.values()]),
  ];
  const rows = await prisma.vendor_api_call_logs.findMany({
    where: {
      user_id: ownerId,
      task_id: { in: vendorTaskIds },
    },
    select: {
      task_id: true,
      request_json: true,
    },
  });
  const referencesByVendorTaskId = new Map<string, string[]>();
  for (const row of rows) {
    const current = referencesByVendorTaskId.get(row.task_id) ?? [];
    referencesByVendorTaskId.set(
      row.task_id,
      [...new Set([...current, ...readImageGenerationReferenceUrls(row.request_json)])],
    );
  }

  const referencesByTaskId = new Map<string, string[]>();
  for (const taskId of taskIds) {
    const upstreamTaskId = upstreamTaskIdByLocalTaskId.get(taskId);
    const references = [
      ...(referencesByVendorTaskId.get(taskId) ?? []),
      ...(upstreamTaskId ? referencesByVendorTaskId.get(upstreamTaskId) ?? [] : []),
    ];
    if (references.length > 0) referencesByTaskId.set(taskId, [...new Set(references)]);
  }
  return referencesByTaskId;
}
