const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".heic",
  ".heif",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);

const HTTP_URL_TOKEN_PATTERN =
  /https?:\/\/[^\s<>"'`)\]}。 ，；：！？（）【】]+/gi;
const TRAILING_URL_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", "。", "，", "；", "：", "！", "？", "）", "】"]);

function splitTrailingPunctuation(value: string): { candidate: string; suffix: string } {
  let end = value.length;
  while (end > 0 && TRAILING_URL_PUNCTUATION.has(value[end - 1] ?? "")) end -= 1;
  return { candidate: value.slice(0, end), suffix: value.slice(end) };
}

export function isHttpImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const pathname = parsed.pathname.toLowerCase();
    const extension = pathname.includes(".")
      ? pathname.slice(pathname.lastIndexOf("."))
      : "";
    if (IMAGE_EXTENSIONS.has(extension)) return true;
    const declaredContentType =
      parsed.searchParams.get("response-content-type") ||
      parsed.searchParams.get("content-type") ||
      parsed.searchParams.get("mimeType") ||
      "";
    return declaredContentType.trim().toLowerCase().startsWith("image/");
  } catch {
    return false;
  }
}

export function redactHttpImageUrls(
  value: string,
  replacement: string | ((url: string) => string) = "[图片引用已隐藏]",
): string {
  return String(value || "").replace(HTTP_URL_TOKEN_PATTERN, (token) => {
    const { candidate, suffix } = splitTrailingPunctuation(token);
    if (!isHttpImageUrl(candidate)) return token;
    const redacted = typeof replacement === "function" ? replacement(candidate) : replacement;
    return `${redacted}${suffix}`;
  });
}

export function containsHttpImageUrlDeep(value: unknown): boolean {
  if (typeof value === "string") {
    let found = false;
    redactHttpImageUrls(value, () => {
      found = true;
      return "";
    });
    return found;
  }
  if (Array.isArray(value)) return value.some(containsHttpImageUrlDeep);
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some(containsHttpImageUrlDeep);
}

export function removeHttpImageUrlsDeep(value: unknown): unknown {
  if (typeof value === "string") {
    if (isHttpImageUrl(value)) return undefined;
    return redactHttpImageUrls(value);
  }
  if (Array.isArray(value)) {
    return value
      .map(removeHttpImageUrlsDeep)
      .filter((item): item is Exclude<typeof item, undefined> => typeof item !== "undefined");
  }
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = removeHttpImageUrlsDeep(item);
    if (typeof sanitized !== "undefined") out[key] = sanitized;
  }
  return out;
}
