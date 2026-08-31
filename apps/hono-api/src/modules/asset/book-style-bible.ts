export type BookStyleBibleRecord = {
  styleId: string;
  styleName: string;
  styleLocked: boolean;
  mainCharacterCardsConfirmedAt: string | null;
  mainCharacterCardsConfirmedBy: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  visualDirectives: string[];
  negativeDirectives: string[];
  consistencyRules: string[];
  referenceImages: string[];
};

export class BookStyleBibleNotReadyError extends Error {
  readonly code = "BOOK_STYLE_BIBLE_NOT_READY";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = readString(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= 12) break;
  }
  return out;
}

function readPreviousList(previous: Record<string, unknown>, key: string): string[] {
  return normalizeList(previous[key]);
}

export function confirmBookStyleBible(input: {
  previous: unknown;
  request: Record<string, unknown>;
  userId: string;
  nowIso: string;
}): BookStyleBibleRecord {
  const previous = asRecord(input.previous);
  const request = input.request;
  const requestedStyleName = readString(request.styleName);
  const styleName = requestedStyleName || readString(previous.styleName);
  if (!styleName) {
    throw new BookStyleBibleNotReadyError(
      "style bible is not generated yet; run metadata/style derivation first",
    );
  }

  const hasConfirmedFlag = typeof request.confirmed === "boolean";
  const confirmed = request.confirmed !== false;
  const confirmMainCharacterCards = request.confirmMainCharacterCards === true;
  return {
    styleId: readString(previous.styleId) || `style-${Date.now()}`,
    styleName,
    styleLocked: typeof request.styleLocked === "boolean" ? request.styleLocked : true,
    confirmedAt: hasConfirmedFlag
      ? confirmed
        ? input.nowIso
        : null
      : readString(previous.confirmedAt) || null,
    confirmedBy: hasConfirmedFlag
      ? confirmed
        ? input.userId
        : null
      : readString(previous.confirmedBy) || null,
    mainCharacterCardsConfirmedAt: confirmMainCharacterCards
      ? input.nowIso
      : readString(previous.mainCharacterCardsConfirmedAt) || null,
    mainCharacterCardsConfirmedBy: confirmMainCharacterCards
      ? input.userId
      : readString(previous.mainCharacterCardsConfirmedBy) || null,
    visualDirectives: Array.isArray(request.visualDirectives)
      ? normalizeList(request.visualDirectives)
      : readPreviousList(previous, "visualDirectives"),
    negativeDirectives: Array.isArray(request.negativeDirectives)
      ? normalizeList(request.negativeDirectives)
      : readPreviousList(previous, "negativeDirectives"),
    consistencyRules: Array.isArray(request.consistencyRules)
      ? normalizeList(request.consistencyRules)
      : readPreviousList(previous, "consistencyRules"),
    referenceImages: Array.isArray(request.referenceImages)
      ? normalizeList(request.referenceImages)
      : readPreviousList(previous, "referenceImages"),
  };
}
