import { create } from 'zustand'

export type UploadRequestId = string

export type UploadStatus = 'intent-created' | 'queued' | 'uploading' | 'hosted' | 'failed' | 'canceled'

export type UploadHandle = {
  id: UploadRequestId
  requestKey: string
  fileName: string
  projectId: string | null
  status: UploadStatus
  ownerNodeIds: string[]
  localPreviewResourceId: string | null
  remoteResourceId: string | null
  localPreviewUrl: string | null
  remoteUrl: string | null
  startedAt: number
  updatedAt: number
  error: string | null
}

type UploadRuntimeDiagnostics = {
  duplicateBlockedCount: number
}

type RegisterUploadIntentInput = {
  id: UploadRequestId
  requestKey?: string
  fileName: string
  projectId?: string | null
  ownerNodeId?: string | null
  localPreviewResourceId?: string | null
  localPreviewUrl?: string | null
  startedAt?: number
}

type UploadRuntimeState = {
  activeNodeImageUploadIds: string[]
  handlesById: Record<UploadRequestId, UploadHandle>
  handleIdsByOwnerNodeId: Record<string, UploadRequestId[]>
  diagnostics: UploadRuntimeDiagnostics
  beginNodeImageUpload: (nodeId: string) => void
  finishNodeImageUpload: (nodeId: string) => void
  registerUploadIntent: (input: RegisterUploadIntentInput) => void
  bindUploadOwner: (handleId: UploadRequestId, ownerNodeId: string) => void
  markUploadStarted: (handleId: UploadRequestId) => void
  commitUploadHosted: (input: {
    handleId: UploadRequestId
    remoteResourceId?: string | null
    remoteUrl?: string | null
  }) => void
  failUpload: (input: {
    handleId: UploadRequestId
    error: string
  }) => void
  finishUpload: (handleId: UploadRequestId) => void
  beginPendingUpload: (input: RegisterUploadIntentInput) => void
  finishPendingUpload: (handleId: UploadRequestId) => void
  recordDuplicateBlocked: (count: number) => void
}

export type PendingUploadItem = UploadHandle

export type UploadRuntimeDiagnosticsSnapshot = UploadRuntimeDiagnostics & {
  activeNodeImageUploadCount: number
  pendingUploadCount: number
  ownerBoundPendingCount: number
  ownerlessPendingCount: number
  ownerBindingErrorCount: number
  multiOwnerPendingCount: number
  oldestPendingAgeMs: number | null
}

function normalizeNonEmptyString(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizeProjectId(value: unknown): string | null {
  const normalized = normalizeNonEmptyString(value)
  return normalized || null
}

function normalizeStartedAt(value: unknown): number {
  const raw = Number(value)
  return Number.isFinite(raw) && raw > 0 ? raw : Date.now()
}

function buildRequestKey(input: RegisterUploadIntentInput): string {
  return normalizeNonEmptyString(input.requestKey) || normalizeNonEmptyString(input.id)
}

function mapHandleIdsByOwner(
  handlesById: Record<UploadRequestId, UploadHandle>,
): Record<string, UploadRequestId[]> {
  const nextMap: Record<string, UploadRequestId[]> = {}
  for (const handle of Object.values(handlesById)) {
    for (const ownerNodeId of handle.ownerNodeIds) {
      if (!nextMap[ownerNodeId]) nextMap[ownerNodeId] = []
      nextMap[ownerNodeId]!.push(handle.id)
    }
  }
  return nextMap
}

function isPendingStatus(status: UploadStatus): boolean {
  return status === 'intent-created' || status === 'queued' || status === 'uploading'
}

function derivePendingUploads(handlesById: Record<UploadRequestId, UploadHandle>): UploadHandle[] {
  return Object.values(handlesById).filter((handle) => isPendingStatus(handle.status))
}

export const useUploadRuntimeStore = create<UploadRuntimeState>((set) => ({
  activeNodeImageUploadIds: [],
  handlesById: {},
  handleIdsByOwnerNodeId: {},
  diagnostics: {
    duplicateBlockedCount: 0,
  },
  beginNodeImageUpload: (nodeId) => set((state) => {
    const normalized = normalizeNonEmptyString(nodeId)
    if (!normalized || state.activeNodeImageUploadIds.includes(normalized)) return state
    return {
      ...state,
      activeNodeImageUploadIds: [...state.activeNodeImageUploadIds, normalized],
    }
  }),
  finishNodeImageUpload: (nodeId) => set((state) => {
    const normalized = normalizeNonEmptyString(nodeId)
    if (!normalized) return state
    return {
      ...state,
      activeNodeImageUploadIds: state.activeNodeImageUploadIds.filter((item) => item !== normalized),
    }
  }),
  registerUploadIntent: (input) => set((state) => {
    const id = normalizeNonEmptyString(input.id)
    if (!id) return state
    const ownerNodeId = normalizeNonEmptyString(input.ownerNodeId)
    const existing = state.handlesById[id]
    const nextHandle: UploadHandle = {
      id,
      requestKey: buildRequestKey(input),
      fileName: normalizeNonEmptyString(input.fileName) || '未命名文件',
      projectId: normalizeProjectId(input.projectId),
      status: existing?.status ?? 'intent-created',
      ownerNodeIds: Array.from(new Set([
        ...(existing?.ownerNodeIds ?? []),
        ...(ownerNodeId ? [ownerNodeId] : []),
      ])),
      localPreviewResourceId: normalizeNonEmptyString(input.localPreviewResourceId) || existing?.localPreviewResourceId || null,
      remoteResourceId: existing?.remoteResourceId ?? null,
      localPreviewUrl: normalizeNonEmptyString(input.localPreviewUrl) || existing?.localPreviewUrl || null,
      remoteUrl: existing?.remoteUrl ?? null,
      startedAt: existing?.startedAt ?? normalizeStartedAt(input.startedAt),
      updatedAt: Date.now(),
      error: existing?.error ?? null,
    }
    const handlesById = {
      ...state.handlesById,
      [id]: nextHandle,
    }
    return {
      ...state,
      handlesById,
      handleIdsByOwnerNodeId: mapHandleIdsByOwner(handlesById),
    }
  }),
  bindUploadOwner: (handleId, ownerNodeId) => set((state) => {
    const normalizedHandleId = normalizeNonEmptyString(handleId)
    const normalizedOwnerNodeId = normalizeNonEmptyString(ownerNodeId)
    if (!normalizedHandleId || !normalizedOwnerNodeId) return state
    const existing = state.handlesById[normalizedHandleId]
    if (!existing) return state
    if (existing.ownerNodeIds.includes(normalizedOwnerNodeId)) return state
    const handlesById = {
      ...state.handlesById,
      [normalizedHandleId]: {
        ...existing,
        ownerNodeIds: [...existing.ownerNodeIds, normalizedOwnerNodeId],
        updatedAt: Date.now(),
      },
    }
    return {
      ...state,
      handlesById,
      handleIdsByOwnerNodeId: mapHandleIdsByOwner(handlesById),
    }
  }),
  markUploadStarted: (handleId) => set((state) => {
    const normalized = normalizeNonEmptyString(handleId)
    if (!normalized) return state
    const existing = state.handlesById[normalized]
    if (!existing) return state
    return {
      ...state,
      handlesById: {
        ...state.handlesById,
        [normalized]: {
          ...existing,
          status: existing.status === 'intent-created' ? 'queued' : 'uploading',
          updatedAt: Date.now(),
        },
      },
    }
  }),
  commitUploadHosted: (input) => set((state) => {
    const normalized = normalizeNonEmptyString(input.handleId)
    if (!normalized) return state
    const existing = state.handlesById[normalized]
    if (!existing) return state
    return {
      ...state,
      handlesById: {
        ...state.handlesById,
        [normalized]: {
          ...existing,
          status: 'hosted',
          remoteResourceId: normalizeNonEmptyString(input.remoteResourceId) || existing.remoteResourceId,
          remoteUrl: normalizeNonEmptyString(input.remoteUrl) || existing.remoteUrl,
          updatedAt: Date.now(),
          error: null,
        },
      },
    }
  }),
  failUpload: (input) => set((state) => {
    const normalized = normalizeNonEmptyString(input.handleId)
    if (!normalized) return state
    const existing = state.handlesById[normalized]
    if (!existing) return state
    return {
      ...state,
      handlesById: {
        ...state.handlesById,
        [normalized]: {
          ...existing,
          status: 'failed',
          updatedAt: Date.now(),
          error: normalizeNonEmptyString(input.error) || 'upload failed',
        },
      },
    }
  }),
  finishUpload: (handleId) => set((state) => {
    const normalized = normalizeNonEmptyString(handleId)
    if (!normalized) return state
    const nextHandles = { ...state.handlesById }
    delete nextHandles[normalized]
    return {
      ...state,
      handlesById: nextHandles,
      handleIdsByOwnerNodeId: mapHandleIdsByOwner(nextHandles),
    }
  }),
  beginPendingUpload: (input) => set((state) => {
    const id = normalizeNonEmptyString(input.id)
    if (!id) return state
    const ownerNodeId = normalizeNonEmptyString(input.ownerNodeId)
    const existing = state.handlesById[id]
    const nextHandle: UploadHandle = {
      id,
      requestKey: buildRequestKey(input),
      fileName: normalizeNonEmptyString(input.fileName) || '未命名文件',
      projectId: normalizeProjectId(input.projectId),
      status: existing?.status ?? 'intent-created',
      ownerNodeIds: Array.from(new Set([
        ...(existing?.ownerNodeIds ?? []),
        ...(ownerNodeId ? [ownerNodeId] : []),
      ])),
      localPreviewResourceId: normalizeNonEmptyString(input.localPreviewResourceId) || existing?.localPreviewResourceId || null,
      remoteResourceId: existing?.remoteResourceId ?? null,
      localPreviewUrl: normalizeNonEmptyString(input.localPreviewUrl) || existing?.localPreviewUrl || null,
      remoteUrl: existing?.remoteUrl ?? null,
      startedAt: existing?.startedAt ?? normalizeStartedAt(input.startedAt),
      updatedAt: Date.now(),
      error: existing?.error ?? null,
    }
    const handlesById = {
      ...state.handlesById,
      [id]: nextHandle,
    }
    return {
      ...state,
      handlesById,
      handleIdsByOwnerNodeId: mapHandleIdsByOwner(handlesById),
    }
  }),
  finishPendingUpload: (handleId) => set((state) => {
    const normalized = normalizeNonEmptyString(handleId)
    if (!normalized) return state
    const nextHandles = { ...state.handlesById }
    delete nextHandles[normalized]
    return {
      ...state,
      handlesById: nextHandles,
      handleIdsByOwnerNodeId: mapHandleIdsByOwner(nextHandles),
    }
  }),
  recordDuplicateBlocked: (count) => set((state) => {
    const numeric = Math.max(0, Math.trunc(Number(count) || 0))
    if (numeric <= 0) return state
    return {
      ...state,
      diagnostics: {
        ...state.diagnostics,
        duplicateBlockedCount: state.diagnostics.duplicateBlockedCount + numeric,
      },
    }
  }),
}))

export function getPendingUploadCount(): number {
  return derivePendingUploads(useUploadRuntimeStore.getState().handlesById).length
}

export function getPendingUploads(): PendingUploadItem[] {
  return derivePendingUploads(useUploadRuntimeStore.getState().handlesById)
}

export function getPendingUploadHandlesByOwnerNodeId(ownerNodeId: string): PendingUploadItem[] {
  const normalizedOwnerNodeId = normalizeNonEmptyString(ownerNodeId)
  if (!normalizedOwnerNodeId) return []
  const state = useUploadRuntimeStore.getState()
  const handleIds = state.handleIdsByOwnerNodeId[normalizedOwnerNodeId] ?? []
  return handleIds
    .map((handleId) => state.handlesById[handleId])
    .filter((handle): handle is UploadHandle => Boolean(handle && isPendingStatus(handle.status)))
}

export function selectUploadRuntimeDiagnosticsSnapshot(
  state: UploadRuntimeState,
  now: number = Date.now(),
): UploadRuntimeDiagnosticsSnapshot {
  const pendingUploads = derivePendingUploads(state.handlesById)
  const ownerBoundPendingCount = pendingUploads.reduce((count, item) => (
    item.ownerNodeIds.length > 0 ? count + 1 : count
  ), 0)
  const oldestPendingStartedAt = pendingUploads.reduce<number | null>((oldest, item) => {
    if (!Number.isFinite(item.startedAt) || item.startedAt <= 0) return oldest
    if (oldest === null) return item.startedAt
    return Math.min(oldest, item.startedAt)
  }, null)
  return {
    ...state.diagnostics,
    activeNodeImageUploadCount: state.activeNodeImageUploadIds.length,
    pendingUploadCount: pendingUploads.length,
    ownerBoundPendingCount,
    ownerlessPendingCount: pendingUploads.length - ownerBoundPendingCount,
    ownerBindingErrorCount: pendingUploads.reduce((count, item) => (
      item.ownerNodeIds.length === 0 ? count + 1 : count
    ), 0),
    multiOwnerPendingCount: pendingUploads.reduce((count, item) => (
      item.ownerNodeIds.length > 1 ? count + 1 : count
    ), 0),
    oldestPendingAgeMs: oldestPendingStartedAt === null ? null : Math.max(0, now - oldestPendingStartedAt),
  }
}
