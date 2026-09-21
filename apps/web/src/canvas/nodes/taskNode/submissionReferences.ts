/** Numbered references belong to the immutable submission, never current edge order. */
export type SubmissionImage = { url: string; label: string }
export type SubmissionInput = { prompt: string; images: SubmissionImage[] }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function readSubmissionInput(value: unknown): SubmissionInput | null {
  if (!record(value) || typeof value.prompt !== 'string') return null
  const manifest = value.referenceMediaManifest
  if (!record(manifest) || !Array.isArray(manifest.images)) return null
  const images: SubmissionImage[] = []
  for (const image of manifest.images) {
    if (!record(image) || typeof image.url !== 'string' || !image.url || typeof image.label !== 'string') return null
    images.push({ url: image.url, label: image.label })
  }
  return { prompt: value.prompt, images }
}

export function buildSubmissionMentionRefs(nodeId: string, value: unknown) {
  const input = readSubmissionInput(value)
  return (input?.images || []).map((image, index) => ({
    nodeId: `submission-reference:${nodeId}:${index}`,
    username: `图${index + 1}`,
    displayName: image.label,
    rawLabel: image.label,
    source: 'asset' as const,
    assetUrl: image.url,
    assetRefId: `图${index + 1}`,
    assetName: image.label,
  }))
}
