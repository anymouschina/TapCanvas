import { createHash } from "node:crypto";

import type { CanvasIndexStyleLock } from "../material/material.repo";
import type { ActiveProjectLookBible } from "../material/project-look-bible";

export const PROJECT_STYLE_SOURCE = "project_style_reference" as const;

function readStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : []))];
}

function readStyleFactRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export type ProjectStyleProvenance = {
  styleLockId: string | null;
  styleName: string;
  stylePrompt: string;
  styleReferenceImages: string[];
  styleFingerprint: string | null;
  styleSource: typeof PROJECT_STYLE_SOURCE;
};

/**
 * Project the already-confirmed Look Bible into the compact style lock used by
 * every media executor.  This is deliberately a structural projection: the
 * Look Bible remains the semantic source of truth, while this helper only
 * copies its global and module directives into one deterministic prompt.
 */
export function styleLockFromProjectLookBible(
  active: ActiveProjectLookBible | null,
): CanvasIndexStyleLock | null {
  if (!active) return null;
  const core = active.lookBible.globalCore;
  const sectionPrompts = active.lookBible.sections.map((section) => [
    `模块：${section.name}`,
    `适用条件：${section.applicability}`,
    `模块指令：${section.directives.join("；")}`,
    `模块图片参考：${section.imagePrompt}`,
    `模块视频参考：${section.videoPrompt}`,
  ].join("\n"));
  const stylePrompt = [
    `项目视觉圣经：${active.lookBible.name}`,
    `全局摘要：${active.lookBible.summary}`,
    `风格名：${core.styleName}`,
    `视觉指令：${core.visualDirectives.join("；")}`,
    `一致性规则：${core.consistencyRules.join("；")}`,
    `负面指令：${core.negativeDirectives.join("；")}`,
    `角色参考：${core.characterPrompt}`,
    `图片参考：${core.imagePrompt}`,
    `视频参考：${core.videoPrompt}`,
    ...sectionPrompts,
  ].join("\n").trim();
  return {
    styleId: `project-look-bible:${active.lookBibleHash}`,
    styleName: core.styleName,
    stylePrompt,
    category: "project-look-bible",
  };
}

/**
 * Project an already-authored per-run style fact bundle into the same compact
 * lock used by the project Look Bible path. This is a structural projection:
 * it copies caller facts and never derives a palette, medium, reference image,
 * or other semantic default.
 */
export function styleLockFromTriggerFacts(value: unknown): CanvasIndexStyleLock | null {
  const record = readStyleFactRecord(value);
  if (!record) return null;
  const styleName = typeof record.styleName === "string" ? record.styleName.trim() : "";
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const visualDirectives = readStrings(record.visualDirectives);
  const consistencyRules = readStrings(record.consistencyRules);
  const negativeDirectives = readStrings(record.negativeDirectives);
  const characterPrompt = typeof record.characterPrompt === "string" ? record.characterPrompt.trim() : "";
  const imagePrompt = typeof record.imagePrompt === "string" ? record.imagePrompt.trim() : "";
  const videoPrompt = typeof record.videoPrompt === "string" ? record.videoPrompt.trim() : "";
  if (
    !styleName
    && !summary
    && visualDirectives.length === 0
    && consistencyRules.length === 0
    && negativeDirectives.length === 0
    && !characterPrompt
    && !imagePrompt
    && !videoPrompt
  ) return null;
  const stylePrompt = [
    styleName ? `风格名：${styleName}` : "",
    summary ? `风格摘要：${summary}` : "",
    visualDirectives.length > 0 ? `视觉指令：${visualDirectives.join("；")}` : "",
    consistencyRules.length > 0 ? `一致性规则：${consistencyRules.join("；")}` : "",
    negativeDirectives.length > 0 ? `负面指令：${negativeDirectives.join("；")}` : "",
    characterPrompt ? `角色参考：${characterPrompt}` : "",
    imagePrompt ? `图片参考：${imagePrompt}` : "",
    videoPrompt ? `视频参考：${videoPrompt}` : "",
  ].filter(Boolean).join("\n");
  return {
    styleId: "run-trigger-style-facts",
    styleName: styleName || "本轮用户视觉风格",
    stylePrompt,
    category: "run-trigger-style-facts",
  };
}

/**
 * Resolve the single style-source precedence used by every workflow entry
 * point. Explicit project canvas facts win over a persisted Project Look Bible;
 * a per-run user bundle wins over book metadata; book facts are only a seed
 * when the project has no canvas-level style. This is structural precedence,
 * not a semantic quality decision.
 */
export function resolveProjectStyleAnchorSources(input: {
  canvasStyleReferenceImages: readonly string[];
  canvasStyleLock: CanvasIndexStyleLock | null;
  activeLookBible: ActiveProjectLookBible | null;
  triggerStyleFacts: unknown;
  bookStyleFacts: unknown;
}): {
  styleReferenceImages: readonly string[];
  styleLock: CanvasIndexStyleLock | null;
} {
  const triggerStyleLock = styleLockFromTriggerFacts(input.triggerStyleFacts);
  const bookStyleLock = styleLockFromTriggerFacts(input.bookStyleFacts);
  const hasCanvasStyle = input.canvasStyleLock !== null || input.canvasStyleReferenceImages.length > 0;
  const hasProjectLookBible = input.activeLookBible !== null;
  return {
    styleReferenceImages: hasCanvasStyle
      ? input.canvasStyleReferenceImages
      : hasProjectLookBible || triggerStyleLock
        ? []
        : bookStyleFactsReferenceImages(input.bookStyleFacts),
    styleLock: input.canvasStyleLock
      ?? styleLockFromProjectLookBible(input.activeLookBible)
      ?? triggerStyleLock
      ?? bookStyleLock,
  };
}

function bookStyleFactsReferenceImages(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const raw = (value as Record<string, unknown>).referenceImages;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readHttpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function normalizeStyleReferenceImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map(readHttpUrl).filter((url): url is string => Boolean(url))),
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeStyleLock(styleLock: CanvasIndexStyleLock | null): Record<string, string> | null {
  if (!styleLock) return null;
  return {
    styleId: styleLock.styleId.trim(),
    styleName: styleLock.styleName.trim(),
    stylePrompt: styleLock.stylePrompt.trim(),
    category: styleLock.category?.trim() ?? "",
  };
}

export function buildProjectStyleFingerprint(input: {
  styleReferenceImages: unknown;
  styleLock: CanvasIndexStyleLock | null;
}): string {
  const styleReferenceImages = normalizeStyleReferenceImages(input.styleReferenceImages);
  const canonical = JSON.stringify({
    version: 1,
    styleReferenceImages,
    styleLock: normalizeStyleLock(input.styleLock),
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

export function buildProjectStyleProvenance(input: {
  styleReferenceImages: unknown;
  styleLock: CanvasIndexStyleLock | null;
}): ProjectStyleProvenance {
  const styleReferenceImages = normalizeStyleReferenceImages(input.styleReferenceImages);
  const hasStyleAnchor = styleReferenceImages.length > 0 || input.styleLock !== null;
  const styleFingerprint = hasStyleAnchor
    ? buildProjectStyleFingerprint({
        styleReferenceImages,
        styleLock: input.styleLock,
      })
    : null;
  return {
    styleLockId: input.styleLock?.styleId.trim() || null,
    styleName: input.styleLock?.styleName.trim() ?? "",
    stylePrompt: input.styleLock?.stylePrompt.trim() ?? "",
    styleReferenceImages,
    styleFingerprint,
    styleSource: PROJECT_STYLE_SOURCE,
  };
}

export function readStyleFingerprint(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const fingerprint = (value as Record<string, unknown>).styleFingerprint;
  return typeof fingerprint === "string" && fingerprint.trim() ? fingerprint.trim() : null;
}

export function isCurrentStyleAsset(value: unknown, currentStyleFingerprint: string): boolean {
  return readStyleFingerprint(value) === currentStyleFingerprint;
}

/**
 * A reusable visual reference owns a source style; the paid generation owns a
 * target project style. They are separate facts.
 *
 * Requiring both fingerprints to be identical drops valid identity/topology
 * anchors whenever a project intentionally changes its style reference. The
 * execution layer injects the current project style independently, so a
 * source-style mismatch means "transform this tracked reference", not
 * "reference missing". References without a source fingerprint still fail
 * explicitly because their provenance cannot be audited.
 */
export type AuthoringReferenceStyleTransition = {
  sourceStyleFingerprint: string;
  targetStyleFingerprint: string;
  transformRequired: boolean;
};

export function readAuthoringReferenceStyleTransition(
  value: unknown,
  targetStyleFingerprint: string,
): AuthoringReferenceStyleTransition | null {
  const sourceStyleFingerprint = readStyleFingerprint(value);
  const target = targetStyleFingerprint.trim();
  if (!sourceStyleFingerprint || !target) return null;
  return {
    sourceStyleFingerprint,
    targetStyleFingerprint: target,
    transformRequired: sourceStyleFingerprint !== target,
  };
}
