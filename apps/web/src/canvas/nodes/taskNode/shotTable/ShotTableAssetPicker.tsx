import React from 'react'
import { ActionIcon, Button, Text, TextInput, Tooltip } from '@mantine/core'
import { IconAt, IconRefresh, IconSearch, IconX } from '@tabler/icons-react'
import { listMaterialAssets, type MaterialAssetDto } from '../../../../api/server'
import { ManagedImage } from '../../../../domain/resource-runtime/components/ManagedImage'
import { useUIStore } from '../../../../ui/uiStore'
import './shotTableAssetPicker.css'

export type ShotTableAssetSource = 'canvas' | 'project' | 'personal' | 'team' | 'official'

export type ShotTableAssetReference = {
  id: string
  username: string
  displayName: string
  source: ShotTableAssetSource
  nodeId: string | null
  assetUrl: string | null
  assetId: string | null
  assetRefId: string | null
  assetName: string
}

export type ShotTableAssetPickerProps = {
  className: string
  open: boolean
  nodeId: string
  references: readonly ShotTableAssetReference[]
  query: string
  readOnly: boolean
  onQueryChange: (value: string) => void
  onPick: (reference: ShotTableAssetReference) => void
  onClose: () => void
}

const readText = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const MATERIAL_SCOPES = new Set<MaterialAssetDto['scope']>(['project', 'official', 'personal', 'team'])

const normalizeUsername = (value: string, assetId: string): string => {
  const withoutPrefix = value.trim().startsWith('@') ? value.trim().slice(1) : value.trim()
  const normalized = withoutPrefix.split(/\s+/).filter(Boolean).join('-')
  return normalized || `asset-${assetId}`
}

const readAssetPreviewUrl = (asset: MaterialAssetDto): string => {
  const data = asset.latestVersion?.data
  if (!data) return ''
  for (const key of ['imageUrl', 'coverUrl', 'thumbnailUrl', 'url'] as const) {
    const url = readText(data[key])
    if (url) return requireHttpAssetUrl(url, asset.name)
  }
  for (const key of ['imageResults', 'videoResults'] as const) {
    const results = data[key]
    if (!Array.isArray(results)) continue
    for (const raw of results) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
      const record = raw as Record<string, unknown>
      const url = readText(record.thumbnailUrl) || readText(record.url)
      if (url) return requireHttpAssetUrl(url, asset.name)
    }
  }
  return ''
}

const requireHttpAssetUrl = (value: string, assetName: string): string => {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`素材“${assetName}”的预览 URL 不是绝对地址。`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`素材“${assetName}”的预览 URL 必须使用 http/https。`)
  }
  return parsed.toString()
}

const requireMaterialAsset = (value: unknown, index: number): MaterialAssetDto => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`素材库第 ${index + 1} 项不是对象。`)
  }
  const record = value as Record<string, unknown>
  const id = readText(record.id)
  const name = readText(record.name)
  const scope = record.scope
  if (!id || !name || (scope !== 'project' && scope !== 'official' && scope !== 'personal' && scope !== 'team')) {
    throw new Error(`素材库第 ${index + 1} 项缺少合法 id、name 或 scope。`)
  }
  if (!MATERIAL_SCOPES.has(scope)) throw new Error(`素材“${name}”的 scope 不可用。`)
  const latestVersion = record.latestVersion
  if (latestVersion !== undefined && latestVersion !== null) {
    if (!latestVersion || typeof latestVersion !== 'object' || Array.isArray(latestVersion)) {
      throw new Error(`素材“${name}”的 latestVersion 不是对象。`)
    }
    const versionData = (latestVersion as Record<string, unknown>).data
    if (!versionData || typeof versionData !== 'object' || Array.isArray(versionData)) {
      throw new Error(`素材“${name}”的 latestVersion.data 不是对象。`)
    }
  }
  return value as MaterialAssetDto
}

const materialToReference = (asset: MaterialAssetDto): ShotTableAssetReference => {
  const data = asset.latestVersion?.data
  const assetRefId = readText(data?.assetRefId)
  return {
    id: `material:${asset.scope}:${asset.id}`,
    username: normalizeUsername(assetRefId, asset.id),
    displayName: asset.name,
    source: asset.scope,
    nodeId: null,
    assetUrl: readAssetPreviewUrl(asset) || null,
    assetId: asset.id,
    assetRefId: assetRefId || null,
    assetName: asset.name,
  }
}

const SOURCE_LABEL: Record<ShotTableAssetSource, string> = {
  canvas: '当前画布',
  project: '当前项目',
  personal: '个人素材',
  team: '团队素材',
  official: '官方素材',
}

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message.trim() ? error.message.trim() : '素材库加载失败。'

export function ShotTableAssetPicker({
  className,
  open,
  nodeId,
  references,
  query,
  readOnly,
  onQueryChange,
  onPick,
  onClose,
}: ShotTableAssetPickerProps): JSX.Element | null {
  const [materials, setMaterials] = React.useState<ShotTableAssetReference[]>([])
  const [loadState, setLoadState] = React.useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [error, setError] = React.useState('')

  const loadMaterials = React.useCallback(async (): Promise<void> => {
    setLoadState('loading')
    setError('')
    try {
      const projectId = useUIStore.getState().currentProject?.id?.trim()
      const [projectAssets, externalAssets] = await Promise.all([
        projectId ? listMaterialAssets({ projectId }) : Promise.resolve([]),
        listMaterialAssets(),
      ])
      const assets = [...projectAssets, ...externalAssets]
      if (!Array.isArray(assets)) throw new Error('素材库返回格式错误：预期数组。')
      setMaterials((assets as unknown[]).map((asset, index) => materialToReference(requireMaterialAsset(asset, index))))
      setLoadState('loaded')
    } catch (loadError: unknown) {
      setMaterials([])
      setLoadState('error')
      setError(messageOf(loadError))
    }
  }, [])

  React.useEffect(() => {
    if (open && loadState === 'idle') void loadMaterials()
  }, [loadMaterials, loadState, open])

  const normalizedQuery = query.trim().toLocaleLowerCase()
  const items = React.useMemo(
    () => [...references, ...materials].filter((reference) => {
      if (!normalizedQuery) return true
      return reference.displayName.toLocaleLowerCase().includes(normalizedQuery)
        || reference.username.toLocaleLowerCase().includes(normalizedQuery)
    }),
    [materials, normalizedQuery, references],
  )

  if (!open) return null

  return (
    <section className={`tc-shot-table-assets nodrag nopan nowheel ${className}`} aria-label="分镜表素材选择器">
      <div className="tc-shot-table-assets__header">
        <div className="tc-shot-table-assets__title-group">
          <IconAt className="tc-shot-table-assets__title-icon" size={15} />
          <Text className="tc-shot-table-assets__title" size="xs" fw={650}>插入素材引用</Text>
        </div>
        <div className="tc-shot-table-assets__header-actions">
          <Tooltip className="tc-shot-table-assets__tooltip" label="重新加载素材库">
            <ActionIcon
              className="tc-shot-table-assets__icon-button"
              variant="subtle"
              size="xs"
              loading={loadState === 'loading'}
              onClick={() => { void loadMaterials() }}
              aria-label="重新加载素材库"
            >
              <IconRefresh className="tc-shot-table-assets__icon" size={14} />
            </ActionIcon>
          </Tooltip>
          <Tooltip className="tc-shot-table-assets__tooltip" label="关闭">
            <ActionIcon className="tc-shot-table-assets__icon-button" variant="subtle" size="xs" onClick={onClose} aria-label="关闭素材选择器">
              <IconX className="tc-shot-table-assets__icon" size={14} />
            </ActionIcon>
          </Tooltip>
        </div>
      </div>
      <TextInput
        className="tc-shot-table-assets__search"
        size="xs"
        value={query}
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        leftSection={<IconSearch className="tc-shot-table-assets__search-icon" size={13} />}
        placeholder="搜索画布、项目或素材库"
        aria-label="搜索分镜表素材"
        autoFocus
      />
      {error ? <Text className="tc-shot-table-assets__error" size="xs" c="red">素材库加载失败：{error}</Text> : null}
      {loadState === 'loading' ? <Text className="tc-shot-table-assets__loading" size="xs" c="dimmed">正在加载真实素材库…</Text> : null}
      <div className="tc-shot-table-assets__list" role="listbox" aria-label="可插入素材">
        {items.map((reference) => (
          <button
            className="tc-shot-table-assets__item"
            key={reference.id}
            type="button"
            role="option"
            aria-selected="false"
            disabled={readOnly}
            onClick={() => onPick(reference)}
          >
            <span className="tc-shot-table-assets__preview">
              {reference.assetUrl ? (
                <ManagedImage
                  className="tc-shot-table-assets__image"
                  src={reference.assetUrl}
                  alt=""
                  priority="visible"
                  ownerNodeId={nodeId}
                  ownerSurface="asset-library"
                />
              ) : <span className="tc-shot-table-assets__placeholder">@</span>}
            </span>
            <span className="tc-shot-table-assets__copy">
              <span className="tc-shot-table-assets__name">{reference.displayName}</span>
              <span className="tc-shot-table-assets__meta">@{reference.username} · {SOURCE_LABEL[reference.source]}</span>
            </span>
          </button>
        ))}
        {items.length === 0 && loadState !== 'loading' ? (
          <Text className="tc-shot-table-assets__empty" size="xs" c="dimmed">没有匹配的真实素材</Text>
        ) : null}
      </div>
      {loadState === 'error' ? (
        <Button className="tc-shot-table-assets__retry" size="compact-xs" variant="subtle" onClick={() => { void loadMaterials() }}>
          重试加载
        </Button>
      ) : null}
    </section>
  )
}
