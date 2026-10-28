export type RenderSubtitle = Readonly<{ startUs: number; endUs: number; text: string }>

/** Preserve timeline order and show every active caption, including overlaps. */
export function resolveSubtitleTextAtTime(captions: readonly RenderSubtitle[], timeUs: number): string {
  return captions
    .filter(caption => caption.startUs <= timeUs && timeUs < caption.endUs)
    .map(caption => caption.text)
    .join('\n')
}
