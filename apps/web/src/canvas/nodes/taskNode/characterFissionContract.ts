export const CHARACTER_FISSION_VARIANT_COUNT = 4

export const CHARACTER_FISSION_DIRECTIONS = [
  {
    value: 'body_proportion',
    label: '头身比例',
    directive: '只改变头身比例、躯干与四肢长度关系；面部骨相和身份识别点保持不变。',
  },
  {
    value: 'age_stage',
    label: '年龄阶段',
    directive: '只改变可见年龄阶段以及由年龄带来的体态和皮肤状态；人物身份、核心服装与标志物保持不变。',
  },
  {
    value: 'body_silhouette',
    label: '体型轮廓',
    directive: '只改变肩胯关系、肌肉与脂肪分布和整体体型轮廓；面部身份、发型与服装设计语言保持不变。',
  },
  {
    value: 'hair_silhouette',
    label: '发型轮廓',
    directive: '只改变发型剪影、长度与束发结构；面部身份、体型、服装和配饰保持不变。',
  },
  {
    value: 'costume_design',
    label: '服装方案',
    directive: '只改变服装版型、层次与穿戴方案；人物面部身份、体型、发型和核心身份物件保持不变。',
  },
  {
    value: 'custom',
    label: '自定义方向',
    directive: '只改变附加提示词明确指定的可见维度；未被明确指定的身份和造型维度全部保持不变。',
  },
] as const

export type CharacterFissionDirection = typeof CHARACTER_FISSION_DIRECTIONS[number]['value']

export type CharacterFissionDraft = Readonly<{
  direction: CharacterFissionDirection
  additionalPrompt: string
}>

type BuildCharacterFissionNodeInput = Readonly<{
  sourceNodeId: string
  sourceData: Readonly<Record<string, unknown>>
  referenceImageUrl: string
  imageModel: string
  draft: CharacterFissionDraft
}>

export type CharacterFissionNodeDraft = Readonly<{
  label: string
  data: Record<string, unknown>
}>

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function copyDefinedFields(
  source: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, unknown> {
  return fields.reduce<Record<string, unknown>>((result, field) => {
    if (source[field] !== undefined && source[field] !== null) result[field] = source[field]
    return result
  }, {})
}

export function getCharacterFissionDirection(
  direction: CharacterFissionDirection,
): typeof CHARACTER_FISSION_DIRECTIONS[number] {
  return CHARACTER_FISSION_DIRECTIONS.find((item) => item.value === direction)
    ?? CHARACTER_FISSION_DIRECTIONS[0]
}

export function buildCharacterFissionPrompt(draft: CharacterFissionDraft): string {
  const direction = getCharacterFissionDirection(draft.direction)
  const additionalPrompt = draft.additionalPrompt.trim()
  return [
    '角色设计裂变：以参考图中的同一角色作为唯一身份锚，生成一个可独立使用的全身角色设计候选。',
    `本轮裂变方向为「${direction.label}」。${direction.directive}`,
    '每次生成只输出一个候选角色，不做拼图、不做多视图、不复制参考图。使用正面自然站姿、中性表情、纯净中性背景和完整全身构图，便于与其他候选横向比较。',
    '严格锁定参考角色的面部身份、核心识别点与未被本轮方向指定的设计维度；不增加第二人物，不显示文字、标签、UI、品牌或水印。',
    additionalPrompt ? `附加要求：${additionalPrompt}` : '',
  ].filter(Boolean).join('\n')
}

export function buildCharacterFissionNodeDraft({
  sourceNodeId,
  sourceData,
  referenceImageUrl,
  imageModel,
  draft,
}: BuildCharacterFissionNodeInput): CharacterFissionNodeDraft {
  const normalizedSourceNodeId = sourceNodeId.trim()
  const normalizedReferenceImageUrl = referenceImageUrl.trim()
  const normalizedImageModel = imageModel.trim()
  const roleName = readTrimmedString(sourceData.roleName) || readTrimmedString(sourceData.characterName)
  if (!normalizedSourceNodeId) throw new Error('角色裂变缺少母版节点 ID')
  if (!normalizedReferenceImageUrl) throw new Error('角色裂变需要母版角色的真实参考图')
  if (!normalizedImageModel) throw new Error('角色裂变尚未选择可用的图片编辑模型')
  if (!roleName) throw new Error('当前角色资产缺少结构化 roleName，无法安全绑定裂变候选')

  const direction = getCharacterFissionDirection(draft.direction)
  const inheritedIdentity = copyDefinedFields(sourceData, [
    'roleId',
    'cardId',
    'identityAnchors',
    'prohibitedDrift',
    'identityBoardSpec',
    'characterProfileVersion',
  ])
  const inheritedGeneration = copyDefinedFields(sourceData, [
    'imageSize',
    'imageResolution',
    'resolution',
    'imageQuality',
  ])

  return {
    label: `${roleName}·角色裂变·${direction.label}`,
    data: {
      kind: 'imageEdit',
      prompt: buildCharacterFissionPrompt(draft),
      aspect: '3:4',
      sampleCount: CHARACTER_FISSION_VARIANT_COUNT,
      imageModel: normalizedImageModel,
      imageModelVendor: null,
      referenceImages: [normalizedReferenceImageUrl],
      referenceImageNodeIds: [normalizedSourceNodeId],
      suppressUpstreamPrompts: true,
      referenceType: 'character',
      roleName,
      characterName: readTrimmedString(sourceData.characterName) || roleName,
      characterAssetRole: 'design_candidate',
      parentCharacterNodeId: normalizedSourceNodeId,
      approvalStatus: 'needs_confirmation',
      productionEligible: false,
      assetUsage: 'character_design_candidate',
      skipCanvasIndexSync: true,
      characterFission: {
        version: 'character-fission/v1',
        direction: direction.value,
        directionLabel: direction.label,
        additionalPrompt: draft.additionalPrompt.trim(),
        variantCount: CHARACTER_FISSION_VARIANT_COUNT,
      },
      ...inheritedIdentity,
      ...inheritedGeneration,
    },
  }
}
