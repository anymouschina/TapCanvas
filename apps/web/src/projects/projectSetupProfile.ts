import {
  createServerAsset,
  listServerAssets,
  updateServerAssetData,
  type ServerAssetDto,
} from '../api/server'

export const PROJECT_SETUP_PROFILE_KIND = 'projectSetupProfile'
export const PROJECT_SETUP_PROFILE_NAME = '项目设定'
export const PROJECT_VISUAL_MANUAL_KIND = 'visualManualDoc'
export const PROJECT_VISUAL_MANUAL_NAME = '项目视觉手册'
export const PROJECT_DIRECTOR_MANUAL_KIND = 'directorManualDoc'
export const PROJECT_DIRECTOR_MANUAL_NAME = '项目导演手册'

export type ProjectSetupProfile = {
  kind: 'projectSetupProfile'
  version: 1
  projectType: 'nano-comic' | 'storyboard' | 'novel-adaptation' | 'serialized'
  creationMode: 'text-upload'
  intro: string
  artStylePresetId?: string
  artStyleName: string
  styleDirectives: string
  directorManualPresetId?: string
  directorManual: string
  videoRatio: '9:16' | '16:9' | '1:1' | '4:3'
  imageModel: string
  videoModel: string
  imageQuality: 'draft' | 'standard' | 'high'
  createdFrom: 'uploaded-text'
  lastTextUploadName?: string
  lastTextUploadMode?: 'book' | 'asset'
  lastTextUploadAt?: string
}

export const DEFAULT_PROJECT_SETUP_PROFILE: ProjectSetupProfile = {
  kind: PROJECT_SETUP_PROFILE_KIND,
  version: 1,
  projectType: 'nano-comic',
  creationMode: 'text-upload',
  intro: '',
  artStylePresetId: undefined,
  artStyleName: '',
  styleDirectives: '',
  directorManualPresetId: undefined,
  directorManual: '',
  videoRatio: '9:16',
  imageModel: '',
  videoModel: '',
  imageQuality: 'standard',
  createdFrom: 'uploaded-text',
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeProjectType(value: unknown): ProjectSetupProfile['projectType'] {
  return value === 'storyboard' || value === 'novel-adaptation' || value === 'serialized'
    ? value
    : 'nano-comic'
}

function normalizeCreationMode(value: unknown): ProjectSetupProfile['creationMode'] {
  return 'text-upload'
}

function normalizeVideoRatio(value: unknown): ProjectSetupProfile['videoRatio'] {
  return value === '16:9' || value === '1:1' || value === '4:3' ? value : '9:16'
}

function normalizeImageQuality(value: unknown): ProjectSetupProfile['imageQuality'] {
  return value === 'draft' || value === 'high' ? value : 'standard'
}

function normalizeCreatedFrom(value: unknown): ProjectSetupProfile['createdFrom'] {
  return 'uploaded-text'
}

export function normalizeProjectSetupProfile(value: unknown): ProjectSetupProfile {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
  return {
    kind: PROJECT_SETUP_PROFILE_KIND,
    version: 1,
    projectType: normalizeProjectType(record.projectType),
    creationMode: normalizeCreationMode(record.creationMode),
    intro: normalizeString(record.intro),
    artStylePresetId: normalizeString(record.artStylePresetId) || undefined,
    artStyleName: normalizeString(record.artStyleName),
    styleDirectives: normalizeString(record.styleDirectives),
    directorManualPresetId: normalizeString(record.directorManualPresetId) || undefined,
    directorManual: normalizeString(record.directorManual),
    videoRatio: normalizeVideoRatio(record.videoRatio),
    imageModel: normalizeString(record.imageModel),
    videoModel: normalizeString(record.videoModel),
    imageQuality: normalizeImageQuality(record.imageQuality),
    createdFrom: normalizeCreatedFrom(record.createdFrom),
    lastTextUploadName: normalizeString(record.lastTextUploadName) || undefined,
    lastTextUploadMode:
      record.lastTextUploadMode === 'book' || record.lastTextUploadMode === 'asset'
        ? record.lastTextUploadMode
        : undefined,
    lastTextUploadAt: normalizeString(record.lastTextUploadAt) || undefined,
  }
}

function pickLatestAsset(items: readonly ServerAssetDto[]): ServerAssetDto | null {
  return items
    .slice()
    .sort((left, right) => {
      const leftTs = Date.parse(String(left.updatedAt || left.createdAt || ''))
      const rightTs = Date.parse(String(right.updatedAt || right.createdAt || ''))
      return (Number.isFinite(rightTs) ? rightTs : 0) - (Number.isFinite(leftTs) ? leftTs : 0)
    })[0] || null
}

async function getLatestProjectAssetByKind(projectId: string, kind: string): Promise<ServerAssetDto | null> {
  const listed = await listServerAssets({
    projectId,
    kind,
    limit: 20,
  })
  return pickLatestAsset(listed.items || [])
}

function buildVisualManualContent(profile: ProjectSetupProfile): string {
  const lines = [
    `画风名称：${profile.artStyleName.trim() || '未命名画风'}`,
    `项目类型：${profile.projectType}`,
    `画幅比例：${profile.videoRatio}`,
    `图片质量：${profile.imageQuality}`,
    '',
    '视觉规则：',
    profile.styleDirectives.trim() || '当前还没有填写视觉规则。',
  ]
  return lines.join('\n')
}

function buildDirectorManualContent(profile: ProjectSetupProfile): string {
  const lines = [
    `导演手册预设：${profile.directorManualPresetId || '未指定'}`,
    `项目类型：${profile.projectType}`,
    '',
    '导演规则：',
    profile.directorManual.trim() || '当前还没有填写导演规则。',
  ]
  return lines.join('\n')
}

async function syncProjectManualAsset(input: {
  projectId: string
  kind: typeof PROJECT_VISUAL_MANUAL_KIND | typeof PROJECT_DIRECTOR_MANUAL_KIND
  name: string
  content: string
  sourcePresetId?: string
}): Promise<void> {
  const existing = await getLatestProjectAssetByKind(input.projectId, input.kind)
  const payload = {
    kind: input.kind,
    content: input.content,
    source: 'projectSetupProfile',
    sourcePresetId: input.sourcePresetId || null,
  }
  if (existing) {
    await updateServerAssetData(existing.id, payload)
    return
  }
  await createServerAsset({
    name: input.name,
    projectId: input.projectId,
    data: payload,
  })
}

export async function getProjectSetupProfileAsset(projectId: string): Promise<ServerAssetDto | null> {
  const listed = await listServerAssets({
    projectId,
    kind: PROJECT_SETUP_PROFILE_KIND,
    limit: 20,
  })
  return pickLatestAsset(listed.items || [])
}

export async function getProjectSetupProfile(projectId: string): Promise<{
  asset: ServerAssetDto | null
  profile: ProjectSetupProfile
}> {
  const asset = await getProjectSetupProfileAsset(projectId)
  return {
    asset,
    profile: normalizeProjectSetupProfile(asset?.data),
  }
}

export async function upsertProjectSetupProfile(
  projectId: string,
  patch: Partial<ProjectSetupProfile>,
): Promise<{
  asset: ServerAssetDto
  profile: ProjectSetupProfile
}> {
  const existing = await getProjectSetupProfileAsset(projectId)
  const nextProfile = normalizeProjectSetupProfile({
    ...DEFAULT_PROJECT_SETUP_PROFILE,
    ...(existing?.data || {}),
    ...patch,
  })
  const asset = existing
    ? await updateServerAssetData(existing.id, nextProfile)
    : await createServerAsset({
      name: PROJECT_SETUP_PROFILE_NAME,
      projectId,
      data: nextProfile,
    })
  await Promise.all([
    syncProjectManualAsset({
      projectId,
      kind: PROJECT_VISUAL_MANUAL_KIND,
      name: PROJECT_VISUAL_MANUAL_NAME,
      content: buildVisualManualContent(nextProfile),
      sourcePresetId: nextProfile.artStylePresetId,
    }),
    syncProjectManualAsset({
      projectId,
      kind: PROJECT_DIRECTOR_MANUAL_KIND,
      name: PROJECT_DIRECTOR_MANUAL_NAME,
      content: buildDirectorManualContent(nextProfile),
      sourcePresetId: nextProfile.directorManualPresetId,
    }),
  ])
  return {
    asset,
    profile: normalizeProjectSetupProfile(asset.data),
  }
}
