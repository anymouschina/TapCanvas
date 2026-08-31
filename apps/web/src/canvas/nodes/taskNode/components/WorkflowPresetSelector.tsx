import React from 'react'
import { IconCheck, IconLoader2 } from '@tabler/icons-react'
import { listServerAssets, type ServerAssetDto } from '../../../../api/server'
import { useUIStore } from '../../../../ui/uiStore'
import { toast } from '../../../../ui/toast'
import { useRFStore } from '../../../store'
import {
  buildWorkflowPresetPatches,
  readWorkflowPresets,
  readWorkflowPresetSwitchContract,
  type WorkflowPresetAsset,
} from '../../../workflowPresetSwitch'
import './WorkflowPresetSelector.css'

type WorkflowPresetSelectorProps = {
  nodeId: string
  data: Record<string, unknown>
  readOnly: boolean
}

function readPositiveNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function readHostedAsset(asset: ServerAssetDto): WorkflowPresetAsset | null {
  const data = asset.data && typeof asset.data === 'object' && !Array.isArray(asset.data)
    ? asset.data as Record<string, unknown>
    : {}
  const url = typeof data.url === 'string' ? data.url.trim() : ''
  if (!/^https?:\/\//i.test(url)) return null
  return {
    id: asset.id,
    url,
    width: readPositiveNumber(data.width),
    height: readPositiveNumber(data.height),
  }
}

async function resolvePresetAssets(input: {
  projectId: string
  assetIds: ReadonlySet<string>
}): Promise<ReadonlyMap<string, WorkflowPresetAsset>> {
  const resolved = new Map<string, WorkflowPresetAsset>()
  let cursor: string | null = null
  do {
    const page = await listServerAssets({
      projectId: input.projectId,
      limit: 200,
      cursor,
      fullData: true,
    })
    for (const asset of page.items) {
      if (!input.assetIds.has(asset.id)) continue
      const hosted = readHostedAsset(asset)
      if (!hosted) throw new Error(`资产 ${asset.id} 没有可执行的真实媒体 URL`)
      resolved.set(asset.id, hosted)
    }
    if (resolved.size === input.assetIds.size) return resolved
    cursor = page.cursor
  } while (cursor)
  const missingIds = [...input.assetIds].filter((assetId) => !resolved.has(assetId))
  throw new Error(`项目资产缺失或不可访问：${missingIds.join(', ')}`)
}

export function WorkflowPresetSelector(props: WorkflowPresetSelectorProps): JSX.Element | null {
  const projectId = useUIStore((state) => String(state.currentProject?.id || '').trim())
  const presets = React.useMemo(() => readWorkflowPresets(props.data), [props.data])
  const activePresetKey = typeof props.data.activePresetKey === 'string'
    ? props.data.activePresetKey.trim()
    : ''
  const [switchingKey, setSwitchingKey] = React.useState<string | null>(null)

  const handleSelect = React.useCallback(async (presetKey: string): Promise<void> => {
    if (props.readOnly || switchingKey || presetKey === activePresetKey) return
    if (!projectId) {
      toast('预设切换失败：当前项目 ID 缺失', 'error')
      return
    }
    setSwitchingKey(presetKey)
    try {
      const state = useRFStore.getState()
      const contract = readWorkflowPresetSwitchContract({ selectorNodeId: props.nodeId, nodes: state.nodes })
      const preset = contract.presets.find((candidate) => candidate.key === presetKey)
      if (!preset) throw new Error(`预设切换失败：找不到预设 ${presetKey}`)
      const assets = await resolvePresetAssets({
        projectId,
        assetIds: new Set([preset.layoutAssetId, preset.styleAssetId]),
      })
      const layout = assets.get(preset.layoutAssetId)
      const style = assets.get(preset.styleAssetId)
      if (!layout || !style) throw new Error('预设切换失败：输入资产解析结果不完整')
      const patches = buildWorkflowPresetPatches({
        contract,
        presetKey,
        assets: { layout, style },
      })
      useRFStore.getState().updateNodesDataAtomically(patches)
      toast(`已切换到 ${preset.name}：主题简报与参考资产已更新，运行后由 Agent 动态生成提示词`, 'success')
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '预设切换失败'
      console.error('[workflow-preset-switch]', { nodeId: props.nodeId, presetKey, message, error })
      toast(message, 'error')
    } finally {
      setSwitchingKey(null)
    }
  }, [activePresetKey, projectId, props.nodeId, props.readOnly, switchingKey])

  if (presets.length === 0) return null
  return (
    <div className="tc-workflow-preset-selector nodrag nopan" role="group" aria-label="工作流预设">
      <div className="tc-workflow-preset-selector__status">
        <span className="tc-workflow-preset-selector__eyebrow">主题入口</span>
        <span className="tc-workflow-preset-selector__hint">主题简报 · 参考资产；提示词由 Agent 动态生成</span>
      </div>
      <div className="tc-workflow-preset-selector__options">
        {presets.map((preset) => {
          const active = preset.key === activePresetKey
          const switching = preset.key === switchingKey
          return (
            <button
              className="tc-workflow-preset-selector__option"
              data-active={active || undefined}
              key={preset.key}
              type="button"
              disabled={props.readOnly || switchingKey !== null}
              aria-pressed={active}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation()
                void handleSelect(preset.key)
              }}
            >
              <span className="tc-workflow-preset-selector__option-label">{preset.name}</span>
              {switching ? (
                <IconLoader2 className="tc-workflow-preset-selector__option-icon tc-workflow-preset-selector__option-icon--loading" size={13} />
              ) : active ? (
                <IconCheck className="tc-workflow-preset-selector__option-icon" size={13} />
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
