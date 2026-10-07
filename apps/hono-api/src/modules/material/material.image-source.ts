type ImageSource = { url: string; assetId: string; assetRefId: string; name: string };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function httpUrl(value: unknown): string {
  const url = text(value);
  return /^https?:\/\//i.test(url) ? url : "";
}

export function readImageResultCandidate(value: unknown): ImageSource | null {
  if (typeof value === "string") {
    const url = httpUrl(value);
    return url ? { url, assetId: "", assetRefId: "", name: "" } : null;
  }
  const item = record(value);
  if (!item) return null;
  const url = httpUrl(item.url) || httpUrl(item.imageUrl) || httpUrl(item.sourceUrl);
  return url ? { url, assetId: text(item.assetId), assetRefId: text(item.assetRefId),
    name: text(item.assetName) || text(item.name) || text(item.title) } : null;
}

/** Ordered exactly as execution resolves a single reference; the first is its effective primary image. */
export function* imageSourceCandidates(data: Readonly<Record<string, unknown>>): Generator<ImageSource> {
  for (const field of ["imageUrl", "threeViewImageUrl", "firstFrameUrl", "lastFrameUrl"] as const) {
    const url = httpUrl(data[field]);
    if (url) yield { url, assetId: text(data.assetId) || text(data.serverAssetId), assetRefId: text(data.assetRefId),
      name: text(data.assetName) || text(data.label) || text(data.roleName) };
  }
  for (const key of ["imageResults", "images", "roleCardReferenceImages", "referenceImages"] as const) {
    const values = Array.isArray(data[key]) ? data[key] : [];
    for (const value of values) {
      const candidate = readImageResultCandidate(value);
      if (candidate) yield candidate;
    }
  }
  const cells = Array.isArray(data.storyboardEditorCells) ? data.storyboardEditorCells : [];
  for (const value of cells) {
    const cell = record(value);
    if (!cell) continue;
    const candidate = readImageResultCandidate({ imageUrl: cell.imageUrl, assetId: cell.assetId,
      assetRefId: cell.assetRefId, name: cell.label });
    if (candidate) yield candidate;
  }
}

export function readFirstImageResult(data: Readonly<Record<string, unknown>>): ImageSource | null {
  const first = imageSourceCandidates(data).next();
  return first.done ? null : first.value;
}
