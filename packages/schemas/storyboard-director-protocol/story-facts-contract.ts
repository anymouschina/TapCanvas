import {
  STORYBOARD_FACT_STATUSES,
  STORYBOARD_FACT_VISIBILITIES,
  STORYBOARD_SECRET_BLOCKED_CHANNELS,
  type StoryboardDirectorV12ValidatedShot,
  type StoryboardDirectorV12ValidationIssue,
  type StoryboardFactStatus,
  type StoryboardFactVisibility,
  type StoryboardRevealGuard,
  type StoryboardSecretBlockedChannel,
  type StoryboardStoryFactBinding,
  type StoryboardStoryFactLocks,
  type StoryboardStoryFactsContext,
  type StoryboardStoryPoint,
} from "./types";
import {
  asRecord,
  compareStoryPoints,
  ensureAllowedKeys,
  parseStoryPoint,
  pushIssue,
  readRequiredFiniteNumber,
  readRequiredString,
  readStringArray,
} from "./validation-utils";

const FACT_STATUS_SET = new Set<string>(STORYBOARD_FACT_STATUSES);
const FACT_VISIBILITY_SET = new Set<string>(STORYBOARD_FACT_VISIBILITIES);
const SECRET_BLOCKED_CHANNEL_SET = new Set<string>(STORYBOARD_SECRET_BLOCKED_CHANNELS);

export function parseStoryFactsContext(
  value: unknown,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): StoryboardStoryFactsContext | null {
  const record = asRecord(value);
  if (!record) {
    pushIssue(issues, "story_facts_context_invalid", path, "storyFactsContext 必须是对象");
    return null;
  }
  const mode = typeof record.mode === "string" ? record.mode.trim() : "";
  if (mode === "book_ledger") {
    ensureAllowedKeys(
      record,
      ["mode", "bookId", "ledgerRevision", "effectiveAt", "consumedFactIds", "consumedContextKeys"],
      path,
      issues,
    );
    const bookId = readRequiredString(record, "bookId", path, issues, 200);
    const ledgerRevision = readRequiredFiniteNumber(record, "ledgerRevision", path, issues, {
      min: 0,
      integer: true,
    });
    const effectiveAt = parseStoryPoint(record.effectiveAt, `${path}.effectiveAt`, issues);
    const consumedFactIds = readStringArray(record.consumedFactIds, `${path}.consumedFactIds`, issues, {
      maxItems: 1_000,
      unique: true,
      itemMaxLength: 160,
    });
    const consumedContextKeys = readStringArray(record.consumedContextKeys, `${path}.consumedContextKeys`, issues, {
      maxItems: 0,
      unique: true,
      itemMaxLength: 160,
    });
    if (consumedContextKeys.length > 0) {
      pushIssue(
        issues,
        "book_context_keys_forbidden",
        `${path}.consumedContextKeys`,
        "book_ledger 模式不得混入 task context key",
      );
    }
    if (!bookId || ledgerRevision === null || !effectiveAt) return null;
    return {
      mode: "book_ledger",
      bookId,
      ledgerRevision,
      effectiveAt,
      consumedFactIds,
      consumedContextKeys: [],
    };
  }
  if (mode === "task_context") {
    ensureAllowedKeys(
      record,
      ["mode", "sourceLabel", "bookId", "ledgerRevision", "effectiveAt", "consumedFactIds", "consumedContextKeys"],
      path,
      issues,
    );
    const sourceLabel = readRequiredString(record, "sourceLabel", path, issues, 240);
    if (record.bookId !== null) {
      pushIssue(issues, "task_book_id_forbidden", `${path}.bookId`, "task_context 的 bookId 必须为 null");
    }
    if (record.ledgerRevision !== null) {
      pushIssue(
        issues,
        "task_ledger_revision_forbidden",
        `${path}.ledgerRevision`,
        "task_context 的 ledgerRevision 必须为 null",
      );
    }
    if (record.effectiveAt !== null) {
      pushIssue(issues, "task_story_point_forbidden", `${path}.effectiveAt`, "task_context 的 effectiveAt 必须为 null");
    }
    const consumedFactIds = readStringArray(record.consumedFactIds, `${path}.consumedFactIds`, issues, {
      maxItems: 0,
      unique: true,
      itemMaxLength: 160,
    });
    const consumedContextKeys = readStringArray(record.consumedContextKeys, `${path}.consumedContextKeys`, issues, {
      maxItems: 1_000,
      unique: true,
      itemMaxLength: 160,
    });
    if (consumedFactIds.length > 0) {
      pushIssue(
        issues,
        "task_fact_ids_forbidden",
        `${path}.consumedFactIds`,
        "task_context 不得伪造 story fact ID",
      );
    }
    if (!sourceLabel) return null;
    return {
      mode: "task_context",
      sourceLabel,
      bookId: null,
      ledgerRevision: null,
      effectiveAt: null,
      consumedFactIds: [],
      consumedContextKeys,
    };
  }
  pushIssue(
    issues,
    "story_facts_context_mode_invalid",
    `${path}.mode`,
    "mode 只能是 book_ledger 或 task_context",
  );
  return null;
}

function readFactStatus(
  record: Record<string, unknown>,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): StoryboardFactStatus | null {
  const value = typeof record.status === "string" ? record.status.trim() : "";
  if (!FACT_STATUS_SET.has(value)) {
    pushIssue(
      issues,
      "story_fact_status_invalid",
      `${path}.status`,
      `status 非法；允许值: ${STORYBOARD_FACT_STATUSES.join(" | ")}`,
    );
    return null;
  }
  return value as StoryboardFactStatus;
}

function readFactVisibility(
  record: Record<string, unknown>,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): StoryboardFactVisibility | null {
  const value = typeof record.visibility === "string" ? record.visibility.trim() : "";
  if (!FACT_VISIBILITY_SET.has(value)) {
    pushIssue(
      issues,
      "story_fact_visibility_invalid",
      `${path}.visibility`,
      `visibility 非法；允许值: ${STORYBOARD_FACT_VISIBILITIES.join(" | ")}`,
    );
    return null;
  }
  return value as StoryboardFactVisibility;
}

function parseStoryFactBinding(
  value: unknown,
  mode: StoryboardStoryFactsContext["mode"],
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): StoryboardStoryFactBinding | null {
  const record = asRecord(value);
  if (!record) {
    pushIssue(issues, "story_fact_binding_invalid", path, "binding 必须是对象");
    return null;
  }
  const source = typeof record.source === "string" ? record.source.trim() : "";
  const visibility = readFactVisibility(record, path, issues);
  const status = readFactStatus(record, path, issues);
  const category = readRequiredString(record, "category", path, issues, 40);
  if (status === "inferred" && visibility === "objective") {
    pushIssue(
      issues,
      "inferred_fact_cannot_be_objective",
      `${path}.visibility`,
      "inferred 事实不得投射为客观画面事实",
    );
  }

  if (source === "story_fact") {
    if (mode !== "book_ledger") {
      pushIssue(issues, "story_fact_source_mode_mismatch", `${path}.source`, "task_context 不得使用 story_fact binding");
    }
    const factId = readRequiredString(record, "factId", path, issues, 160);
    if (visibility === "hidden") {
      ensureAllowedKeys(record, ["source", "factId", "category", "status", "visibility"], path, issues);
      if (!factId || !category || !status) return null;
      return { source: "story_fact", factId, category, status, visibility: "hidden" };
    }
    ensureAllowedKeys(record, ["source", "factId", "category", "status", "visibility", "directive"], path, issues);
    const directive = readRequiredString(record, "directive", path, issues, 2_000);
    if (!factId || !category || !status || !visibility || !directive) return null;
    return { source: "story_fact", factId, category, status, visibility, directive };
  }

  if (source === "task_context") {
    if (mode !== "task_context") {
      pushIssue(issues, "task_context_source_mode_mismatch", `${path}.source`, "book_ledger 不得使用 task_context binding");
    }
    const contextKey = readRequiredString(record, "contextKey", path, issues, 160);
    if (visibility === "hidden") {
      ensureAllowedKeys(record, ["source", "contextKey", "category", "status", "visibility"], path, issues);
      if (!contextKey || !category || !status) return null;
      return { source: "task_context", contextKey, category, status, visibility: "hidden" };
    }
    ensureAllowedKeys(
      record,
      ["source", "contextKey", "sourceLabel", "category", "status", "visibility", "directive"],
      path,
      issues,
    );
    const sourceLabel = readRequiredString(record, "sourceLabel", path, issues, 240);
    const directive = readRequiredString(record, "directive", path, issues, 2_000);
    if (!contextKey || !sourceLabel || !category || !status || !visibility || !directive) return null;
    return { source: "task_context", contextKey, sourceLabel, category, status, visibility, directive };
  }

  pushIssue(
    issues,
    "story_fact_binding_source_invalid",
    `${path}.source`,
    "source 非法；允许值: story_fact | task_context",
  );
  return null;
}

function readBlockedChannels(
  value: unknown,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): StoryboardSecretBlockedChannel[] {
  const channels = readStringArray(value, path, issues, {
    minItems: STORYBOARD_SECRET_BLOCKED_CHANNELS.length,
    maxItems: STORYBOARD_SECRET_BLOCKED_CHANNELS.length,
    unique: true,
    itemMaxLength: 40,
  });
  const channelSet = new Set(channels);
  for (const channel of channels) {
    if (!SECRET_BLOCKED_CHANNEL_SET.has(channel)) {
      pushIssue(
        issues,
        "secret_blocked_channel_invalid",
        path,
        `未知 blocked channel: ${channel}；允许值: ${STORYBOARD_SECRET_BLOCKED_CHANNELS.join(" | ")}`,
      );
    }
  }
  for (const requiredChannel of STORYBOARD_SECRET_BLOCKED_CHANNELS) {
    if (!channelSet.has(requiredChannel)) {
      pushIssue(issues, "secret_blocked_channel_missing", path, `缺少 blocked channel: ${requiredChannel}`);
    }
  }
  return channels.filter((channel): channel is StoryboardSecretBlockedChannel => SECRET_BLOCKED_CHANNEL_SET.has(channel));
}

function parseRevealGuard(
  value: unknown,
  mode: StoryboardStoryFactsContext["mode"],
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): StoryboardRevealGuard | null {
  const record = asRecord(value);
  if (!record) {
    pushIssue(issues, "reveal_guard_invalid", path, "reveal guard 必须是对象");
    return null;
  }
  const source = typeof record.source === "string" ? record.source.trim() : "";
  const blockedChannels = readBlockedChannels(record.blockedChannels, `${path}.blockedChannels`, issues);
  if (source === "story_fact") {
    ensureAllowedKeys(record, ["source", "factId", "notBefore", "blockedChannels"], path, issues);
    if (mode !== "book_ledger") {
      pushIssue(issues, "story_fact_guard_mode_mismatch", `${path}.source`, "task_context 不得使用 story_fact guard");
    }
    const factId = readRequiredString(record, "factId", path, issues, 160);
    const notBefore = parseStoryPoint(record.notBefore, `${path}.notBefore`, issues);
    if (!factId || !notBefore) return null;
    return { source: "story_fact", factId, notBefore, blockedChannels };
  }
  if (source === "task_context") {
    ensureAllowedKeys(record, ["source", "contextKey", "notBeforeShotId", "blockedChannels"], path, issues);
    if (mode !== "task_context") {
      pushIssue(issues, "task_context_guard_mode_mismatch", `${path}.source`, "book_ledger 不得使用 task_context guard");
    }
    const contextKey = readRequiredString(record, "contextKey", path, issues, 160);
    const notBeforeShotId = record.notBeforeShotId;
    if (notBeforeShotId !== null && (typeof notBeforeShotId !== "string" || !notBeforeShotId.trim())) {
      pushIssue(
        issues,
        "task_guard_not_before_invalid",
        `${path}.notBeforeShotId`,
        "notBeforeShotId 必须是非空 shot ID 或 null",
      );
    }
    if (!contextKey) return null;
    return {
      source: "task_context",
      contextKey,
      notBeforeShotId: typeof notBeforeShotId === "string" ? notBeforeShotId.trim() : null,
      blockedChannels,
    };
  }
  pushIssue(
    issues,
    "reveal_guard_source_invalid",
    `${path}.source`,
    "reveal guard source 非法；允许值: story_fact | task_context",
  );
  return null;
}

function bindingReference(binding: StoryboardStoryFactBinding): string {
  return binding.source === "story_fact" ? `story_fact:${binding.factId}` : `task_context:${binding.contextKey}`;
}

function guardReference(guard: StoryboardRevealGuard): string {
  return guard.source === "story_fact" ? `story_fact:${guard.factId}` : `task_context:${guard.contextKey}`;
}

export function parseStoryFactLocks(
  value: unknown,
  context: StoryboardStoryFactsContext,
  path: string,
  issues: StoryboardDirectorV12ValidationIssue[],
): StoryboardStoryFactLocks | null {
  const record = asRecord(value);
  if (!record) {
    pushIssue(issues, "story_fact_locks_invalid", path, "storyFactLocks 必须是对象");
    return null;
  }
  ensureAllowedKeys(record, ["effectiveAt", "bindings", "revealGuards"], path, issues);
  let effectiveAt: StoryboardStoryPoint | null = null;
  if (context.mode === "book_ledger") {
    effectiveAt = parseStoryPoint(record.effectiveAt, `${path}.effectiveAt`, issues);
  } else if (record.effectiveAt !== null) {
    pushIssue(issues, "task_lock_story_point_forbidden", `${path}.effectiveAt`, "task_context 镜头 effectiveAt 必须为 null");
  }
  const rawBindings = Array.isArray(record.bindings) ? record.bindings : null;
  if (!rawBindings) pushIssue(issues, "story_fact_bindings_invalid", `${path}.bindings`, "bindings 必须是数组");
  const bindings = (rawBindings ?? [])
    .map((binding, index) => parseStoryFactBinding(binding, context.mode, `${path}.bindings[${index}]`, issues))
    .filter((binding): binding is StoryboardStoryFactBinding => binding !== null);
  const bindingRefs = new Set<string>();
  for (let index = 0; index < bindings.length; index += 1) {
    const reference = bindingReference(bindings[index]);
    if (bindingRefs.has(reference)) {
      pushIssue(issues, "story_fact_binding_duplicate", `${path}.bindings[${index}]`, `重复 binding ${reference}`);
    }
    bindingRefs.add(reference);
  }

  const rawGuards = Array.isArray(record.revealGuards) ? record.revealGuards : null;
  if (!rawGuards) pushIssue(issues, "reveal_guards_invalid", `${path}.revealGuards`, "revealGuards 必须是数组");
  const revealGuards = (rawGuards ?? [])
    .map((guard, index) => parseRevealGuard(guard, context.mode, `${path}.revealGuards[${index}]`, issues))
    .filter((guard): guard is StoryboardRevealGuard => guard !== null);
  const guardRefs = new Set<string>();
  for (let index = 0; index < revealGuards.length; index += 1) {
    const reference = guardReference(revealGuards[index]);
    if (guardRefs.has(reference)) {
      pushIssue(issues, "reveal_guard_duplicate", `${path}.revealGuards[${index}]`, `重复 reveal guard ${reference}`);
    }
    guardRefs.add(reference);
  }

  const hiddenRefs = new Set(
    bindings.filter((binding) => binding.visibility === "hidden").map((binding) => bindingReference(binding)),
  );
  for (const hiddenRef of hiddenRefs) {
    if (!guardRefs.has(hiddenRef)) {
      pushIssue(issues, "hidden_binding_guard_missing", path, `隐藏 binding 缺少 reveal guard: ${hiddenRef}`);
    }
  }
  for (const guardRef of guardRefs) {
    if (!hiddenRefs.has(guardRef)) {
      pushIssue(issues, "reveal_guard_without_hidden_binding", path, `reveal guard 没有对应隐藏 binding: ${guardRef}`);
    }
  }

  return { effectiveAt, bindings, revealGuards };
}

export function validateTraceInvariants(
  context: StoryboardStoryFactsContext,
  shots: StoryboardDirectorV12ValidatedShot[],
  issues: StoryboardDirectorV12ValidationIssue[],
): void {
  const usedFactIds = new Set<string>();
  const usedContextKeys = new Set<string>();
  const shotIndexById = new Map<string, number>();

  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    if (shotIndexById.has(shot.shotId)) {
      pushIssue(issues, "shot_id_duplicate", `$.shots[${index}].shotId`, `重复 shotId: ${shot.shotId}`);
    }
    shotIndexById.set(shot.shotId, index);
    if (context.mode === "book_ledger") {
      const effectiveAt = shot.storyFactLocks.effectiveAt;
      if (!effectiveAt) {
        pushIssue(
          issues,
          "shot_story_point_missing",
          `$.shots[${index}].storyFactLocks.effectiveAt`,
          "book_ledger 镜头必须提供 effectiveAt",
        );
      } else {
        if (effectiveAt.chapter !== context.effectiveAt.chapter) {
          pushIssue(
            issues,
            "shot_story_point_chapter_mismatch",
            `$.shots[${index}].storyFactLocks.effectiveAt.chapter`,
            "章节分镜内所有镜头故事点必须属于顶层 effectiveAt 的同一章",
          );
        }
        if (index === 0 && compareStoryPoints(effectiveAt, context.effectiveAt) !== 0) {
          pushIssue(
            issues,
            "first_shot_story_point_mismatch",
            `$.shots[${index}].storyFactLocks.effectiveAt`,
            "第一镜 effectiveAt 必须与顶层 storyFactsContext.effectiveAt 相同",
          );
        }
        const previousPoint = index > 0 ? shots[index - 1].storyFactLocks.effectiveAt : null;
        if (previousPoint && compareStoryPoints(effectiveAt, previousPoint) < 0) {
          pushIssue(
            issues,
            "shot_story_point_regression",
            `$.shots[${index}].storyFactLocks.effectiveAt`,
            "镜头 effectiveAt 必须按镜头顺序单调不减",
          );
        }
      }
    }
    if (index > 0 && shot.continuityFromPrev !== shots[index - 1].exitState) {
      pushIssue(
        issues,
        "shot_exit_state_handoff_mismatch",
        `$.shots[${index}].continuity.fromPrev`,
        "当前镜头 continuity.fromPrev 必须逐字等于上一镜 exitState",
      );
    }
    for (const binding of shot.storyFactLocks.bindings) {
      if (binding.source === "story_fact") usedFactIds.add(binding.factId);
      else usedContextKeys.add(binding.contextKey);
    }
    for (const guard of shot.storyFactLocks.revealGuards) {
      if (guard.source === "story_fact") {
        if (shot.storyFactLocks.effectiveAt && compareStoryPoints(shot.storyFactLocks.effectiveAt, guard.notBefore) >= 0) {
          pushIssue(
            issues,
            "hidden_fact_reveal_window_invalid",
            `$.shots[${index}].storyFactLocks.revealGuards`,
            "当前镜头已到 notBefore 故事点，不得继续把该 binding 标成 hidden",
          );
        }
      } else if (guard.notBeforeShotId) {
        const notBeforeIndex = shotIndexById.get(guard.notBeforeShotId);
        if (notBeforeIndex !== undefined && index >= notBeforeIndex) {
          pushIssue(
            issues,
            "task_hidden_reveal_window_invalid",
            `$.shots[${index}].storyFactLocks.revealGuards`,
            "当前镜头已到 notBeforeShotId，不得继续把该 binding 标成 hidden",
          );
        }
      }
    }
  }

  for (let index = 0; index < shots.length; index += 1) {
    for (const guard of shots[index].storyFactLocks.revealGuards) {
      if (guard.source !== "task_context" || !guard.notBeforeShotId) continue;
      const targetIndex = shotIndexById.get(guard.notBeforeShotId);
      if (targetIndex === undefined) {
        pushIssue(
          issues,
          "task_guard_target_missing",
          `$.shots[${index}].storyFactLocks.revealGuards`,
          `notBeforeShotId 不存在: ${guard.notBeforeShotId}`,
        );
      } else if (targetIndex <= index) {
        pushIssue(
          issues,
          "task_guard_target_not_later",
          `$.shots[${index}].storyFactLocks.revealGuards`,
          "notBeforeShotId 必须指向当前镜头之后的镜头",
        );
      }
    }
  }

  const expectedFactIds = new Set(context.consumedFactIds);
  const expectedContextKeys = new Set(context.consumedContextKeys);
  for (const factId of expectedFactIds) {
    if (!usedFactIds.has(factId)) {
      pushIssue(issues, "consumed_fact_unused", "$.storyFactsContext.consumedFactIds", `factId 未被任何镜头消费: ${factId}`);
    }
  }
  for (const factId of usedFactIds) {
    if (!expectedFactIds.has(factId)) {
      pushIssue(issues, "binding_fact_not_consumed", "$.shots", `镜头 binding 未列入 consumedFactIds: ${factId}`);
    }
  }
  // task context keys describe the authorized factual context available to the
  // sequence. A shot binding must stay within that set, but the sequence does
  // not have to repeat every available key as a semantic directive. Canonical
  // source coverage is tracked independently by the runtime source spans.
  for (const contextKey of usedContextKeys) {
    if (!expectedContextKeys.has(contextKey)) {
      pushIssue(issues, "binding_context_not_consumed", "$.shots", `镜头 binding 未列入 consumedContextKeys: ${contextKey}`);
    }
  }
}
