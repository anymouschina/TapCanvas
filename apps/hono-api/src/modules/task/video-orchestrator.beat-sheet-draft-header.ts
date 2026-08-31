function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(
    (item) => typeof item === "string" && item.trim().length > 0,
  );
}

function unexpectedKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(record).filter((key) => !allowed.has(key));
}

function validateStoryPoint(value: unknown, path: string): string[] {
  if (!isRecord(value)) return [`${path} 必须是 {chapter,sequence}`];
  const issues: string[] = [];
  if (!Number.isInteger(value.chapter) || Number(value.chapter) < 1) {
    issues.push(`${path}.chapter 必须是 >=1 的整数`);
  }
  if (!Number.isInteger(value.sequence) || Number(value.sequence) < 0) {
    issues.push(`${path}.sequence 必须是 >=0 的整数`);
  }
  for (const key of unexpectedKeys(value, new Set(["chapter", "sequence"]))) {
    issues.push(`${path}.${key} 不允许字段`);
  }
  return issues;
}

function validateStoryFactsContext(value: unknown): string[] {
  if (!isRecord(value)) return ["storyFactsContext 必须是对象"];
  const mode = value.mode;
  if (mode === "book_ledger") {
    const issues: string[] = [];
    const allowed = new Set([
      "mode",
      "bookId",
      "ledgerRevision",
      "effectiveAt",
      "consumedFactIds",
      "consumedContextKeys",
    ]);
    for (const key of unexpectedKeys(value, allowed)) issues.push(`storyFactsContext.${key} 不允许字段`);
    if (typeof value.bookId !== "string" || value.bookId.trim().length === 0) {
      issues.push("storyFactsContext.bookId 必须是非空字符串");
    }
    if (!Number.isInteger(value.ledgerRevision) || Number(value.ledgerRevision) < 0) {
      issues.push("storyFactsContext.ledgerRevision 必须是 >=0 的整数");
    }
    issues.push(...validateStoryPoint(value.effectiveAt, "storyFactsContext.effectiveAt"));
    if (!isStringArray(value.consumedFactIds) && !(Array.isArray(value.consumedFactIds) && value.consumedFactIds.length === 0)) {
      issues.push("storyFactsContext.consumedFactIds 必须是字符串数组");
    }
    if (!Array.isArray(value.consumedContextKeys) || value.consumedContextKeys.length !== 0) {
      issues.push("book_ledger 的 storyFactsContext.consumedContextKeys 必须为 []");
    }
    return issues;
  }
  if (mode === "task_context") {
    const issues: string[] = [];
    const allowed = new Set([
      "mode",
      "sourceLabel",
      "bookId",
      "ledgerRevision",
      "effectiveAt",
      "consumedFactIds",
      "consumedContextKeys",
    ]);
    for (const key of unexpectedKeys(value, allowed)) issues.push(`storyFactsContext.${key} 不允许字段`);
    if (typeof value.sourceLabel !== "string" || value.sourceLabel.trim().length === 0) {
      issues.push("task_context 的 storyFactsContext.sourceLabel 必须是非空字符串");
    }
    for (const key of ["bookId", "ledgerRevision", "effectiveAt"] as const) {
      if (value[key] !== null) issues.push(`task_context 的 storyFactsContext.${key} 必须为 null`);
    }
    if (!Array.isArray(value.consumedFactIds) || value.consumedFactIds.length !== 0) {
      issues.push("task_context 的 storyFactsContext.consumedFactIds 必须为 []");
    }
    if (!isStringArray(value.consumedContextKeys) && !(Array.isArray(value.consumedContextKeys) && value.consumedContextKeys.length === 0)) {
      issues.push("task_context 的 storyFactsContext.consumedContextKeys 必须是字符串数组");
    }
    return issues;
  }
  return ["storyFactsContext.mode 必须是 book_ledger 或 task_context"];
}

/** Validates only deterministic, self-contained chapter-header structure. */
export function validateBeatSheetDraftHeader(header: Record<string, unknown>): string[] {
  const issues: string[] = [];
  if (header.version !== 2) issues.push("version 必须为 2");
  issues.push(...validateStoryFactsContext(header.storyFactsContext));
  if (!isRecord(header.meta)) {
    issues.push("meta 必须是对象");
  } else if (typeof header.meta.videoModel !== "string" || header.meta.videoModel.trim().length === 0) {
    issues.push("meta.videoModel 必须是非空字符串");
  } else if (header.meta.deliveryScope !== "full_chapter" && header.meta.deliveryScope !== "bounded_duration") {
    issues.push("meta.deliveryScope 必须是 full_chapter 或 bounded_duration");
  } else if (header.meta.executionScope !== "prompt_only" && header.meta.executionScope !== "media_delivery") {
    issues.push("meta.executionScope 必须是 prompt_only 或 media_delivery");
  }
  return issues;
}
