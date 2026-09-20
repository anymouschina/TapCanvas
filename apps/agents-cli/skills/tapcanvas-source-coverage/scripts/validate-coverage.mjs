#!/usr/bin/env node

import fs from "node:fs";

const VERSION = "tapcanvas-source-coverage/v1";
const ALLOWED_UNITS = new Set(["characters", "paragraphs", "pages", "seconds", "items"]);
const EPSILON = 1e-9;

function fail(message, details = []) {
  process.stdout.write(`${JSON.stringify({ ok: false, coverageStatus: "invalid", message, details }, null, 2)}\n`);
  process.exitCode = 2;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readInput(inputPath) {
  if (!inputPath) {
    throw new Error("用法: validate-coverage.mjs <ledger.json|->");
  }
  const raw = inputPath === "-" ? fs.readFileSync(0, "utf-8") : fs.readFileSync(inputPath, "utf-8");
  return JSON.parse(raw);
}

function validateRange(raw, pathLabel, expectedRange, requireEvidence) {
  if (!isRecord(raw)) return { errors: [`${pathLabel} 必须是对象`], range: null };
  const start = asFiniteNumber(raw.start);
  const end = asFiniteNumber(raw.end);
  const errors = [];
  if (start === null || end === null) errors.push(`${pathLabel}.start/end 必须是有限数值`);
  if (start !== null && end !== null && end <= start) errors.push(`${pathLabel} 必须满足 end > start`);
  if (
    expectedRange &&
    start !== null &&
    end !== null &&
    (start < expectedRange.start - EPSILON || end > expectedRange.end + EPSILON)
  ) {
    errors.push(`${pathLabel} 超出 expectedRange`);
  }
  if (requireEvidence) {
    const evidenceIds = Array.isArray(raw.evidenceIds)
      ? raw.evidenceIds.filter((item) => typeof item === "string" && item.trim().length > 0)
      : [];
    if (evidenceIds.length === 0) errors.push(`${pathLabel}.evidenceIds 至少需要一个真实证据 ID`);
  }
  return {
    errors,
    range: start === null || end === null || end <= start ? null : { start, end },
  };
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of sorted) {
    const tail = merged.at(-1);
    if (!tail || range.start > tail.end + EPSILON) {
      merged.push({ ...range });
      continue;
    }
    tail.end = Math.max(tail.end, range.end);
  }
  return merged;
}

function findGaps(expectedRange, merged) {
  const gaps = [];
  let cursor = expectedRange.start;
  for (const range of merged) {
    if (range.start > cursor + EPSILON) gaps.push({ start: cursor, end: range.start });
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < expectedRange.end - EPSILON) gaps.push({ start: cursor, end: expectedRange.end });
  return gaps;
}

function validateLedger(ledger) {
  const errors = [];
  if (!isRecord(ledger)) return { errors: ["账本顶层必须是对象"], sources: [] };
  if (ledger.version !== VERSION) errors.push(`version 必须是 ${VERSION}`);
  if (typeof ledger.expectedDelivery !== "string" || !ledger.expectedDelivery.trim()) {
    errors.push("expectedDelivery 必须是非空字符串");
  }
  if (!Array.isArray(ledger.sources) || ledger.sources.length === 0) {
    errors.push("sources 至少需要一个来源");
    return { errors, sources: [] };
  }

  const seenSourceIds = new Set();
  const sources = ledger.sources.map((rawSource, sourceIndex) => {
    const pathLabel = `sources[${sourceIndex}]`;
    if (!isRecord(rawSource)) {
      errors.push(`${pathLabel} 必须是对象`);
      return { sourceId: "", status: "invalid", mergedRanges: [], gaps: [] };
    }
    const sourceId = typeof rawSource.sourceId === "string" ? rawSource.sourceId.trim() : "";
    if (!sourceId) errors.push(`${pathLabel}.sourceId 必须是非空字符串`);
    if (sourceId && seenSourceIds.has(sourceId)) errors.push(`${pathLabel}.sourceId 重复: ${sourceId}`);
    if (sourceId) seenSourceIds.add(sourceId);
    if (!ALLOWED_UNITS.has(rawSource.unit)) errors.push(`${pathLabel}.unit 不受支持: ${String(rawSource.unit)}`);

    const expectedResult = validateRange(rawSource.expectedRange, `${pathLabel}.expectedRange`, null, false);
    errors.push(...expectedResult.errors);
    const expectedRange = expectedResult.range;
    const coveredRaw = Array.isArray(rawSource.coveredRanges) ? rawSource.coveredRanges : [];
    const covered = [];
    for (let rangeIndex = 0; rangeIndex < coveredRaw.length; rangeIndex += 1) {
      const result = validateRange(
        coveredRaw[rangeIndex],
        `${pathLabel}.coveredRanges[${rangeIndex}]`,
        expectedRange,
        true,
      );
      errors.push(...result.errors);
      if (result.range) covered.push(result.range);
    }
    const failedRaw = Array.isArray(rawSource.failedRanges) ? rawSource.failedRanges : [];
    for (let rangeIndex = 0; rangeIndex < failedRaw.length; rangeIndex += 1) {
      const failed = failedRaw[rangeIndex];
      const result = validateRange(
        failed,
        `${pathLabel}.failedRanges[${rangeIndex}]`,
        expectedRange,
        false,
      );
      errors.push(...result.errors);
      if (!isRecord(failed) || typeof failed.reason !== "string" || !failed.reason.trim()) {
        errors.push(`${pathLabel}.failedRanges[${rangeIndex}].reason 必须是非空字符串`);
      }
    }

    const mergedRanges = mergeRanges(covered);
    const gaps = expectedRange ? findGaps(expectedRange, mergedRanges) : [];
    return {
      sourceId,
      status: expectedRange && gaps.length === 0 ? "complete" : "partial",
      expectedRange,
      mergedRanges,
      gaps,
      failedRangeCount: failedRaw.length,
    };
  });
  return { errors, sources };
}

let ledger;
try {
  ledger = readInput(process.argv[2]);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (ledger !== undefined) {
  const result = validateLedger(ledger);
  if (result.errors.length > 0) {
    fail("覆盖账本无效", result.errors);
  } else {
    const coverageStatus = result.sources.every((source) => source.status === "complete")
      ? "complete"
      : "partial";
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: coverageStatus === "complete",
          coverageStatus,
          semanticAccuracyVerified: false,
          sources: result.sources,
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = coverageStatus === "complete" ? 0 : 1;
  }
}

