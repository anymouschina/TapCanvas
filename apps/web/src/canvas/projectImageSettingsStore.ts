import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { CinematicCameraValue } from './nodes/taskNode/cameraControlContract'
import {
  getProjectStyleImages,
  setProjectStyleImages,
  getProjectCinematicCamera,
  setProjectCinematicCamera,
  type ProjectStyleLock,
  type ProjectCinematicCamera,
} from '../api/server'
import type { ChapterCreativeOverride } from '../api/server'
import { chapterOverrideToLockedStyle, hasChapterStyleOverride } from '../projects/chapterCreative'

// 项目级配置：风格基底与摄影机参数。
// 同一项目内所有节点共享，任意节点修改后所有节点立即跟随。
//
// styleImages（全局风格图）真相源已上移到服务端（canvas-index.json，见 api/server getProjectStyleImages）：
// localStorage 仅作离线缓存；进项目时 ensureHydratedStyleImages 从服务端拉取覆盖，setStyleImages 同步 PUT 回服务端。
// 这样 agent（set-style 工具）与前端 picker 写同一处、跨设备持久。

// 全局「锁定风格」（单选）：取代原先散落的 activeStyleBible(多图) + styleImages(多图) 两套表示。
// referenceImageUrl 为单张风格图（自定义文字风格时 null）；stylePrompt 为文字风格指令。
// 持久化时：styleImages = referenceImageUrl ? [url] : []（兼容 agent/出图回退三方），styleLock = 元信息。
export type LockedStyle = {
  styleId: string
  styleName: string
  referenceImageUrl: string | null
  stylePrompt: string
  category?: string
}

export type ProjectImageSettings = {
  styleImages: string[]
  lockedStyle: LockedStyle | null
  imageCinematicCamera: CinematicCameraValue | null
}

type ProjectImageSettingsState = {
  byProjectId: Record<string, ProjectImageSettings>
  // 仅内存：本会话已从服务端 hydrate 过 styleImages/lockedStyle 的项目（不持久化，刷新后重新拉取）。
  _hydratedStyleImages: Record<string, boolean>
  setStyleImages: (projectId: string, styleImages: string[]) => void
  /** 锁定/替换/清除全局风格（单选）。同步持久化到服务端 styleImages + styleLock。 */
  setLockedStyle: (projectId: string, lock: LockedStyle | null) => void
  /** 仅当项目当前无锁定风格时，用 lock 本地播种（不写服务端）。用于书/章 styleBible 作为初始全局风格。 */
  seedLockedStyleIfEmpty: (projectId: string, lock: LockedStyle | null) => void
  /** 进项目时调用：从服务端拉取 styleImages/lockedStyle 覆盖本地缓存（每个项目每会话只拉一次）。 */
  ensureHydratedStyleImages: (projectId: string) => void
  setCinematicCamera: (projectId: string, cam: CinematicCameraValue | null) => void
  reset: (projectId: string) => void
}

/** 从锁定风格派生 uiStore.activeStyleBible（单元素 referenceImages；文字风格无图时空数组）。 */
export function deriveStyleBibleFromLockedStyle(
  lock: LockedStyle | null,
): { styleName: string; referenceImages: string[] } | null {
  if (!lock) return null
  return {
    styleName: lock.styleName || '已锁定风格',
    referenceImages: lock.referenceImageUrl ? [lock.referenceImageUrl] : [],
  }
}

/**
 * Chapter creative settings override only the image style. Camera settings remain
 * project-scoped until a chapter-level camera contract is introduced.
 */
export function getEffectiveProjectImageSettings(
  projectId: string,
  chapterOverride: ChapterCreativeOverride | null,
): ProjectImageSettings {
  return mergeChapterCreativeOverrideIntoProjectImageSettings(
    getProjectImageSettings(projectId),
    chapterOverride,
  )
}

export function mergeChapterCreativeOverrideIntoProjectImageSettings(
  projectSettings: ProjectImageSettings,
  chapterOverride: ChapterCreativeOverride | null,
): ProjectImageSettings {
  if (!hasChapterStyleOverride(chapterOverride)) return projectSettings
  const chapterStyle = chapterOverrideToLockedStyle(chapterOverride)
  return {
    ...projectSettings,
    styleImages: chapterStyle?.referenceImageUrl ? [chapterStyle.referenceImageUrl] : [],
    lockedStyle: chapterStyle,
  }
}

function normalizeLockedStyle(raw: unknown): LockedStyle | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const styleId = typeof obj.styleId === 'string' ? obj.styleId.trim() : ''
  if (!styleId) return null
  const referenceImageUrl =
    typeof obj.referenceImageUrl === 'string' && obj.referenceImageUrl.trim()
      ? obj.referenceImageUrl.trim()
      : null
  return {
    styleId,
    styleName: typeof obj.styleName === 'string' ? obj.styleName : '',
    referenceImageUrl,
    stylePrompt: typeof obj.stylePrompt === 'string' ? obj.stylePrompt : '',
    ...(typeof obj.category === 'string' && obj.category ? { category: obj.category } : {}),
  }
}

/** 服务端 styleLock + styleImages → 本地 lockedStyle（含旧数据兜底：仅 styleImages 时合成 legacy 锁）。 */
function reconstructLockedStyle(
  styleImages: string[],
  styleLock: ProjectStyleLock | null,
): LockedStyle | null {
  const firstImage = styleImages.find((u) => typeof u === 'string' && u.trim()) ?? null
  if (styleLock) {
    return {
      styleId: styleLock.styleId,
      styleName: styleLock.styleName || '已锁定风格',
      referenceImageUrl: firstImage,
      stylePrompt: styleLock.stylePrompt || '',
      ...(styleLock.category ? { category: styleLock.category } : {}),
    }
  }
  if (firstImage) {
    return { styleId: 'legacy', styleName: '已锁定风格', referenceImageUrl: firstImage, stylePrompt: '' }
  }
  return null
}

const EMPTY: ProjectImageSettings = {
  styleImages: [],
  lockedStyle: null,
  imageCinematicCamera: null,
}

function withDefaults(value: Partial<ProjectImageSettings> | undefined): ProjectImageSettings {
  return {
    styleImages: Array.isArray(value?.styleImages) ? value!.styleImages : [],
    lockedStyle: normalizeLockedStyle(value?.lockedStyle),
    imageCinematicCamera: value?.imageCinematicCamera ?? null,
  }
}

export const useProjectImageSettingsStore = create<ProjectImageSettingsState>()(
  persist(
    (set, get) => ({
      byProjectId: {},
      _hydratedStyleImages: {},
      setStyleImages: (projectId, styleImages) => {
        if (!projectId) return
        const next = Array.isArray(styleImages) ? styleImages.filter((u) => typeof u === 'string' && u.trim()) : []
        set((s) => ({
          byProjectId: {
            ...s.byProjectId,
            [projectId]: {
              ...withDefaults(s.byProjectId[projectId]),
              styleImages: next,
            },
          },
        }))
        // 真相源在服务端：本地乐观更新后同步 PUT 回去（失败不回滚，避免误清空；下次 hydrate 自愈）。
        // 不传 styleLock（undefined）= 不动锁定元信息。
        void setProjectStyleImages(projectId, next).catch(() => {})
      },
      setLockedStyle: (projectId, lock) => {
        if (!projectId) return
        const normalized = lock ? normalizeLockedStyle(lock) : null
        const nextStyleImages = normalized?.referenceImageUrl ? [normalized.referenceImageUrl] : []
        set((s) => ({
          byProjectId: {
            ...s.byProjectId,
            [projectId]: {
              ...withDefaults(s.byProjectId[projectId]),
              lockedStyle: normalized,
              styleImages: nextStyleImages,
            },
          },
        }))
        // 持久化：styleImages + styleLock 一并写服务端（null 显式清除）。失败不回滚，下次 hydrate 自愈。
        const styleLock: ProjectStyleLock | null = normalized
          ? {
              styleId: normalized.styleId,
              styleName: normalized.styleName,
              stylePrompt: normalized.stylePrompt,
              ...(normalized.category ? { category: normalized.category } : {}),
            }
          : null
        void setProjectStyleImages(projectId, nextStyleImages, styleLock).catch(() => {})
      },
      seedLockedStyleIfEmpty: (projectId, lock) => {
        if (!projectId) return
        const normalized = lock ? normalizeLockedStyle(lock) : null
        if (!normalized) return
        const current = withDefaults(get().byProjectId[projectId])
        if (current.lockedStyle) return
        set((s) => ({
          byProjectId: {
            ...s.byProjectId,
            [projectId]: {
              ...withDefaults(s.byProjectId[projectId]),
              lockedStyle: normalized,
              styleImages: normalized.referenceImageUrl ? [normalized.referenceImageUrl] : [],
            },
          },
        }))
      },
      ensureHydratedStyleImages: (projectId) => {
        if (!projectId || get()._hydratedStyleImages[projectId]) return
        set((s) => ({ _hydratedStyleImages: { ...s._hydratedStyleImages, [projectId]: true } }))
        // 风格与摄像机都在服务端 canvas-index.json，一次进项目并行拉取覆盖本地缓存。
        void Promise.all([getProjectCinematicCamera(projectId), getProjectStyleImages(projectId)])
          .then(([cinematicCamera, { styleImages, styleLock }]) => {
            const lockedStyle = reconstructLockedStyle(styleImages, styleLock)
            const imageCinematicCamera: CinematicCameraValue | null = cinematicCamera
              ? { ...cinematicCamera }
              : null
            set((s) => ({
              byProjectId: {
                ...s.byProjectId,
                [projectId]: {
                  ...withDefaults(s.byProjectId[projectId]),
                  styleImages,
                  lockedStyle,
                  imageCinematicCamera,
                },
              },
            }))
          })
          .catch(() => {
            // 拉取失败：保留本地缓存、允许下次重试。
            set((s) => {
              const nextHydrated = { ...s._hydratedStyleImages }
              delete nextHydrated[projectId]
              return { _hydratedStyleImages: nextHydrated }
            })
          })
      },
      setCinematicCamera: (projectId, cam) => {
        if (!projectId) return
        const next = cam && cam.enabled ? cam : null
        set((s) => ({
          byProjectId: {
            ...s.byProjectId,
            [projectId]: {
              ...withDefaults(s.byProjectId[projectId]),
              imageCinematicCamera: next,
            },
          },
        }))
        // 真相源在服务端（canvas-index.json cinematicCamera）：本地乐观更新后同步 PUT 回去
        // （失败不回滚，下次 hydrate 自愈）。agent 出图（generate-image-to-canvas）读同一处。
        const payload: ProjectCinematicCamera | null = next
          ? {
              enabled: true,
              cameraKey: next.cameraKey || '',
              lensKey: next.lensKey || '',
              focalKey: next.focalKey || '',
              apertureKey: next.apertureKey || '',
            }
          : null
        void setProjectCinematicCamera(projectId, payload).catch(() => {})
      },
      reset: (projectId) => {
        if (!projectId) return
        set((s) => {
          const next = { ...s.byProjectId }
          delete next[projectId]
          return { byProjectId: next }
        })
      },
    }),
    {
      name: 'tapcanvas-project-image-settings',
      storage: createJSONStorage(() => localStorage),
      // 只持久化数据；_hydratedStyleImages 是内存态，刷新后重新从服务端 hydrate。
      partialize: (state) => ({ byProjectId: state.byProjectId }),
      version: 4,
      migrate: (persisted: unknown, fromVersion) => {
        if (!persisted || typeof persisted !== 'object') return { byProjectId: {} }
        const state = persisted as { byProjectId?: Record<string, unknown> }
        if (!state.byProjectId) return { byProjectId: {} }
        // v4 删除节点提示词预设；旧缓存统一经 withDefaults 硬切换并清理废弃字段。
        if (fromVersion < 4) {
          const out: Record<string, ProjectImageSettings> = {}
          Object.entries(state.byProjectId).forEach(([projectId, raw]) => {
            out[projectId] = withDefaults(raw as Partial<ProjectImageSettings>)
          })
          return { byProjectId: out }
        }
        return state as { byProjectId: Record<string, ProjectImageSettings> }
      },
    },
  ),
)

export function getProjectImageSettings(projectId: string): ProjectImageSettings {
  if (!projectId) return EMPTY
  const raw = useProjectImageSettingsStore.getState().byProjectId[projectId]
  return raw ? withDefaults(raw) : EMPTY
}

export function useProjectImageSettings(projectId: string): ProjectImageSettings {
  return useProjectImageSettingsStore((s) => {
    const raw = projectId ? s.byProjectId[projectId] : null
    return raw ? withDefaults(raw) : EMPTY
  })
}
