import type { StudioOwnerType } from './appRoutes'

export type StudioRouteScope = {
  projectId: string | null
  ownerType: StudioOwnerType | null
  ownerId: string | null
  flowId: string | null
}

export const EMPTY_STUDIO_ROUTE_SCOPE: StudioRouteScope = {
  projectId: null,
  ownerType: null,
  ownerId: null,
  flowId: null,
}

export type StudioRouteScopeFailureCode =
  | 'invalid_url'
  | 'empty_parameter'
  | 'invalid_owner_type'
  | 'incomplete_owner_scope'
  | 'project_scope_required'
  | 'owner_scope_required_for_flow'
  | 'project_owner_mismatch'

export type StudioRouteScopeResult =
  | { ok: true; scope: StudioRouteScope }
  | { ok: false; code: StudioRouteScopeFailureCode; message: string }

function readRequiredQueryValue(url: URL, key: string): string | null {
  if (!url.searchParams.has(key)) return null
  return String(url.searchParams.get(key) || '').trim()
}

export function parseStudioRouteScope(href: string): StudioRouteScopeResult {
  let url: URL
  try {
    url = new URL(href, 'https://tapcanvas.local')
  } catch {
    return {
      ok: false,
      code: 'invalid_url',
      message: 'Studio 地址无法解析，请从项目列表重新进入。',
    }
  }

  const projectId = readRequiredQueryValue(url, 'projectId')
  const ownerTypeValue = readRequiredQueryValue(url, 'ownerType')
  const ownerId = readRequiredQueryValue(url, 'ownerId')
  const flowId = readRequiredQueryValue(url, 'flowId')

  for (const [key, value] of [
    ['projectId', projectId],
    ['ownerType', ownerTypeValue],
    ['ownerId', ownerId],
    ['flowId', flowId],
  ] as const) {
    if (url.searchParams.has(key) && !value) {
      return {
        ok: false,
        code: 'empty_parameter',
        message: `Studio 地址中的 ${key} 不能为空，请从项目列表重新进入。`,
      }
    }
  }

  const ownerType: StudioOwnerType | null =
    ownerTypeValue === 'project' || ownerTypeValue === 'chapter' || ownerTypeValue === 'shot'
      ? ownerTypeValue
      : null

  if (ownerTypeValue && !ownerType) {
    return {
      ok: false,
      code: 'invalid_owner_type',
      message: 'Studio 地址中的资源类型无效，请从项目列表重新进入。',
    }
  }

  if (Boolean(ownerType) !== Boolean(ownerId)) {
    return {
      ok: false,
      code: 'incomplete_owner_scope',
      message: 'Studio 地址缺少完整的资源归属信息，请从项目列表重新进入。',
    }
  }

  if (!projectId && (ownerType || ownerId || flowId)) {
    return {
      ok: false,
      code: 'project_scope_required',
      message: 'Studio 地址缺少项目标识，请从项目列表重新进入。',
    }
  }

  if (flowId && (!ownerType || !ownerId)) {
    return {
      ok: false,
      code: 'owner_scope_required_for_flow',
      message: 'Studio 地址中的画布缺少资源归属信息，请从项目列表重新进入。',
    }
  }

  if (projectId && ownerType === 'project' && ownerId !== projectId) {
    return {
      ok: false,
      code: 'project_owner_mismatch',
      message: 'Studio 地址中的项目与资源归属不一致，已停止加载以避免串入其他项目。',
    }
  }

  return {
    ok: true,
    scope: {
      projectId,
      ownerType,
      ownerId,
      flowId,
    },
  }
}

type ProjectIdentity = {
  id: string
}

export type StudioProjectSelection<Project extends ProjectIdentity> =
  | { kind: 'unbound' }
  | { kind: 'selected'; project: Project }
  | { kind: 'missing'; projectId: string }

export function selectStudioProject<Project extends ProjectIdentity>(
  projects: readonly Project[],
  projectId: string | null,
): StudioProjectSelection<Project> {
  if (!projectId) return { kind: 'unbound' }
  const project = projects.find((candidate) => candidate.id === projectId)
  return project
    ? { kind: 'selected', project }
    : { kind: 'missing', projectId }
}
