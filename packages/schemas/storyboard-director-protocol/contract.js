"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeStoryboardStoryFactsContext = normalizeStoryboardStoryFactsContext;
exports.normalizeStoryboardStoryFactLocks = normalizeStoryboardStoryFactLocks;
exports.normalizeStoryboardStructuredTrace = normalizeStoryboardStructuredTrace;
exports.validateExpectedContext = validateExpectedContext;
exports.validateStoryboardDirectorV12Contract = validateStoryboardDirectorV12Contract;
const director_shape_contract_1 = require("./director-shape-contract");
const story_facts_contract_1 = require("./story-facts-contract");
const types_1 = require("./types");
const validation_utils_1 = require("./validation-utils");
function normalizeStoryboardStoryFactsContext(value) {
    const issues = [];
    const context = (0, story_facts_contract_1.parseStoryFactsContext)(value, "$.storyFactsContext", issues);
    return context && issues.length === 0 ? context : null;
}
function normalizeStoryboardStoryFactLocks(value, context) {
    const issues = [];
    const locks = (0, story_facts_contract_1.parseStoryFactLocks)(value, context, "$.storyFactLocks", issues);
    return locks && issues.length === 0 ? locks : null;
}
function normalizeStoryboardStructuredTrace(value) {
    const record = (0, validation_utils_1.asRecord)(value);
    if (!record)
        return null;
    const rawContext = record.storyFactsContext ?? record.story_facts_context;
    const storyFactsContext = normalizeStoryboardStoryFactsContext(rawContext);
    const rawShots = Array.isArray(record.shots) ? record.shots : null;
    if (!storyFactsContext || !rawShots)
        return null;
    const issues = [];
    const validatedShots = [];
    for (let index = 0; index < rawShots.length; index += 1) {
        const shotRecord = (0, validation_utils_1.asRecord)(rawShots[index]);
        if (!shotRecord)
            return null;
        const purpose = (0, validation_utils_1.asRecord)(shotRecord.purpose);
        const sourceShotId = typeof shotRecord.sourceShotId === "string"
            ? shotRecord.sourceShotId.trim()
            : typeof shotRecord.source_shot_id === "string"
                ? shotRecord.source_shot_id.trim()
                : "";
        const exitState = typeof shotRecord.exitState === "string"
            ? shotRecord.exitState.trim()
            : typeof shotRecord.exit_state === "string"
                ? shotRecord.exit_state.trim()
                : "";
        const continuityFromPrev = purpose && typeof purpose.continuity === "string"
            ? purpose.continuity.trim()
            : typeof shotRecord.continuity === "string"
                ? shotRecord.continuity.trim()
                : "";
        const storyFactLocks = (0, story_facts_contract_1.parseStoryFactLocks)(shotRecord.storyFactLocks ?? shotRecord.story_fact_locks, storyFactsContext, `$.shots[${index}].storyFactLocks`, issues);
        if (!sourceShotId || !exitState || !continuityFromPrev || !storyFactLocks)
            return null;
        validatedShots.push({
            record: shotRecord,
            shotId: sourceShotId,
            exitState,
            continuityFromPrev,
            storyFactLocks,
        });
    }
    (0, story_facts_contract_1.validateTraceInvariants)(storyFactsContext, validatedShots, issues);
    if (issues.length > 0)
        return null;
    return {
        storyFactsContext,
        shots: validatedShots.map((shot) => ({
            sourceShotId: shot.shotId,
            exitState: shot.exitState,
            storyFactLocks: shot.storyFactLocks,
        })),
    };
}
function validateExpectedContext(context, shots, expected, issues) {
    if (context.mode !== expected.mode) {
        (0, validation_utils_1.pushIssue)(issues, "story_facts_expected_mode_mismatch", "$.storyFactsContext.mode", "事实来源模式与本轮真实上下文不一致");
        return;
    }
    if (expected.mode === "book_ledger" && context.mode === "book_ledger") {
        if (context.bookId !== expected.bookId) {
            (0, validation_utils_1.pushIssue)(issues, "story_facts_book_id_mismatch", "$.storyFactsContext.bookId", "bookId 与本轮真实账本不一致");
        }
        if (context.ledgerRevision !== expected.ledgerRevision) {
            (0, validation_utils_1.pushIssue)(issues, "story_facts_ledger_revision_mismatch", "$.storyFactsContext.ledgerRevision", "ledgerRevision 与本轮真实账本不一致");
        }
        if (context.effectiveAt.chapter !== expected.effectiveAt.chapter ||
            context.effectiveAt.sequence !== expected.effectiveAt.sequence) {
            (0, validation_utils_1.pushIssue)(issues, "story_facts_effective_at_mismatch", "$.storyFactsContext.effectiveAt", "effectiveAt 与本轮真实故事点不一致");
        }
        const factById = new Map();
        for (const fact of expected.facts) {
            if (factById.has(fact.factId)) {
                (0, validation_utils_1.pushIssue)(issues, "expected_story_fact_duplicate", "$.storyFactsContext.consumedFactIds", `权威账本快照包含重复 factId: ${fact.factId}`);
                continue;
            }
            factById.set(fact.factId, fact);
        }
        for (const factId of context.consumedFactIds) {
            if (!factById.has(factId)) {
                (0, validation_utils_1.pushIssue)(issues, "story_fact_not_in_source_snapshot", "$.storyFactsContext.consumedFactIds", `factId 不属于本轮账本快照: ${factId}`);
            }
        }
        for (let index = 0; index < shots.length; index += 1) {
            const effectiveAt = shots[index].storyFactLocks.effectiveAt;
            if (!effectiveAt) {
                (0, validation_utils_1.pushIssue)(issues, "shot_story_point_missing", `$.shots[${index}].storyFactLocks.effectiveAt`, "book_ledger 镜头必须提供事实故事点");
                continue;
            }
            for (let bindingIndex = 0; bindingIndex < shots[index].storyFactLocks.bindings.length; bindingIndex += 1) {
                const binding = shots[index].storyFactLocks.bindings[bindingIndex];
                if (binding.source !== "story_fact")
                    continue;
                const bindingPath = `$.shots[${index}].storyFactLocks.bindings[${bindingIndex}]`;
                const fact = factById.get(binding.factId);
                if (!fact) {
                    (0, validation_utils_1.pushIssue)(issues, "story_fact_not_in_source_snapshot", `${bindingPath}.factId`, `factId 不属于本轮权威账本快照: ${binding.factId}`);
                    continue;
                }
                if (!isExpectedStoryFactActiveAt(fact, effectiveAt)) {
                    (0, validation_utils_1.pushIssue)(issues, "story_fact_not_active_at_shot", `${bindingPath}.factId`, `factId 在当前镜头故事点并非有效事实: ${binding.factId}`);
                }
                if (binding.category !== fact.category) {
                    (0, validation_utils_1.pushIssue)(issues, "story_fact_category_mismatch", `${bindingPath}.category`, `category 与权威账本不一致: ${binding.factId}`);
                }
                if (binding.status !== fact.status) {
                    (0, validation_utils_1.pushIssue)(issues, "story_fact_status_mismatch", `${bindingPath}.status`, `status 与权威账本不一致: ${binding.factId}`);
                }
                const disclosed = isExpectedStoryFactDisclosedAt(fact, effectiveAt);
                if (!disclosed && binding.visibility !== "hidden") {
                    (0, validation_utils_1.pushIssue)(issues, "story_fact_hidden_visibility_required", `${bindingPath}.visibility`, `factId 尚未到权威揭示点，visibility 必须为 hidden: ${binding.factId}`);
                }
                if (disclosed && binding.visibility === "hidden") {
                    (0, validation_utils_1.pushIssue)(issues, "story_fact_hidden_visibility_forbidden", `${bindingPath}.visibility`, `factId 已到权威揭示点，不得继续标记 hidden: ${binding.factId}`);
                }
                if (!disclosed && fact.disclosure.mode === "gated") {
                    const guard = shots[index].storyFactLocks.revealGuards.find((candidate) => candidate.source === "story_fact" && candidate.factId === binding.factId);
                    if (!guard) {
                        (0, validation_utils_1.pushIssue)(issues, "story_fact_authoritative_guard_missing", `$.shots[${index}].storyFactLocks.revealGuards`, `尚未揭示的 factId 缺少权威 reveal guard: ${binding.factId}`);
                    }
                    else if (!storyPointCoordinatesEqual(guard.notBefore, fact.disclosure.revealAt)) {
                        (0, validation_utils_1.pushIssue)(issues, "story_fact_authoritative_reveal_point_mismatch", `$.shots[${index}].storyFactLocks.revealGuards`, `reveal guard 的 notBefore 与权威 disclosure.revealAt 不一致: ${binding.factId}`);
                    }
                }
            }
        }
        return;
    }
    if (expected.mode === "task_context" && context.mode === "task_context") {
        const allowedContextKeys = new Set(expected.allowedContextKeys);
        for (const contextKey of context.consumedContextKeys) {
            if (!allowedContextKeys.has(contextKey)) {
                (0, validation_utils_1.pushIssue)(issues, "task_context_key_not_in_source_snapshot", "$.storyFactsContext.consumedContextKeys", `contextKey 不属于本轮显式上下文: ${contextKey}`);
            }
        }
    }
}
function storyPointCoordinatesEqual(left, right) {
    return left.chapter === right.chapter && left.sequence === right.sequence;
}
function isExpectedStoryFactActiveAt(fact, point) {
    if ((0, validation_utils_1.compareStoryPoints)(fact.validFrom, point) > 0)
        return false;
    return fact.validUntil === null || (0, validation_utils_1.compareStoryPoints)(point, fact.validUntil) < 0;
}
function isExpectedStoryFactDisclosedAt(fact, point) {
    return fact.disclosure.mode === "immediate" || (0, validation_utils_1.compareStoryPoints)(point, fact.disclosure.revealAt) >= 0;
}
function validateStoryboardDirectorV12Contract(value, options = {}) {
    const issues = [];
    const record = (0, validation_utils_1.asRecord)(value);
    if (!record) {
        return {
            ok: false,
            issues: [{ code: "storyboard_root_invalid", path: "$", message: "分镜输出必须是 JSON 对象" }],
        };
    }
    const schemaVersion = typeof record.schemaVersion === "string" ? record.schemaVersion.trim() : "";
    if (schemaVersion !== types_1.STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION) {
        return {
            ok: false,
            issues: [
                {
                    code: "storyboard_schema_version_invalid",
                    path: "$.schemaVersion",
                    message: `schemaVersion 必须是 ${types_1.STORYBOARD_DIRECTOR_V12_SCHEMA_VERSION}`,
                },
            ],
        };
    }
    const { globalStyle, rawShots } = (0, director_shape_contract_1.validateCoreArtifactShape)(record, issues);
    const storyFactsContext = (0, story_facts_contract_1.parseStoryFactsContext)(record.storyFactsContext, "$.storyFactsContext", issues);
    if (rawShots && rawShots.length > 128) {
        (0, validation_utils_1.pushIssue)(issues, "storyboard_shot_count_above_limit", "$.shots", "shots 最多允许 128 项");
    }
    if (options.expectedShotCount !== undefined && rawShots && rawShots.length !== options.expectedShotCount) {
        (0, validation_utils_1.pushIssue)(issues, "storyboard_shot_count_invalid", "$.shots", `期望 ${options.expectedShotCount} 个镜头，实际 ${rawShots.length}`);
    }
    const shots = [];
    for (let index = 0; index < (rawShots?.length ?? 0); index += 1) {
        const shotRecord = (0, validation_utils_1.asRecord)(rawShots?.[index]);
        if (!shotRecord) {
            (0, validation_utils_1.pushIssue)(issues, "storyboard_shot_invalid", `$.shots[${index}]`, "shot 必须是对象");
            continue;
        }
        const core = (0, director_shape_contract_1.validateShotCore)(shotRecord, index, issues);
        if (!storyFactsContext)
            continue;
        const storyFactLocks = (0, story_facts_contract_1.parseStoryFactLocks)(shotRecord.storyFactLocks, storyFactsContext, `$.shots[${index}].storyFactLocks`, issues);
        if (!core.shotId || !core.exitState || !core.continuityFromPrev || !storyFactLocks)
            continue;
        shots.push({
            record: shotRecord,
            shotId: core.shotId,
            exitState: core.exitState,
            continuityFromPrev: core.continuityFromPrev,
            storyFactLocks,
        });
    }
    if (storyFactsContext) {
        (0, story_facts_contract_1.validateTraceInvariants)(storyFactsContext, shots, issues);
        if (options.expectedContext)
            validateExpectedContext(storyFactsContext, shots, options.expectedContext, issues);
    }
    if (issues.length > 0 || !globalStyle || !storyFactsContext || shots.length !== (rawShots?.length ?? 0)) {
        return { ok: false, issues };
    }
    return {
        ok: true,
        value: {
            record,
            globalStyle,
            storyFactsContext,
            shots,
        },
    };
}
