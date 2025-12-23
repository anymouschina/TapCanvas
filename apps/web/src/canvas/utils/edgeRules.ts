type EdgeRuleMap = Record<string, string[]>

const defaultEdgeRules: EdgeRuleMap = {
  textToImage: ['composeVideo', 'storyboard', 'video', 'image'],
  image: ['composeVideo', 'storyboard', 'video', 'image'],
  video: ['composeVideo', 'storyboard', 'video'],
  composeVideo: ['composeVideo', 'storyboard', 'video'],
  storyboard: ['composeVideo', 'storyboard', 'video'],
  tts: ['composeVideo', 'video'],
  subtitleAlign: ['composeVideo', 'video', 'storyboard'],
  character: ['composeVideo', 'storyboard', 'video', 'character'],
  subflow: ['composeVideo', 'storyboard', 'video', 'image', 'character', 'subflow'],
}

export const buildEdgeValidator =
  (rules: EdgeRuleMap = defaultEdgeRules) =>
  (sourceKind?: string | null, targetKind?: string | null) => {
    if (!sourceKind || !targetKind) return true
    const targets = rules[sourceKind]
    if (!targets) return true
    return targets.includes(targetKind)
  }

export const isImageKind = (kind?: string | null) =>
  kind === 'image' || kind === 'textToImage' || kind === 'mosaic'
