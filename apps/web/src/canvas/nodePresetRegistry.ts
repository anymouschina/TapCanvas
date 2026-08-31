/**
 * 前端 preset 数据默认镜像。
 *
 * 注：该 map 与 apps/hono-api/src/modules/ai/tool-schemas.ts 中
 * canvasNodeSpecs[kind].presets[presetId].dataDefaults 保持字面量一致。
 * Phase 2 仅有 3 条预设，复制成本最低；若未来增至 10+ 条再考虑迁 packages/schemas。
 */

type Kind = string
type PresetId = string

type PresetEntry = {
  dataDefaults: Record<string, unknown>
}

const REGISTRY: Record<Kind, Record<PresetId, PresetEntry>> = {
  text: {
    'chapter-info': {
      dataDefaults: {
        locked: true,
        readOnly: true,
        prompt: '',
        chapterTitle: '',
        chapterText: '',
      },
    },
  },
  novelDoc: {
    'role-card': {
      dataDefaults: {
        draftByAgent: true,
        roleName: '',
        roleSlug: '',
        roleSummary: '',
        appearance: '',
        prompt: '',
      },
    },
  },
  image: {
    'role-portrait': {
      dataDefaults: {
        draftByAgent: true,
        roleName: '',
        roleSlug: '',
        prompt: '',
        aspect: '1:1',
      },
    },
  },
}

export function getPresetDataDefaults(
  kind: Kind,
  preset?: PresetId,
): Record<string, unknown> | null {
  if (!preset) return null
  const byKind = REGISTRY[kind]
  if (!byKind) return null
  const entry = byKind[preset]
  if (!entry) return null
  return { ...entry.dataDefaults }
}

export function mergePresetData(
  kind: Kind,
  preset: PresetId | undefined,
  override: Record<string, unknown> = {},
): Record<string, unknown> {
  const defaults = getPresetDataDefaults(kind, preset) ?? {}
  return { ...defaults, ...override }
}
