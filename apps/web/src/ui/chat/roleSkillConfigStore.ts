import { create } from 'zustand'
import {
  createServerAsset,
  listServerAssets,
  updateServerAssetData,
  type AgentRoleSkillAssignment,
  type ServerAssetDto,
} from '../../api/server'

export const PROJECT_ROLE_SKILL_CONFIG_KIND = 'projectAgentRoleSkills'
const PROJECT_ROLE_SKILL_CONFIG_VERSION = 1 as const

export type ProjectRoleSkillConfig = {
  kind: typeof PROJECT_ROLE_SKILL_CONFIG_KIND
  version: typeof PROJECT_ROLE_SKILL_CONFIG_VERSION
  assignments: Record<string, AgentRoleSkillAssignment>
}

type RoleSkillConfigState = {
  byProjectId: Record<string, ProjectRoleSkillConfig>
  assetIdByProjectId: Record<string, string>
  loadedProjectIds: Record<string, boolean>
  loadingProjectIds: Record<string, boolean>
  savingProjectIds: Record<string, boolean>
  errorByProjectId: Record<string, string>
  ensureLoaded: (projectId: string) => Promise<void>
  saveConfig: (projectId: string, config: ProjectRoleSkillConfig) => Promise<void>
  saveAssignment: (
    projectId: string,
    roleId: string,
    assignment: AgentRoleSkillAssignment | null,
  ) => Promise<void>
}

const loadRequests = new Map<string, Promise<void>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeAssignment(roleId: string, raw: unknown): AgentRoleSkillAssignment | null {
  if (!isRecord(raw)) return null
  const normalizedRoleId = readString(raw.roleId) || roleId
  const roleName = readString(raw.roleName)
  const source = raw.source === 'system' || raw.source === 'custom' ? raw.source : null
  if (!normalizedRoleId || !roleName || !source) return null

  const skillId = readString(raw.skillId)
  const skillKey = readString(raw.skillKey)
  const skillName = readString(raw.skillName)
  const fileName = readString(raw.fileName)
  const content = typeof raw.content === 'string' ? raw.content : ''
  if (source === 'system' && !skillId && !skillKey) return null
  if (source === 'custom' && !content.trim()) return null

  return {
    roleId: normalizedRoleId,
    roleName,
    source,
    ...(skillId ? { skillId } : {}),
    ...(skillKey ? { skillKey } : {}),
    ...(skillName ? { skillName } : {}),
    ...(source === 'custom' && fileName ? { fileName } : {}),
    ...(source === 'custom' ? { content } : {}),
  }
}

export function createEmptyProjectRoleSkillConfig(): ProjectRoleSkillConfig {
  return {
    kind: PROJECT_ROLE_SKILL_CONFIG_KIND,
    version: PROJECT_ROLE_SKILL_CONFIG_VERSION,
    assignments: {},
  }
}

export function parseProjectRoleSkillConfig(raw: unknown): ProjectRoleSkillConfig {
  if (!isRecord(raw)) return createEmptyProjectRoleSkillConfig()
  const assignments: Record<string, AgentRoleSkillAssignment> = {}
  if (isRecord(raw.assignments)) {
    for (const [roleId, value] of Object.entries(raw.assignments)) {
      const assignment = normalizeAssignment(roleId, value)
      if (assignment) assignments[assignment.roleId] = assignment
    }
  }
  return {
    kind: PROJECT_ROLE_SKILL_CONFIG_KIND,
    version: PROJECT_ROLE_SKILL_CONFIG_VERSION,
    assignments,
  }
}

function readConfigAsset(items: ServerAssetDto[]): { asset: ServerAssetDto | null; config: ProjectRoleSkillConfig } {
  const asset = items.find((item) => {
    const data: unknown = item.data
    return isRecord(data) && data.kind === PROJECT_ROLE_SKILL_CONFIG_KIND
  }) ?? null
  return {
    asset,
    config: parseProjectRoleSkillConfig(asset?.data),
  }
}

export const useProjectRoleSkillConfigStore = create<RoleSkillConfigState>((set, get) => ({
  byProjectId: {},
  assetIdByProjectId: {},
  loadedProjectIds: {},
  loadingProjectIds: {},
  savingProjectIds: {},
  errorByProjectId: {},

  ensureLoaded: async (projectId) => {
    const normalizedProjectId = projectId.trim()
    if (!normalizedProjectId || get().loadedProjectIds[normalizedProjectId]) return
    const existingRequest = loadRequests.get(normalizedProjectId)
    if (existingRequest) return existingRequest

    const request = (async () => {
      set((state) => ({
        loadingProjectIds: { ...state.loadingProjectIds, [normalizedProjectId]: true },
        errorByProjectId: { ...state.errorByProjectId, [normalizedProjectId]: '' },
      }))
      try {
        const response = await listServerAssets({
          projectId: normalizedProjectId,
          kind: PROJECT_ROLE_SKILL_CONFIG_KIND,
          fullData: true,
          limit: 20,
        })
        const { asset, config } = readConfigAsset(response.items)
        set((state) => ({
          byProjectId: { ...state.byProjectId, [normalizedProjectId]: config },
          assetIdByProjectId: asset
            ? { ...state.assetIdByProjectId, [normalizedProjectId]: asset.id }
            : state.assetIdByProjectId,
          loadedProjectIds: { ...state.loadedProjectIds, [normalizedProjectId]: true },
        }))
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        set((state) => ({
          errorByProjectId: { ...state.errorByProjectId, [normalizedProjectId]: message },
        }))
        throw error
      } finally {
        set((state) => {
          const loadingProjectIds = { ...state.loadingProjectIds }
          delete loadingProjectIds[normalizedProjectId]
          return { loadingProjectIds }
        })
        loadRequests.delete(normalizedProjectId)
      }
    })()
    loadRequests.set(normalizedProjectId, request)
    return request
  },

  saveConfig: async (projectId, config) => {
    const normalizedProjectId = projectId.trim()
    if (!normalizedProjectId) throw new Error('保存角色技能配置缺少项目 ID')
    const normalizedConfig = parseProjectRoleSkillConfig(config)
    set((state) => ({
      savingProjectIds: { ...state.savingProjectIds, [normalizedProjectId]: true },
      errorByProjectId: { ...state.errorByProjectId, [normalizedProjectId]: '' },
    }))
    try {
      const currentAssetId = get().assetIdByProjectId[normalizedProjectId]
      const saved = currentAssetId
        ? await updateServerAssetData(currentAssetId, normalizedConfig)
        : await createServerAsset({
            name: '智能团角色技能配置',
            data: normalizedConfig,
            projectId: normalizedProjectId,
          })
      set((state) => ({
        byProjectId: { ...state.byProjectId, [normalizedProjectId]: normalizedConfig },
        assetIdByProjectId: { ...state.assetIdByProjectId, [normalizedProjectId]: saved.id },
        loadedProjectIds: { ...state.loadedProjectIds, [normalizedProjectId]: true },
      }))
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      set((state) => ({
        errorByProjectId: { ...state.errorByProjectId, [normalizedProjectId]: message },
      }))
      throw error
    } finally {
      set((state) => {
        const savingProjectIds = { ...state.savingProjectIds }
        delete savingProjectIds[normalizedProjectId]
        return { savingProjectIds }
      })
    }
  },

  saveAssignment: async (projectId, roleId, assignment) => {
    const normalizedProjectId = projectId.trim()
    const normalizedRoleId = roleId.trim()
    if (!normalizedProjectId || !normalizedRoleId) throw new Error('保存角色技能配置缺少角色或项目 ID')
    await get().ensureLoaded(normalizedProjectId)
    const current = get().byProjectId[normalizedProjectId] ?? createEmptyProjectRoleSkillConfig()
    const assignments = { ...current.assignments }
    if (assignment) assignments[normalizedRoleId] = assignment
    else delete assignments[normalizedRoleId]
    await get().saveConfig(normalizedProjectId, {
      ...current,
      assignments,
    })
  },
}))

export function getProjectRoleSkillAssignments(projectId: string): AgentRoleSkillAssignment[] {
  const config = useProjectRoleSkillConfigStore.getState().byProjectId[projectId.trim()]
  return config ? Object.values(config.assignments) : []
}
