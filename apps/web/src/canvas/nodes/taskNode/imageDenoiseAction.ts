export type ImageDenoiseMode = 'clean' | 'enhance'

export function buildImageDenoiseAction(mode: ImageDenoiseMode): {
  label: string
  prompt: string
  referenceImageStrategy: 'visible_composite_only'
} {
  const instruction = mode === 'enhance'
    ? '对当前参考图去噪，并适度提升现有细节的清晰度；仅修复可见噪点、压缩伪影与异常涂抹，不凭空增加纹理、细节或锐化光晕。'
    : '对当前参考图做轻度去噪，仅减轻可见噪点与压缩伪影，保留原有细节。'
  return {
    referenceImageStrategy: 'visible_composite_only',
    label: mode === 'enhance' ? '去噪与清晰度增强' : '轻度去噪',
    prompt: `${instruction} 严格保留原图的构图、主体形态、物体位置、色彩、曝光与光影关系，保留原有材质的纹理、粗糙度、反射和艺术笔触、颗粒等表现；不要把原有材质或艺术纹理当作噪点抹平，不改变画风，不重新设计或重绘画面。`,
  }
}
