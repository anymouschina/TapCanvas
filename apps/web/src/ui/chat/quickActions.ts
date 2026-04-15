export type ChatQuickActionGroup = 'context' | 'project' | 'starter'

export type ChatQuickActionPreset = {
  key: string
  label: string
  description: string
  prompt: string
  group: ChatQuickActionGroup
  disabled?: boolean
}

type BuildChatInspirationQuickActionsInput = {
  currentProjectId: string | null
  currentProjectName: string | null
  hasFocusedReference: boolean
  selectedNodeLabel: string | null
  selectedNodeKind: string | null
  hasStoryboardContext: boolean
}

type TranslateFn = (input: string) => string

function normalizeComparableString(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function clipSubjectLabel(value: string | null | undefined, maxChars = 18): string | null {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 1) return normalized.slice(0, maxChars)
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function isImageNodeKind(kind: string | null): boolean {
  const normalized = normalizeComparableString(kind)
  return normalized === 'image' || normalized === 'imageedit'
}

function isVideoNodeKind(kind: string | null): boolean {
  const normalized = normalizeComparableString(kind)
  return normalized === 'video' || normalized === 'composevideo'
}

function isTextNodeKind(kind: string | null): boolean {
  const normalized = normalizeComparableString(kind)
  return normalized === 'text' || normalized === 'storyboardscript' || normalized === 'scriptdoc' || normalized === 'noveldoc'
}

export function buildChatInspirationQuickActions(
  input: BuildChatInspirationQuickActionsInput,
  t: TranslateFn,
): ChatQuickActionPreset[] {
  const projectLabel = input.currentProjectName || input.currentProjectId || '当前项目'
  const selectedLabel = clipSubjectLabel(input.selectedNodeLabel)
  const selectedKind = normalizeComparableString(input.selectedNodeKind)
  const actions: ChatQuickActionPreset[] = []

  if (isImageNodeKind(selectedKind)) {
    actions.push({
      key: 'selected-image-optimize-prompt',
      group: 'context',
      label: t('优化当前图片提示词'),
      description: selectedLabel
        ? `围绕「${selectedLabel}」读取节点上下文后直接回写原节点`
        : t('读取当前图片节点上下文后，直接优化并回写原节点'),
      prompt: [
        '请把当前选中的图片节点视为本轮唯一主目标，并直接优化它的提示词。',
        '要求：',
        '1. 先读取当前节点 bundle，确认现有 prompt/systemPrompt/negativePrompt、结果图、参考图、上下游与 diagnostics。',
        '2. 结合当前结果图与本轮上下文，判断如何提高主体、构图、镜头、光线、材质或风格执行度；不要只给建议文本。',
        '3. 若证据足够，直接回写当前节点；覆盖已有 prompt/systemPrompt/negativePrompt 时必须显式传 allowOverwrite=true。',
        '4. 默认保留原 imageModel/aspect/sampleCount，除非我明确要求一起改。',
        '5. 除非确实需要保留旧版或分叉方案，否则不要新建平行图片节点。',
      ].join('\n'),
    })

    actions.push({
      key: input.hasStoryboardContext ? 'selected-shot-continue-scene' : 'selected-image-continue-scene',
      group: 'context',
      label: input.hasStoryboardContext ? t('承接当前镜头继续') : t('围绕当前图片继续创作'),
      description: input.hasStoryboardContext
        ? t('把当前选中帧当作连续性锚点，推进下一步场景')
        : t('围绕当前图片与参考继续推进最小必要下一步'),
      prompt: [
        '请围绕当前选中的图片节点继续推进 TapCanvas 创作。',
        '要求：',
        '1. 先读取当前节点 bundle 与相关上下游，确认它在当前流程中的角色。',
        '2. 如果它已经带有 chapter / shot / continuity 证据，优先把它当作连续性锚点推进下一步；不要另起无关分支。',
        '3. 由 agents 基于本轮证据判断应该续写场景、补足中间节点、修复当前锚点，还是只返回下一步规划；不要套固定 SOP。',
        '4. 若当前 project/flow 作用域充分且动作明确，可以直接写画布；若证据不足，先补证并说明阻塞点。',
      ].join('\n'),
    })
  } else if (isVideoNodeKind(selectedKind)) {
    actions.push({
      key: 'selected-video-diagnose',
      group: 'context',
      label: t('诊断当前视频节点'),
      description: selectedLabel
        ? `围绕「${selectedLabel}」定位卡点并做最小必要修正`
        : t('复盘当前视频节点并修正最关键问题'),
      prompt: [
        '请围绕当前选中的视频节点做一次最小必要的诊断与修正。',
        '要求：',
        '1. 先读取当前节点 bundle；若需要复盘视频结果，再读取对应的视频 review bundle。',
        '2. 判断问题主要在当前 prompt、连续性锚点、对白保留，还是上游素材不足。',
        '3. 若属于当前节点可直接修正的问题，优先直接回写当前节点；不要默认新建另一条视频链。',
        '4. 若证据不足，明确缺少哪个上游节点、关键帧或文本证据；不要编造。',
      ].join('\n'),
    })

    if (input.hasStoryboardContext) {
      actions.push({
        key: 'selected-video-continue-scene',
        group: 'context',
        label: t('承接当前视频继续'),
        description: t('沿用当前连续性锚点，推进下一步场景或镜头'),
        prompt: [
          '请把当前选中的视频节点当作连续性锚点，继续推进 TapCanvas 场景创作。',
          '要求：',
          '1. 先确认当前节点对应的章节、镜头、关键帧或上下游依赖。',
          '2. 基于已验证证据判断下一步应该补关键帧、续写镜头、回修当前节点，还是连接后续视频链。',
          '3. 若当前动作明确且可执行，可以直接写画布；否则返回最小必要计划，并说明缺失证据。',
        ].join('\n'),
      })
    }
  } else if (isTextNodeKind(selectedKind)) {
    actions.push({
      key: 'selected-text-to-workflow',
      group: 'context',
      label: t('把当前文本推进成方案'),
      description: selectedLabel
        ? `把「${selectedLabel}」当作上游证据，推进成最小必要工作流`
        : t('把当前文本节点推进成最小必要工作流'),
      prompt: [
        '请把当前选中的文本/脚本节点作为上游证据，推进成最小必要的 TapCanvas 工作流。',
        '要求：',
        '1. 先读取当前节点和上下游，确认它是文案、剧本、分镜脚本还是章节文本。',
        '2. 由 agents 自主判断这轮更适合推进图片、分镜、视频，还是先补结构节点；不要机械套固定流程。',
        '3. 若当前 project/flow 作用域充分且动作明确，可以直接写画布；否则返回最小必要方案。',
        '4. 若文本证据不足以落到执行，明确指出还缺哪类视觉锚点、章节定位或参考图。',
      ].join('\n'),
    })
  } else if (selectedLabel || selectedKind) {
    actions.push({
      key: 'selected-node-next-step',
      group: 'context',
      label: t('诊断当前节点下一步'),
      description: selectedLabel
        ? `围绕「${selectedLabel}」确认最稳妥的下一步`
        : t('围绕当前选中节点确认最稳妥的下一步'),
      prompt: [
        '请围绕当前选中的节点做一次面向执行的诊断。',
        '要求：',
        '1. 先读取当前节点及其上下游，确认它在工作流中的位置与职责。',
        '2. 说明当前节点最关键的完成度、缺口和下一步动作。',
        '3. 若这是显式、确定性的画布改动且证据充分，可以直接执行；否则只返回最小必要建议，不要臆造。',
      ].join('\n'),
    })
  }

  actions.push(
    {
      key: 'single-video-sop',
      group: 'project',
      label: t('根据上传文本快捷创作单个视频'),
      description: input.hasFocusedReference
        ? t('先结合已上传文本、当前选中节点和参考图自主定位最相关进度，再选择最小必要的视频生产路径')
        : t('先从项目文本与现有画布证据里定位最相关进度，再快速推进 1 条单视频创作'),
      prompt: [
        '请进入“根据上传文本快捷创作单个视频”模式，目标是在 TapCanvas 中完成 1 条短视频。',
        '要求：',
        '1. 先读取当前项目状态、当前选中节点、已上传小说文本、参考图和其它本轮可验证证据；禁止跳过取证直接编排。',
        '2. 由 agents 基于本轮证据自主判断应该承接已有关键帧、修复关键帧、补足连续性锚点，还是直接进入单视频生产；不要把某个固定 SOP 当成默认路线。',
        '3. 若局部证据不足，优先继续补证并选择最稳妥的最小必要 TapCanvas 节点方案；只有在完全无法定位可用正文、场景锚点或画布落点时，才说明缺口。',
        '4. 若涉及章节正文或连续镜头，优先把 continuity checkpoint、上一镜头锚点、必须保留与禁止漂移转成真实约束；如果缺少显式 checkpoint，应继续从项目状态、章节索引、已有关联节点里定位，而不是直接停止。',
        '5. 优先复用现有 agents-cli 能力与 prompt specialists；不要新增本地硬编码决策链。',
      ].join('\n'),
    },
    {
      key: 'project-text-scene-pipeline',
      group: 'project',
      label: t('从当前项目文本启动场景创作'),
      description: input.currentProjectId
        ? `从 ${projectLabel} 的已上传文本里选一个可独立成段的小场景，直接拉起完整创作流程`
        : t('当前未选择项目，无法读取项目文本'),
      prompt: [
        '请直接读取当前项目已上传的文本素材，并仅基于本轮实际读取到的文本内容推进一次项目内场景创作。',
        '要求：',
        '1. 先明确你本轮实际读取到的文本片段/章节范围，以及当前项目里已确认的节点、参考图与连续性锚点。',
        '2. 由 agents 基于已读取证据判断这轮应该新起场景、承接上一镜头、修复连续性，还是只返回下一步规划；不要在前端写死固定流程。',
        '3. 如果适合落到 TapCanvas，就返回最小必要的画布工作流或节点计划；若局部证据仍不足，优先继续补证并给出当前最稳妥的推进方案。',
        '4. 若当前选中节点已经带有 chapter / shot / tail frame 等连续性证据，优先按该证据推进，而不是另起一段新的剧情分支。',
      ].join('\n'),
      disabled: !input.currentProjectId,
    },
    {
      key: 'starter-prompts',
      group: 'starter',
      label: t('推荐一组起步任务'),
      description: t('按图片、分镜、视频、画布编排给出可直接执行的方向'),
      prompt: '请给我 6 个适合 TapCanvas 新用户直接体验的快捷创作方向，覆盖图片生成、图像改写、分镜设计、视频脚本和画布编排，并告诉我每个方向适合什么时候用、第一步该怎么开始。',
    },
  )

  return actions
}
