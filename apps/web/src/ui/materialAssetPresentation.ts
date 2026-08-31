import type { MaterialAssetDto } from '../api/server'

export type CharacterAssetRole = 'identity_anchor' | 'state_variant' | 'pose' | 'ensemble' | 'voice'

export type MaterialAssetPresentation = {
  imageUrl: string
  kindLabel: string
  characterAssetRole?: CharacterAssetRole
  roleLabel?: string
  approvalLabel?: string
  identityAnchors: string[]
  prohibitedDrift: string[]
}

const KIND_LABELS: Record<MaterialAssetDto['kind'], string> = {
  character: '角色身份',
  scene: '场景',
  prop: '道具',
  style: '风格',
  text: '其他',
  ensemble: '群像关系',
  pose: '姿态 / 表情',
  voice: '声音锚',
}

const ROLE_LABELS: Record<CharacterAssetRole, string> = {
  identity_anchor: '主身份锚',
  state_variant: '状态版本',
  pose: '姿态 / 表情扩展',
  ensemble: '群像关系',
  voice: '声音锚',
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const normalized = readString(item)
    return normalized ? [normalized] : []
  })
}

function readCharacterAssetRole(value: unknown): CharacterAssetRole | undefined {
  return value === 'identity_anchor' || value === 'state_variant' || value === 'pose' || value === 'ensemble' || value === 'voice'
    ? value
    : undefined
}

export function getMaterialAssetPresentation(asset: MaterialAssetDto): MaterialAssetPresentation {
  const data = asset.latestVersion?.data
  const imageUrl = data
    ? readString(data.imageUrl) ?? readString(data.url) ?? readString(data.thumbnailUrl) ?? ''
    : ''
  const characterAssetRole = readCharacterAssetRole(data?.characterAssetRole)
  const approvalStatus = readString(data?.approvalStatus)

  return {
    imageUrl,
    kindLabel: KIND_LABELS[asset.kind],
    characterAssetRole,
    roleLabel: characterAssetRole ? ROLE_LABELS[characterAssetRole] : undefined,
    approvalLabel: approvalStatus === 'approved'
      ? '已确认'
      : approvalStatus === 'needs_confirmation'
        ? '待确认'
        : undefined,
    identityAnchors: readStringArray(data?.identityAnchors),
    prohibitedDrift: readStringArray(data?.prohibitedDrift),
  }
}

export function getMaterialAssetImageUrl(asset: MaterialAssetDto): string {
  return getMaterialAssetPresentation(asset).imageUrl
}
