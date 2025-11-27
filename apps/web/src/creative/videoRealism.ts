export type VideoRealismRule = {
  id: string
  title: string
  summary: string
  promptLine: string
}

export const VIDEO_REALISM_RULES: VideoRealismRule[] = [
  {
    id: 'lighting-logic',
    title: 'Lighting logic',
    summary: 'Define time-of-day → weather → material reflections so shadows and color temperature stay consistent.',
    promptLine:
      'Lighting: golden-hour sun from the left, 4800K warmth, rain-soaked pavement reflections, all shadows aligned to the same direction.'
  },
  {
    id: 'handheld',
    title: 'Handheld energy',
    summary: 'Keep 0.8%–1.2% handheld drift, breathing sway, and 0.3s settle inertia; avoid perfect stabilization.',
    promptLine:
      'Camera handling: subtle handheld jitter around 1%, breathing sway, and a 0.3s settle whenever the shot starts or stops.'
  },
  {
    id: 'depth-of-field',
    title: 'Depth of field',
    summary: 'Use 35mm/50mm lenses at f/2.0–2.8 with a 2-second rack focus so focus changes glide instead of snapping.',
    promptLine:
      'Lens: 35mm prime at f/2.2 with a two-second focus pull that slides from the subject to the background.'
  },
  {
    id: 'lens-imperfections',
    title: 'Lens imperfections',
    summary: 'Add 5%–8% vignette, lens flare, mild chromatic aberration, and film grain to avoid sterile renders.',
    promptLine:
      'Optics: 6% vignette, faint anamorphic flares, light chromatic aberration and a thin layer of film grain.'
  },
  {
    id: 'micro-motion',
    title: 'Micro motion',
    summary: 'Every gesture should follow the stable → disturbance → compensation → recovery chain, affecting props as well.',
    promptLine:
      'Micro motion: fingers micro-adjust grip, fabric reacts with a 200ms delay, nearby props wobble when touched.'
  },
  {
    id: 'material-details',
    title: 'Material details',
    summary: 'Describe textures, wear, and reflectivity so lighting interacts like it does IRL.',
    promptLine:
      'Materials: textured denim, brushed metal rails catching specular highlights, dusty glass blooming with light.'
  },
  {
    id: 'environment-forces',
    title: 'Environmental forces',
    summary: 'Keep wind direction/speed unified so hair → clothes → accessories move with delay, add visible particles.',
    promptLine:
      'Environment: steady wind from the right rippling through hair, coat, and hanging signage, plus floating dust in light shafts.'
  },
  {
    id: 'camera-intent',
    title: 'Camera intent',
    summary: 'Plan the operator’s purpose—e.g., eye-level push-in, hold, exit through foreground occlusion.',
    promptLine:
      'Camera intent: eye-level push-in for 2 seconds, hold to observe, then exit through foreground occlusion.'
  },
  {
    id: 'micro-narrative',
    title: 'Micro narrative',
    summary: 'Craft purposeful beats (alert → reaction → obstacle → resolve) and keep slight motion blur/color shifts.',
    promptLine:
      'Micro narrative: phone buzzes → she checks the message → tram rushes past → she dodges and boards, retaining motion blur and slight color shift.'
  }
]

export const VIDEO_REALISM_PROMPT_SNIPPET = VIDEO_REALISM_RULES.map(
  rule => `${rule.title}: ${rule.promptLine}`
).join('\n')

export function buildVideoRealismPrompt(base?: string) {
  const trimmed = (base || '').trim()
  if (!trimmed) return VIDEO_REALISM_PROMPT_SNIPPET
  return `${trimmed}\n\n${VIDEO_REALISM_PROMPT_SNIPPET}`
}
