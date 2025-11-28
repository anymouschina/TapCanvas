export type VideoRealismRule = {
  id: string
  title: string
  summary: string
  promptLine: string
}

export const VIDEO_REALISM_RULES: VideoRealismRule[] = [
  {
    id: 'lighting-logic',
    title: '光影统一逻辑',
    summary: '明确时间/天气/材质链路，让光线方向与色温保持一致并体现在反射与阴影里。',
    promptLine:
      'Lighting: golden-hour sunlight from the left, 4800K warmth, rain-soaked pavement reflections and shadows that obey the same direction.'
  },
  {
    id: 'handheld',
    title: '手持镜头',
    summary: '加入1%以内的手持抖动、呼吸节奏与0.3秒起停惯性，摒弃完美稳定。',
    promptLine:
      'Camera handling: subtle handheld drift around 1%, breathing sway and 0.3s settle whenever the shot starts or stops.'
  },
  {
    id: 'depth-of-field',
    title: '景深与对焦',
    summary: '常用35/50mm镜头，f/2.0–2.8浅景深，并以2秒拉焦完成焦点切换。',
    promptLine:
      'Lens: 35mm prime at f/2.2 with a 2 second focus pull that glides from the subject to the background.'
  },
  {
    id: 'lens-imperfections',
    title: '光学瑕疵',
    summary: '5%–8%暗角、轻微耀斑、色散、胶片颗粒，营造真实镜头缺陷。',
    promptLine:
      'Optics: 6% vignette, faint anamorphic flares, light chromatic aberration and a thin layer of film grain.'
  },
  {
    id: 'micro-motion',
    title: '微动作',
    summary: '角色动作需包含扰动、补偿与恢复链条，并驱动周边道具。',
    promptLine:
      'Micro motion: fingers micro-adjust grip, fabric reacts with 200ms delay, nearby props wobble when touched.'
  },
  {
    id: 'material-details',
    title: '材质细节',
    summary: '描述材质纹理、磨损与反光特征，让光照与表面交互更真实。',
    promptLine:
      'Materials: textured denim, brushed metal rails catching specular highlights, dusty glass that blooms light.'
  },
  {
    id: 'environment-forces',
    title: '环境动力',
    summary: '风向/风速统一，头发→衣物→配件依次受到影响，可见粒子随气流漂浮。',
    promptLine:
      'Environment: steady wind from the right rippling through hair, coat, hanging signage, plus floating dust in light shafts.'
  },
  {
    id: 'camera-intent',
    title: '摄影机意图',
    summary: '模拟摄影师意图，例如眼平推进2秒、停驻、再以前景遮挡收尾。',
    promptLine:
      'Camera intent: eye-level push-in for 2 seconds, hold to observe, then exit through foreground occlusion.'
  },
  {
    id: 'micro-narrative',
    title: '微剧情',
    summary: '设计有目的性的动作链与保留少量瑕疵（motion blur、色偏），让画面更像现场记录。',
    promptLine:
      'Micro narrative: phone buzzes → she checks the message → tram rushes past → she dodges and boards, retaining motion blur and slight color shift.'
  },
  {
    id: 'voice-timbre',
    title: '音色与对白真实性',
    summary: '对白需有具体音色、音量与空间感：音色（女中音/男中音等）、气声比例、口型噪声、收声距离、房间混响时长与整体响度。',
    promptLine:
      'Voice: close-mic dialogue, warm baritone (110–150 Hz fundamental) with 25% breathiness, soft lip/tongue noise, -16 LUFS integrated loudness, gentle room reverb RT60≈0.4s.'
  }
]

export const VIDEO_REALISM_SYSTEM_GUIDE = [
  '当用户创建 composeVideo/视频节点时，必须默认套用“AI 视频真实感十条原则”：',
  ...VIDEO_REALISM_RULES.map(
    rule => `- ${rule.title}：${rule.summary}，并在 prompt 中用英文描述其细节。`
  ),
  '提醒：所有写入节点的 prompt 仍需遵循全英文、10s-15s 视频节奏、描述镜头运动与角色目标。'
].join('\n')

export const VIDEO_REALISM_PROMPT_BLOCK = VIDEO_REALISM_RULES.map(
  rule => `${rule.title} / ${rule.promptLine}`
).join('\n')
