import type { ClipProductionSpeechEvent } from './index.mjs';

export type ClipProductionTimelineShot = Readonly<{
  sceneTitle?: string;
  action: string;
  camera: string;
  sound: string;
  storyEventIds: readonly string[];
  speechEventIds: readonly string[];
}>;

export type ClipProductionTimelineDraft = Readonly<{
  scene: string;
  shots: readonly ClipProductionTimelineShot[];
}>;

export const clipProductionTimelineDraftSchema: Readonly<Record<string, unknown>>;

export type ClipTimelineSegment = Readonly<{
  storyEventIds: readonly string[];
  speechEventIds: readonly string[];
}>;

/** Numbered descriptive shot labels, with no clock. */
export function clipTimelineRowLabels(shots: readonly unknown[]): string[];

/** Real speaker, voice category and optional delivery, followed by unmodified text in Chinese quotes. */
export function renderClipSpokenLine(event: Readonly<{ speaker: string; delivery: string; text: string; voice?: 'onscreen' | 'inner' | 'offscreen' | 'narration' }>): string;

export function deriveClipTimelineSegments(input: Readonly<{
  storyEvents: unknown;
  speechEvents: unknown;
  shots?: readonly Readonly<{ storyEventIds: readonly string[]; speechEventIds: readonly string[] }>[];
}>): readonly ClipTimelineSegment[];

/** Ordered authored scene headings and shot prose, preserving full text without inferring scene changes. */
export function compileClipProductionTimeline(input: Readonly<{
  draft: unknown;
  storyEvents?: unknown;
  speechEvents: readonly ClipProductionSpeechEvent[];
}>): string;
