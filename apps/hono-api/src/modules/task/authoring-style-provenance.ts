import { createHash } from "node:crypto";

import type { CanvasIndexStyleLock } from "../material/material.repo";

export const PROJECT_STYLE_SOURCE = "project_style_reference" as const;

export type ProjectStyleProvenance = {
  styleLockId: string | null;
  styleName: string;
  stylePrompt: string;
  styleReferenceImages: string[];
  styleFingerprint: string;
  styleSource: typeof PROJECT_STYLE_SOURCE;
};

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
  const styleFingerprint = buildProjectStyleFingerprint({
    styleReferenceImages,
    styleLock: input.styleLock,
  });
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
