import { createHash } from "node:crypto";
import { imageSourceCandidates } from "../material/material.image-source";

/** Same effective primary image and complete URL set, not visual or character similarity. */
export function imageMediaIdentityKey(data: Readonly<Record<string, unknown>>): string | null {
  const urls = new Set<string>();
  let primaryUrl: string | null = null;
  for (const image of imageSourceCandidates(data)) {
    primaryUrl ??= image.url;
    urls.add(image.url);
  }
  if (!primaryUrl) return null;
  return `image-urls:sha256:${createHash("sha256").update(JSON.stringify({ primaryUrl, urls: [...urls].sort() })).digest("hex")}`;
}
