import React from 'react'
import { Paper, Title, SimpleGrid, Card, Image, Text, Button, Group, Stack, Transition, Tabs, Select, ActionIcon, Tooltip, Loader, Center, Modal, TextInput, useMantineColorScheme, Badge } from '@mantine/core'
import { useRFStore } from '../canvas/store'
import { useUIStore } from './uiStore'
import { $ } from '../canvas/i18n'
import { calculateSafeMaxHeight } from './utils/panelPosition'
import { toast } from './toast'
import {
  listServerAssets,
  createServerAsset,
  deleteServerAsset,
  renameServerAsset,
  listModelProviders,
  listModelTokens,
  listSoraDrafts,
  publishSoraDraft,
  deleteSoraDraft,
  markDraftPromptUsed,
  listSoraPublishedVideos,
  listSoraCharacters,
  deleteSoraCharacter,
  checkSoraCharacterUsername,
  updateSoraCharacter,
  uploadSoraCharacterVideo,
  isSoraCameoInProgress,
  finalizeSoraCharacter,
  setSoraCameoPublic,
  uploadSoraProfileAsset,
  listSoraVideoHistory,
  type ServerAssetDto,
  type ModelProviderDto,
  type ModelTokenDto,
  type VideoHistoryRecord,
} from '../api/server'
import { IconPlayerPlay, IconPlus, IconTrash, IconPencil, IconRepeat, IconExternalLink, IconUpload, IconUserPlus } from '@tabler/icons-react'
import { VideoTrimModal } from './VideoTrimModal'

const MAX_CHARACTER_TRIM_SECONDS = 3
const SORA_HISTORY_PAGE_SIZE = 12

function historyStatusColor(status: string | undefined) {
  const normalized = (status || '').toLowerCase()
  if (normalized === 'success' || normalized === 'succeeded') return 'teal'
  if (normalized === 'running' || normalized === 'pending') return 'yellow'
  return 'red'
}

function PlaceholderImage({ label }: { label: string }) {
  const { colorScheme } = useMantineColorScheme()
  const isDark = colorScheme === 'dark'
  const start = isDark ? '#1f2937' : '#cfd8e3'
  const end = isDark ? '#0b0b0d' : '#f8fafc'
  const textColor = isDark ? '#e5e7eb' : '#0f172a'
  const svg = encodeURIComponent(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns='http://www.w3.org/2000/svg' width='480' height='270'><defs><linearGradient id='g' x1='0' x2='1'><stop offset='0%' stop-color='${start}'/><stop offset='100%' stop-color='${end}'/></linearGradient></defs><rect width='100%' height='100%' fill='url(#g)'/><text x='50%' y='50%' fill='${textColor}' dominant-baseline='middle' text-anchor='middle' font-size='16' font-family='system-ui'>${label}</text></svg>`) 
  return <Image src={`data:image/svg+xml;charset=UTF-8,${svg}`} alt={label} radius="sm" />
}

export default function AssetPanel(): JSX.Element | null {
  const active = useUIStore(s => s.activePanel)
  const setActivePanel = useUIStore(s => s.setActivePanel)
  const anchorY = useUIStore(s => s.panelAnchorY)
  const addNodes = useRFStore(s => s.load)
  const addNode = useRFStore(s => s.addNode)
  const openPreview = useUIStore(s => s.openPreview)
  const mounted = active === 'assets'
  const currentProject = useUIStore(s => s.currentProject)
  const characterCreatorRequest = useUIStore(s => s.characterCreatorRequest)
  const clearCharacterCreatorRequest = useUIStore(s => s.clearCharacterCreatorRequest)
  const [assets, setAssets] = React.useState<ServerAssetDto[]>([])
  const [tab, setTab] = React.useState<'local' | 'sora' | 'sora-published' | 'sora-characters' | 'sora-history'>('local')
  const [soraProviders, setSoraProviders] = React.useState<ModelProviderDto[]>([])
  const [soraTokens, setSoraTokens] = React.useState<ModelTokenDto[]>([])
  const [selectedTokenId, setSelectedTokenId] = React.useState<string | null>(null)
  const [drafts, setDrafts] = React.useState<any[]>([])
  const [draftCursor, setDraftCursor] = React.useState<string | null>(null)
  const [draftLoading, setDraftLoading] = React.useState(false)
  const [soraUsingShared, setSoraUsingShared] = React.useState(false)
  const [publishedVideos, setPublishedVideos] = React.useState<any[]>([])
  const [publishedLoading, setPublishedLoading] = React.useState(false)
  const [soraPublishedUsingShared, setSoraPublishedUsingShared] = React.useState(false)
  const [characters, setCharacters] = React.useState<any[]>([])
  const [charCursor, setCharCursor] = React.useState<string | null>(null)
  const [charLoading, setCharLoading] = React.useState(false)
  const [soraCharUsingShared, setSoraCharUsingShared] = React.useState(false)
  const [renameCharOpen, setRenameCharOpen] = React.useState(false)
  const [renameCharTarget, setRenameCharTarget] = React.useState<any | null>(null)
  const [renameCharName, setRenameCharName] = React.useState('')
  const [renameCharError, setRenameCharError] = React.useState<string | null>(null)
  const [renameCharChecking, setRenameCharChecking] = React.useState(false)
  const renameDebounceRef = React.useRef<number | null>(null)
  const [deletingCharId, setDeletingCharId] = React.useState<string | null>(null)
  const createCharInputRef = React.useRef<HTMLInputElement | null>(null)
  const [createCharFile, setCreateCharFile] = React.useState<File | null>(null)
  const [createCharVideoUrl, setCreateCharVideoUrl] = React.useState<string | null>(null)
  const [createCharDuration, setCreateCharDuration] = React.useState(0)
  const [createCharTrimOpen, setCreateCharTrimOpen] = React.useState(false)
  const [createCharUploading, setCreateCharUploading] = React.useState(false)
  const [createCharFinalizeOpen, setCreateCharFinalizeOpen] = React.useState(false)
  const [createCharCameoId, setCreateCharCameoId] = React.useState<string | null>(null)
  const [createCharAssetPointer, setCreateCharAssetPointer] = React.useState<any | null>(null)
  const [createCharUsername, setCreateCharUsername] = React.useState('')
  const [createCharDisplayName, setCreateCharDisplayName] = React.useState('')
  const [createCharUsernameError, setCreateCharUsernameError] = React.useState<string | null>(null)
  const [createCharUsernameChecking, setCreateCharUsernameChecking] = React.useState(false)
  const [createCharSubmitting, setCreateCharSubmitting] = React.useState(false)
  const createCharUsernameDebounceRef = React.useRef<number | null>(null)
  const [createCharCoverPreview, setCreateCharCoverPreview] = React.useState<string | null>(null)
  const [createCharCoverUploading, setCreateCharCoverUploading] = React.useState(false)
  const createCharCoverInputRef = React.useRef<HTMLInputElement | null>(null)
  const [createCharProgress, setCreateCharProgress] = React.useState<number | null>(null)
  const [createCharDefaultRange, setCreateCharDefaultRange] = React.useState<{ start: number; end: number } | null>(null)
  const [pickCharVideoOpen, setPickCharVideoOpen] = React.useState(false)
  const [pickCharTab, setPickCharTab] = React.useState<'local' | 'drafts' | 'published'>('local')
  const [pickCharLoading, setPickCharLoading] = React.useState(false)
  const [pickCharError, setPickCharError] = React.useState<string | null>(null)
  const [pickCharSelected, setPickCharSelected] = React.useState<{ url: string; title: string } | null>(null)
  const [publishingId, setPublishingId] = React.useState<string | null>(null)
  const [soraHistory, setSoraHistory] = React.useState<VideoHistoryRecord[]>([])
  const [soraHistoryLoading, setSoraHistoryLoading] = React.useState(false)
  const [soraHistoryTotal, setSoraHistoryTotal] = React.useState(0)
const [soraHistoryOffset, setSoraHistoryOffset] = React.useState(0)
const [soraHistoryError, setSoraHistoryError] = React.useState<string | null>(null)
const fetchSoraHistory = React.useCallback(
  async (reset: boolean) => {
      setSoraHistoryLoading(true)
      if (reset) {
        setSoraHistoryError(null)
      }
      try {
        const targetOffset = reset ? 0 : soraHistoryOffset
        const data = await listSoraVideoHistory({ limit: SORA_HISTORY_PAGE_SIZE, offset: targetOffset })
        setSoraHistory((prev) => (reset ? data.records : [...prev, ...data.records]))
        setSoraHistoryTotal(typeof data.total === 'number' ? data.total : 0)
        setSoraHistoryOffset(targetOffset + (data.records?.length || 0))
      } catch (err: any) {
        setSoraHistoryError(err?.message || '加载失败')
      } finally {
        setSoraHistoryLoading(false)
      }
  },
  [soraHistoryOffset],
)
const historyHasMore = soraHistory.length < soraHistoryTotal
const handleLoadMoreHistory = React.useCallback(() => {
  if (historyHasMore && !soraHistoryLoading) {
    fetchSoraHistory(false).catch(() => {})
  }
}, [historyHasMore, soraHistoryLoading, fetchSoraHistory])
  const createCharThumbs = React.useMemo(() => {
    if (!createCharVideoUrl || !createCharDuration) return []
    const usedDuration = Math.min(createCharDuration, MAX_CHARACTER_TRIM_SECONDS)
    const count = Math.max(10, Math.round(usedDuration))
    return Array.from({ length: count }, () => createCharVideoUrl)
  }, [createCharVideoUrl, createCharDuration])
  React.useEffect(() => {
    // 资产现在是用户级别的，不依赖项目
    const loader = mounted ? listServerAssets() : Promise.resolve([])
    loader.then(setAssets).catch(() => setAssets([]))
  }, [mounted])

React.useEffect(() => {
  if (!mounted || (tab !== 'sora' && tab !== 'sora-published' && tab !== 'sora-characters')) return
  if (tab === 'sora') setDraftLoading(true)
  if (tab === 'sora-published') setPublishedLoading(true)
  if (tab === 'sora-characters') setCharLoading(true)
  listModelProviders()
      .then((ps) => {
        const soras = ps.filter((p) => p.vendor === 'sora')
        setSoraProviders(soras)
        return soras[0]
      })
      .then(async (sora) => {
        let tokens: ModelTokenDto[] = []
        if (sora) {
          tokens = await listModelTokens(sora.id)
          setSoraTokens(tokens)

          // 当进入 Sora 草稿、发布或角色 Tab 时，如果还没有选择 Token，则默认选第一个
          if (!selectedTokenId && tokens.length > 0) {
            setSelectedTokenId(tokens[0].id)
          }
        } else {
          setSoraTokens([])
          if (selectedTokenId) {
            setSelectedTokenId(null)
          }
        }

        // 根据当前 Tab 加载对应的数据
        const activeTokenId = selectedTokenId || (tokens[0]?.id ?? null)

        if (tab === 'sora') {
          if (activeTokenId) {
            setSoraUsingShared(false)
            try {
              const data = await listSoraDrafts(activeTokenId)
              setDrafts(data.items || [])
              setDraftCursor(data.cursor || null)
            } catch (err: any) {
              console.error(err)
              alert($('当前配置不可用，请稍后再试'))
              setDrafts([])
              setDraftCursor(null)
            }
          } else {
            // 没有用户自己的 Token，尝试使用共享配置
            setSelectedTokenId(null)
            try {
              const data = await listSoraDrafts()
              setDrafts(data.items || [])
              setDraftCursor(data.cursor || null)
              setSoraUsingShared(true)
            } catch (err: any) {
              console.error(err)
              setDrafts([])
              setDraftCursor(null)
              setSoraUsingShared(false)
            }
          }
        } else if (tab === 'sora-published') {
          if (activeTokenId) {
            setSoraPublishedUsingShared(false)
            try {
              const data = await listSoraPublishedVideos(activeTokenId, 8)
              setPublishedVideos(data.items || [])
            } catch (err: any) {
              console.error(err)
              alert($('当前配置不可用，请稍后再试'))
              setPublishedVideos([])
              setSoraPublishedUsingShared(false)
            }
          } else {
            try {
              const data = await listSoraPublishedVideos(undefined, 8)
              setPublishedVideos(data.items || [])
              setSoraPublishedUsingShared(true)
            } catch (err: any) {
              console.error(err)
              setPublishedVideos([])
              setSoraPublishedUsingShared(false)
            }
          }
        } else if (tab === 'sora-characters') {
          if (activeTokenId) {
            setSoraCharUsingShared(false)
            try {
              const data = await listSoraCharacters(activeTokenId)
              setCharacters(data.items || [])
              setCharCursor(data.cursor || null)
            } catch (err: any) {
              console.error(err)
              alert($('当前配置不可用，请稍后再试'))
              setCharacters([])
              setCharCursor(null)
            }
          } else {
            setCharacters([])
            setCharCursor(null)
            setSoraCharUsingShared(false)
          }
        }
      })
      .catch(() => {
        setSoraProviders([])
        setSoraTokens([])
        setDrafts([])
        setPublishedVideos([])
        setCharacters([])
        setSelectedTokenId(null)
        setDraftCursor(null)
        setCharCursor(null)
      })
      .finally(() => {
        if (tab === 'sora') setDraftLoading(false)
        if (tab === 'sora-published') setPublishedLoading(false)
        if (tab === 'sora-characters') setCharLoading(false)
      })
}, [mounted, tab, selectedTokenId])

React.useEffect(() => {
  if (!mounted || tab !== 'sora-history') return
  setSoraHistory([])
  setSoraHistoryOffset(0)
  setSoraHistoryTotal(0)
  fetchSoraHistory(true).catch(() => {})
}, [mounted, tab, fetchSoraHistory])

  const loadMoreDrafts = async () => {
    if (!draftCursor) return
    if (!selectedTokenId && !soraUsingShared) return
    setDraftLoading(true)
    try {
      const data = await listSoraDrafts(selectedTokenId || undefined, draftCursor)
      setDrafts(prev => [...prev, ...(data.items || [])])
      setDraftCursor(data.cursor || null)
    } catch (err: any) {
      console.error(err)
      alert(err?.message || '当前配置不可用，请稍后再试')
    } finally {
      setDraftLoading(false)
    }
  }

  const loadMoreCharacters = async () => {
    if (!selectedTokenId || !charCursor) return
    setCharLoading(true)
    try {
      const data = await listSoraCharacters(selectedTokenId, charCursor)
      setCharacters(prev => [...prev, ...(data.items || [])])
      setCharCursor(data.cursor || null)
    } catch (err: any) {
      console.error(err)
      alert($('当前配置不可用，请稍后再试'))
    } finally {
      setCharLoading(false)
    }
  }

  function getDraftVideoUrl(d: any): string | null {
    if (!d) return null
    const raw = (d as any)?.raw || {}
    const draft = raw.draft || {}
    const encodings = draft.encodings || raw.encodings || {}
    return (
      d.videoUrl ||
      draft.url ||
      encodings.source?.path ||
      encodings['source_wm']?.path ||
      draft.downloadable_url ||
      null
    )
  }

  function getPublishedVideoUrl(p: any): string | null {
    if (!p) return null
    const encodings = (p as any)?.encodings || {}
    return (
      p.videoUrl ||
      encodings.source?.path ||
      encodings['source_wm']?.path ||
      (p as any)?.url ||
      null
    )
  }

  const addDraftToCanvas = (d: any, remix = false) => {
    if (!d) return
    const videoUrl = getDraftVideoUrl(d)
    // Sora remix 目标优先使用 postId（通常为 s_ 前缀），避免误用内部 draft GUID
    const remixTarget = d.postId || d.videoPostId || d.videoDraftId || (d.raw as any)?.generation_id || (d.raw as any)?.id || d.id || null
    const baseData: any = {
      kind: remix ? 'composeVideo' : 'video',
      autoLabel: false,
      source: 'sora',
      videoUrl: videoUrl || undefined,
      thumbnailUrl: d.thumbnailUrl,
      prompt: d.prompt || '',
      videoDraftId: d.id,
      videoPostId: d.postId || null,
      remixTargetId: remix ? remixTarget : undefined,
    }
    addNode('taskNode', d.title || $('Sora 草稿'), baseData)
    if (d.prompt) {
      markDraftPromptUsed(d.prompt, 'sora').catch(() => {})
    }
    setActivePanel(null)
  }

  const handlePickCharacterVideo = () => {
    if (!selectedTokenId) {
      alert('请先选择一个 Sora Token')
      return
    }
    setPickCharError(null)
    setPickCharVideoOpen(true)
    setPickCharTab('local')
    setPickCharSelected(null)
  }

  const ensureDraftsForPick = async () => {
    if (!selectedTokenId || drafts.length > 0 || draftLoading) return
    try {
      setPickCharLoading(true)
      const data = await listSoraDrafts(selectedTokenId)
      setDrafts(data.items || [])
      setDraftCursor(data.cursor || null)
    } catch (err: any) {
      console.error(err)
      setPickCharError(err?.message || '加载草稿失败')
    } finally {
      setPickCharLoading(false)
    }
  }

  const ensurePublishedForPick = async () => {
    if (publishedVideos.length > 0 || publishedLoading) return
    try {
      setPickCharLoading(true)
      const data = await listSoraPublishedVideos(selectedTokenId || undefined, 12)
      setPublishedVideos(data.items || [])
    } catch (err: any) {
      console.error(err)
      setPickCharError(err?.message || '加载已发布视频失败')
    } finally {
      setPickCharLoading(false)
    }
  }

  const getVideoDuration = async (url: string): Promise<number> => new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.crossOrigin = 'anonymous'
    v.onloadedmetadata = () => resolve(v.duration || 0)
    v.onerror = () => reject(new Error('无法读取视频时长'))
    v.src = url
  })

  const prepareCharacterFromUrl = async (url: string | null, title: string, tokenOverride?: string | null): Promise<boolean> => {
    if (!url) {
      setPickCharError('该视频没有可用的播放地址')
      return false
    }
    const effectiveTokenId = tokenOverride ?? selectedTokenId
    if (!effectiveTokenId) {
      setPickCharError('暂无可用的 Sora Token')
      return false
    }
    setPickCharLoading(true)
    setPickCharError(null)
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`拉取视频失败：${response.status}`)
      const blob = await response.blob()
      const safeName = (title || 'sora-video').replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 40) || 'sora-video'
      const file = new File([blob], `${safeName}.mp4`, { type: blob.type || 'video/mp4' })
      if (createCharVideoUrl) {
        URL.revokeObjectURL(createCharVideoUrl)
      }
      const objectUrl = URL.createObjectURL(blob)
      const duration = await getVideoDuration(objectUrl)
      if (!duration || !Number.isFinite(duration)) {
        throw new Error('无法识别视频时长')
      }
      setCreateCharFile(file)
      setCreateCharVideoUrl(objectUrl)
      setCreateCharDuration(duration)
      setPickCharVideoOpen(false)
      setPickCharSelected(null)
      setPickCharTab('local')
      setCreateCharTrimOpen(true)
      return true
    } catch (err: any) {
      console.error(err)
      setPickCharError(err?.message || '无法使用该视频，请稍后再试')
      return false
    } finally {
      setPickCharLoading(false)
    }
  }

React.useEffect(() => {
  if (!characterCreatorRequest || !mounted) return
  let canceled = false
  const handleRequest = async () => {
    const clip = characterCreatorRequest.payload?.clipRange
    if (clip) {
      const rawStart = Number(clip.start)
      const rawEnd = Number(clip.end)
      const start = Number.isFinite(rawStart) && rawStart >= 0 ? rawStart : 0
      const endCandidate = Number.isFinite(rawEnd) ? rawEnd : start + MAX_CHARACTER_TRIM_SECONDS
      const safeEnd = Math.max(start, endCandidate)
      const end = Math.min(start + MAX_CHARACTER_TRIM_SECONDS, safeEnd)
      setCreateCharDefaultRange({ start, end })
    } else {
      setCreateCharDefaultRange(null)
    }
    setTab('sora-characters')
    const requestedTokenId = characterCreatorRequest.payload?.soraTokenId || characterCreatorRequest.payload?.videoTokenId || null
    const fallbackTokenId = selectedTokenId || requestedTokenId || soraTokens[0]?.id || null
    if (!fallbackTokenId) {
      toast('暂无可用的 Sora Token，请先在右上角绑定密钥', 'error')
      setCreateCharDefaultRange(null)
      clearCharacterCreatorRequest()
      return
    }
    if (selectedTokenId !== fallbackTokenId) {
      setSelectedTokenId(fallbackTokenId)
    }
    setPickCharError(null)
    setPickCharTab('local')
    setPickCharSelected(null)

    const autoVideoUrl = characterCreatorRequest.payload?.videoUrl || null
    let shouldOpenPicker = true
    if (autoVideoUrl) {
      const title = characterCreatorRequest.payload?.videoTitle || 'sora-video'
      const success = await prepareCharacterFromUrl(autoVideoUrl, title, fallbackTokenId)
      shouldOpenPicker = !success
      if (!success) {
        toast('自动读取视频失败，请手动选择来源', 'error')
      }
    }

    if (!canceled) {
      setPickCharVideoOpen(shouldOpenPicker)
    }
    clearCharacterCreatorRequest()
  }
  handleRequest().catch((err) => {
    console.error('characterCreatorRequest failed', err)
    clearCharacterCreatorRequest()
  })
  return () => {
    canceled = true
  }
}, [characterCreatorRequest, mounted, selectedTokenId, soraTokens, clearCharacterCreatorRequest, prepareCharacterFromUrl])

  if (!mounted) return null

  const handleCharacterFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.currentTarget.files?.[0]
    if (!file) return
    if (!file.type.startsWith('video/')) {
      alert('请选择视频文件')
      return
    }
    setPickCharVideoOpen(false)
    const url = URL.createObjectURL(file)
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const v = document.createElement('video')
        v.preload = 'metadata'
        v.onloadedmetadata = () => {
          resolve(v.duration || 0)
        }
        v.onerror = () => {
          reject(new Error('无法读取视频时长'))
        }
        v.src = url
      })
      if (!duration || !Number.isFinite(duration)) {
        throw new Error('无法识别视频时长')
      }
      if (duration > 15) {
        alert('仅支持时长不超过 15 秒的视频')
        URL.revokeObjectURL(url)
        return
      }
      setCreateCharFile(file)
      setCreateCharVideoUrl(url)
      setCreateCharDuration(duration || 0)
      setCreateCharTrimOpen(true)
    } catch (err: any) {
      console.error(err)
      alert(err?.message || '无法读取视频时长，请稍后重试')
      URL.revokeObjectURL(url)
      setCreateCharVideoUrl(null)
      setCreateCharDuration(0)
      setCreateCharFile(null)
    }
  }

  const handleTrimClose = () => {
    setCreateCharTrimOpen(false)
    if (createCharVideoUrl) {
      URL.revokeObjectURL(createCharVideoUrl)
    }
    setCreateCharVideoUrl(null)
    setCreateCharDuration(0)
    setCreateCharFile(null)
    setCreateCharDefaultRange(null)
  }

  const handlePickCover = () => {
    if (!selectedTokenId) return
    if (createCharCoverInputRef.current) {
      createCharCoverInputRef.current.value = ''
      createCharCoverInputRef.current.click()
    }
  }

  const handleCoverFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.currentTarget.files?.[0]
    if (!file || !selectedTokenId) return
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件作为封面')
      return
    }
    setCreateCharCoverUploading(true)
    try {
      const res = await uploadSoraProfileAsset(selectedTokenId, file)
      const pointer =
        res?.asset_pointer ??
        res?.azure_asset_pointer ??
        res?.file_id ??
        null
      setCreateCharAssetPointer(pointer)
      if (createCharCoverPreview) {
        URL.revokeObjectURL(createCharCoverPreview)
      }
      const url = URL.createObjectURL(file)
      setCreateCharCoverPreview(url)
    } catch (err: any) {
      console.error(err)
      alert(err?.message || '上传封面失败，请稍后重试')
    } finally {
      setCreateCharCoverUploading(false)
    }
  }

  const handleTrimConfirm = async (range: { start: number; end: number }) => {
    if (!createCharFile || !selectedTokenId) return
    if (createCharUploading) return
    setCreateCharUploading(true)
    setCreateCharProgress(0)
    try {
      const start = Math.max(0, range.start)
      const end = Math.max(start, Math.min(range.end, start + MAX_CHARACTER_TRIM_SECONDS))
      const uploadResult = await uploadSoraCharacterVideo(
        selectedTokenId,
        createCharFile,
        [start, end],
      )

      const taskId: string | undefined =
        (uploadResult && (uploadResult.lastTask?.id || uploadResult.id)) ||
        undefined

      if (taskId) {
        try {
          // 轮询任务进度，直到不再处于 in_progress 或超时
          for (let i = 0; i < 20; i++) {
            const { inProgress, progressPct } = await isSoraCameoInProgress(
              selectedTokenId,
              taskId,
            )
            if (progressPct !== null) {
              setCreateCharProgress(progressPct)
            }
            if (!inProgress) break
            // 约 1.5s 轮询一次
            // eslint-disable-next-line no-await-in-loop
            await new Promise(resolve => setTimeout(resolve, 1500))
          }
        } catch (err) {
          console.warn('轮询 Sora 角色创建进度失败：', err)
        }
      }

      setCreateCharTrimOpen(false)
      if (createCharVideoUrl) {
        URL.revokeObjectURL(createCharVideoUrl)
      }
      setCreateCharVideoUrl(null)
      setCreateCharDuration(0)
      setCreateCharFile(null)
      setCreateCharDefaultRange(null)
      const cameoId =
        (uploadResult && (uploadResult.cameo?.id || uploadResult.id)) || null
      setCreateCharCameoId(cameoId)
      setCreateCharAssetPointer(null)
      setCreateCharUsername('')
      setCreateCharDisplayName('')
      setCreateCharUsernameError(null)
      setCreateCharFinalizeOpen(true)
    } catch (err: any) {
      console.error(err)
      alert(err?.message || '上传角色视频失败，请稍后重试')
    } finally {
      setCreateCharUploading(false)
      setCreateCharProgress(null)
    }
  }

  const applyAssetAt = (assetId: string, pos: { x: number; y: number }) => {
    const rec = assets.find(a => a.id === assetId)
    if (!rec) return

    // translate nodes by shift to current position (align min corner)
    const data: any = rec.data || { nodes: [], edges: [] }

    if (!data.nodes || data.nodes.length === 0) return

    // 数据验证和清理
    const validNodes = data.nodes.filter((n: any) => {
      return n && n.id && n.type && n.position && typeof n.position.x === 'number' && typeof n.position.y === 'number'
    })

    const validEdges = (data.edges || []).filter((e: any) => {
      return e && e.id && e.source && e.target &&
             validNodes.some((n: any) => n.id === e.source) &&
             validNodes.some((n: any) => n.id === e.target)
    })

    if (validNodes.length === 0) return

    const minX = Math.min(...validNodes.map((n: any) => n.position.x))
    const minY = Math.min(...validNodes.map((n: any) => n.position.y))
    const dx = pos.x - minX
    const dy = pos.y - minY

    // 创建节点ID映射，用于更新边的引用
    const idMap: { [oldId: string]: string } = {}

    const nodes = validNodes.map((n: any) => {
      // 确保每次都生成完全唯一的新ID
      const timestamp = Date.now()
      const random = Math.random().toString(36).slice(2, 10)
      const newId = `n${timestamp}_${random}`
      idMap[n.id] = newId

      // 创建完全新的节点对象，避免引用问题
      return {
        // 复制基本属性
        id: newId,
        type: n.type,
        position: { x: n.position.x + dx, y: n.position.y + dy },
        data: {
          // 深度复制原始数据，但清除所有状态
          ...(n.data || {}),
          // 强制清除所有可能的状态数据
          status: undefined,
          taskId: undefined,
          imageResults: undefined,
          videoResults: undefined,
          audioUrl: undefined,
          imageUrl: undefined,
          videoUrl: undefined,
          videoThumbnailUrl: undefined,
          videoTitle: undefined,
          videoDurationSeconds: undefined,
          lastText: undefined,
          textResults: undefined,
          // 确保所有异步状态被清除
          lastError: undefined,
          progress: undefined,
          // 清除可能导致问题的父节点引用
          parentId: undefined,
          // 保留基本的配置数据
          label: n.data?.label,
          prompt: n.data?.prompt,
          kind: n.data?.kind,
          aspect: n.data?.aspect,
          scale: n.data?.scale,
          sampleCount: n.data?.sampleCount,
          geminiModel: n.data?.geminiModel,
          imageModel: n.data?.imageModel,
          videoModel: n.data?.videoModel,
          systemPrompt: n.data?.systemPrompt,
          showSystemPrompt: n.data?.showSystemPrompt,
        },
        selected: false,
        dragging: false,
        hidden: false,
        deletable: true,
        selectable: true,
        dragHandle: undefined,
        zIndex: 1,
        focusable: true,
        connectable: true,
      }
    })

    const edges = validEdges.map((e: any) => {
      const timestamp = Date.now()
      const random = Math.random().toString(36).slice(2, 10)
      const newEdgeId = `e${timestamp}_${random}`

      return {
        // 复制边的属性
        id: newEdgeId,
        source: idMap[e.source] || e.source,
        target: idMap[e.target] || e.target,
        type: e.type || 'default',
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        animated: false,
        selected: false,
        hidden: false,
        data: e.data || {},
        deletable: true,
        selectable: true,
        focusable: true,
        updatable: true,
      }
    })

    // 安全地添加节点和边，避免父节点引用问题
    const currentNodes = useRFStore.getState().nodes
    const currentEdges = useRFStore.getState().edges

    // 验证当前节点状态，确保没有无效的parentNode引用
    const validCurrentNodes = currentNodes.filter((n: any) => {
      // 如果节点有parentNode，确保父节点存在
      if (n.parentNode) {
        return currentNodes.some((parent: any) => parent.id === n.parentNode)
      }
      return true
    })

    // 验证当前边状态
    const validCurrentEdges = currentEdges.filter((e: any) => {
      return currentNodes.some((n: any) => n.id === e.source) &&
             currentNodes.some((n: any) => n.id === e.target)
    })

    // 合并节点和边
    const newNodes = [...validCurrentNodes, ...nodes]
    const newEdges = [...validCurrentEdges, ...edges]

    // 计算新的 nextId
    const maxId = Math.max(
      ...newNodes.map((n: any) => {
        const match = n.id.match(/\d+/)
        return match ? parseInt(match[0], 10) : 0
      })
    )

    // 更新状态
    useRFStore.setState({
      nodes: newNodes,
      edges: newEdges,
      nextId: maxId + 1
    })
  }

  // 计算安全的最大高度
  const maxHeight = calculateSafeMaxHeight(anchorY, 150)

  return (
    <div style={{ position: 'fixed', left: 82, top: (anchorY ? anchorY - 150 : 140), zIndex: 200 }} data-ux-panel>
      <Transition mounted={mounted} transition="pop" duration={140} timingFunction="ease">
        {(styles) => (
          <div style={styles}>
            <Paper
              withBorder
              shadow="md"
              radius="lg"
              className="glass"
              p="md"
              style={{
                width: 640,
                maxHeight: `${maxHeight}px`,
                minHeight: 0,
                transformOrigin: 'left center',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
              data-ux-panel
            >
              <div className="panel-arrow" />
              <input
                ref={createCharCoverInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleCoverFileChange}
              />
              <input
                ref={createCharInputRef}
                type="file"
                accept="video/*"
                style={{ display: 'none' }}
                onChange={handleCharacterFileChange}
              />
              <Group justify="space-between" mb={8} style={{ position: 'sticky', top: 0, zIndex: 1, background: 'transparent' }}>
                <Title order={6}>我的资产</Title>
              </Group>
              <div style={{ flex: 1, overflowY: 'auto', paddingRight: 4, minHeight: 0 }}>
              <Tabs value={tab} onChange={(v) => setTab((v as any) || 'local')}>
                <Tabs.List>
                  <Tabs.Tab value="local">项目资产</Tabs.Tab>
                  <Tabs.Tab value="sora">Sora 草稿</Tabs.Tab>
                  <Tabs.Tab value="sora-published">已发布SORA</Tabs.Tab>
                  <Tabs.Tab value="sora-characters">Sora 角色</Tabs.Tab>
                  <Tabs.Tab value="sora-history">生成记录</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="local" pt="xs">
                  <div>
                    {assets.length === 0 && (<Text size="xs" c="dimmed">暂无资产</Text>)}
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                      {assets.map(a => (
                        <Card key={a.id} withBorder radius="md" shadow="sm">
                          <PlaceholderImage label={a.name} />
                          <Group justify="space-between" mt="sm">
                            <Text size="sm">{a.name}</Text>
                            <Group gap={6}>
                              <Button size="xs" variant="light" onClick={()=>{ const pos = { x: 200, y: (anchorY||200) }; applyAssetAt(a.id, pos); setActivePanel(null) }}>添加</Button>
                              <Button size="xs" variant="subtle" onClick={async ()=>{ const next = prompt('重命名：', a.name)?.trim(); if (!next || next===a.name) return; await renameServerAsset(a.id, next); setAssets(await listServerAssets(currentProject!.id!)) }}>重命名</Button>
                              <Button size="xs" color="red" variant="subtle" onClick={async ()=>{ if (confirm('删除该资产？')) { await deleteServerAsset(a.id); setAssets(await listServerAssets(currentProject!.id!)) } }}>删除</Button>
                            </Group>
                          </Group>
                        </Card>
                      ))}
                    </SimpleGrid>
                  </div>
                </Tabs.Panel>
                <Tabs.Panel value="sora" pt="xs">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Text size="sm">Sora Token 身份</Text>
                      <Select
                        size="xs"
                        placeholder={soraTokens.length === 0 ? '暂无 Sora 密钥' : '选择 Token'}
                        data={soraTokens.map((t) => ({ value: t.id, label: t.label }))}
                        value={selectedTokenId}
                        comboboxProps={{ zIndex: 8005 }}
                        onChange={async (value) => {
                          setSelectedTokenId(value)
                          setSoraUsingShared(false)
                          setSoraPublishedUsingShared(false)
                          setSoraCharUsingShared(false)
                          // 切换身份时先清空当前列表并展示加载态，过渡更自然
                          setDrafts([])
                          setDraftCursor(null)
                          setPublishedVideos([])
                          setCharacters([])
                          setCharCursor(null)

                          if (value) {
                            // 根据当前 Tab 加载对应的数据
                            if (tab === 'sora') {
                              setDraftLoading(true)
                              try {
                                const data = await listSoraDrafts(value)
                                setDrafts(data.items || [])
                                setDraftCursor(data.cursor || null)
                              } catch (err: any) {
                                console.error(err)
                                alert($('当前配置不可用，请稍后再试'))
                                setDrafts([])
                                setDraftCursor(null)
                              } finally {
                                setDraftLoading(false)
                              }
                            } else if (tab === 'sora-published') {
                              setPublishedLoading(true)
                              try {
                                const data = await listSoraPublishedVideos(value, 8)
                                setPublishedVideos(data.items || [])
                              } catch (err: any) {
                                console.error(err)
                                alert($('当前配置不可用，请稍后再试'))
                                setPublishedVideos([])
                              } finally {
                                setPublishedLoading(false)
                              }
                            } else if (tab === 'sora-characters') {
                              setCharLoading(true)
                              try {
                                const data = await listSoraCharacters(value)
                                setCharacters(data.items || [])
                                setCharCursor(data.cursor || null)
                              } catch (err: any) {
                                console.error(err)
                                alert($('当前配置不可用，请稍后再试'))
                                setCharacters([])
                                setCharCursor(null)
                              } finally {
                                setCharLoading(false)
                              }
                            }
                          } else {
                            setPublishedVideos([])
                            setCharacters([])
                            setCharCursor(null)
                            if (tab === 'sora') {
                              setDraftLoading(true)
                              setSoraUsingShared(false)
                              try {
                                const data = await listSoraDrafts()
                                setDrafts(data.items || [])
                                setDraftCursor(data.cursor || null)
                                setSoraUsingShared(true)
                              } catch (err: any) {
                                console.error(err)
                                setDrafts([])
                                setDraftCursor(null)
                                setSoraUsingShared(false)
                              } finally {
                                setDraftLoading(false)
                              }
                            } else {
                              setDrafts([])
                              setDraftCursor(null)
                            }
                          }
                        }}
                      />
                    </Group>
                    {soraUsingShared && (
                      <Text size="xs" c="dimmed">
                        正在使用共享的 Sora 配置
                      </Text>
                    )}
                    <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                      {draftLoading && drafts.length === 0 && (
                        <Center py="sm">
                          <Group gap="xs">
                            <Loader size="xs" />
                            <Text size="xs" c="dimmed">
                              正在加载 Sora 草稿…
                            </Text>
                          </Group>
                        </Center>
                      )}
                      {!draftLoading && drafts.length === 0 && (
                        <Text size="xs" c="dimmed">暂无草稿或未选择 Token</Text>
                      )}
                      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
                        {drafts.map((d, idx) => (
                          <Paper key={d.id ?? idx} withBorder radius="md" p="xs">
                            {d.thumbnailUrl && (
                              <Image
                                src={d.thumbnailUrl}
                                alt={d.title || d.id || `草稿 ${idx + 1}`}
                                radius="sm"
                                mb={4}
                                height={100}
                                fit="cover"
                              />
                            )}
                            <Text size="xs" fw={500} lineClamp={1}>
                              {d.title || `草稿 ${idx + 1}`}
                            </Text>
                            <div style={{ minHeight: 34, marginTop: 2 }}>
                              {d.prompt && (
                                <Text size="xs" c="dimmed" lineClamp={2}>
                                  {d.prompt}
                                </Text>
                              )}
                            </div>
                            <Group justify="flex-end" gap={4} mt={4} wrap="nowrap">
                              <Tooltip label="预览草稿" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  onClick={() => {
                                    if (!d.videoUrl) return
                                    openPreview({ url: d.videoUrl, kind: 'video', name: d.title || d.id || `草稿 ${idx + 1}` })
                                  }}
                                >
                                  <IconPlayerPlay size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="用此视频创建角色" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="light"
                                  disabled={!selectedTokenId || pickCharLoading}
                                  onClick={() => {
                                    const url = getDraftVideoUrl(d)
                                    if (!url) {
                                      alert('未找到可用的视频链接')
                                      return
                                    }
                                    setPickCharError(null)
                                    prepareCharacterFromUrl(url, d.title || d.id || 'draft')
                                  }}
                                >
                                  <IconUserPlus size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="发布为公开视频" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="default"
                                  loading={publishingId === d.id}
                                  disabled={!selectedTokenId || publishingId === d.id}
                                  onClick={async () => {
                                    const ids = getDraftTaskId(d)
                                    const taskId = ids.generationId || ids.taskId
                                    if (!selectedTokenId || !taskId) return
                                    setPublishingId(d.id)
                                    try {
                                      const postText =
                                        d.prompt ||
                                        (d.raw as any)?.prompt ||
                                        (d.raw as any)?.creation_config?.prompt ||
                                        ''
                                      await publishSoraDraft(selectedTokenId, taskId, postText || undefined, ids.generationId || undefined)
                                      setDrafts(prev => prev.filter(x => x.id !== d.id))
                                      alert('已提交发布，请在「已发布SORA」查看')
                                    } catch (err: any) {
                                      console.error(err)
                                      alert(err?.message || '发布失败，请稍后再试')
                                    } finally {
                                      setPublishingId(null)
                                    }
                                  }}
                                >
                                  <IconUpload size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="Remix 到视频节点" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="outline"
                                  onClick={() => addDraftToCanvas(d, true)}
                                >
                                  <IconRepeat size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="删除草稿" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  color="red"
                                  onClick={async () => {
                                    if (!selectedTokenId || !d.id) return
                                    if (!confirm('确定删除该草稿吗？此操作不可恢复')) return
                                    try {
                                      await deleteSoraDraft(selectedTokenId, d.id)
                                      setDrafts(prev => prev.filter(x => x.id !== d.id))
                                    } catch (err: any) {
                                      console.error(err)
                                      alert($('当前配置不可用，请稍后再试'))
                                    }
                                  }}
                                >
                                  <IconTrash size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          </Paper>
                        ))}
                      </SimpleGrid>
                      {draftCursor && (
                        <Group justify="center" mt="sm">
                          <Button size="xs" variant="light" loading={draftLoading} onClick={loadMoreDrafts}>
                            加载更多
                          </Button>
                        </Group>
                      )}
                    </div>
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="sora-published" pt="xs">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Text size="sm">Sora Token 身份</Text>
                      <Select
                        size="xs"
                        placeholder={soraTokens.length === 0 ? '暂无 Sora 密钥' : '选择 Token'}
                        data={soraTokens.map((t) => ({ value: t.id, label: t.label }))}
                        value={selectedTokenId}
                        comboboxProps={{ zIndex: 8005 }}
                        onChange={async (value) => {
                          setSelectedTokenId(value)
                          setSoraPublishedUsingShared(false)
                          setPublishedVideos([])
                          if (value) {
                            setPublishedLoading(true)
                            try {
                              const data = await listSoraPublishedVideos(value, 8)
                              setPublishedVideos(data.items || [])
                            } catch (err: any) {
                              console.error(err)
                              alert($('当前配置不可用，请稍后再试'))
                              setPublishedVideos([])
                            } finally {
                              setPublishedLoading(false)
                            }
                          } else {
                            setPublishedLoading(true)
                            try {
                              const data = await listSoraPublishedVideos(undefined, 8)
                              setPublishedVideos(data.items || [])
                              setSoraPublishedUsingShared(true)
                            } catch (err: any) {
                              console.error(err)
                              setPublishedVideos([])
                              setSoraPublishedUsingShared(false)
                            } finally {
                              setPublishedLoading(false)
                            }
                          }
                        }}
                      />
                    </Group>
                    {soraPublishedUsingShared && (
                      <Text size="xs" c="dimmed">
                        正在使用共享的 Sora 配置
                      </Text>
                    )}
                    <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                      {publishedLoading && publishedVideos.length === 0 && (
                        <Center py="sm">
                          <Group gap="xs">
                            <Loader size="xs" />
                            <Text size="xs" c="dimmed">
                              正在加载已发布视频…
                            </Text>
                          </Group>
                        </Center>
                      )}
                      {!publishedLoading && publishedVideos.length === 0 && (
                        <Text size="xs" c="dimmed">暂无已发布视频或未选择 Token</Text>
                      )}
                      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
                        {publishedVideos.map((video, idx) => (
                          <Paper key={video.id ?? idx} withBorder radius="md" p="xs">
                            {video.thumbnailUrl && (
                              <Image
                                src={video.thumbnailUrl}
                                alt={video.title || `发布视频 ${idx + 1}`}
                                radius="sm"
                                mb={4}
                                height={100}
                                fit="cover"
                              />
                            )}
                            <Text size="xs" fw={500} lineClamp={1}>
                              {video.title || `发布视频 ${idx + 1}`}
                            </Text>
                            <div style={{ minHeight: 34, marginTop: 2 }}>
                              {video.prompt && (
                                <Text size="xs" c="dimmed" lineClamp={2}>
                                  {video.prompt}
                                </Text>
                              )}
                            </div>
                            <Group gap="xs" mt={4}>
                              {video.likeCount !== undefined && (
                                <Text size="xs" c="dimmed">
                                  👍 {video.likeCount}
                                </Text>
                              )}
                              {video.viewCount !== undefined && (
                                <Text size="xs" c="dimmed">
                                  👁️ {video.viewCount}
                                </Text>
                              )}
                              {video.remixCount !== undefined && (
                                <Text size="xs" c="dimmed">
                                  🔄 {video.remixCount}
                                </Text>
                              )}
                            </Group>
                            <Group justify="flex-end" gap={4} mt={4} wrap="nowrap">
                              {video.permalink && (
                                <Tooltip label="在Sora中查看" withArrow>
                                  <ActionIcon
                                    size="sm"
                                    variant="subtle"
                                    onClick={() => {
                                      window.open(video.permalink, '_blank')
                                    }}
                                  >
                                    <IconExternalLink size={16} />
                                  </ActionIcon>
                                </Tooltip>
                              )}
                              <Tooltip label="预览视频" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="subtle"
                                  onClick={() => {
                                    if (!video.videoUrl) return
                                    openPreview({ url: video.videoUrl, kind: 'video', name: video.title || `发布视频 ${idx + 1}` })
                                  }}
                                >
                                  <IconPlayerPlay size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="用此视频创建角色" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="light"
                                  disabled={!selectedTokenId || pickCharLoading}
                                  onClick={() => {
                                    const url = getPublishedVideoUrl(video)
                                    if (!url) {
                                      alert('未找到可用的视频链接')
                                      return
                                    }
                                    setPickCharError(null)
                                    prepareCharacterFromUrl(url, video.title || video.id || 'published')
                                  }}
                                >
                                  <IconUserPlus size={16} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip label="Remix 到视频节点" withArrow>
                                <ActionIcon
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    addNode('taskNode', video.title || '已发布视频', {
                                      kind: 'composeVideo',
                                      autoLabel: false,
                                      source: 'sora',
                                      prompt: video.prompt || '',
                                      thumbnailUrl: video.thumbnailUrl,
                                      videoUrl: video.videoUrl,
                                      videoPostId: (video as any)?.postId || (video as any)?.id || null,
                                      remixTargetId: (video as any)?.postId || (video as any)?.id || null,
                                    })
                                    setActivePanel(null)
                                  }}
                                >
                                  <IconRepeat size={16} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          </Paper>
                        ))}
                      </SimpleGrid>
                    </div>
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="sora-characters" pt="xs">
                  <Stack gap="sm">
                    <Group justify="space-between">
                      <Group gap="xs">
                        <Text size="sm">Sora Token 身份</Text>
                        <Select
                          size="xs"
                          placeholder={soraTokens.length === 0 ? '暂无 Sora 密钥' : '选择 Token'}
                          data={soraTokens.map((t) => ({ value: t.id, label: t.label }))}
                          value={selectedTokenId}
                          comboboxProps={{ zIndex: 8005 }}
                          onChange={async (value) => {
                            setSelectedTokenId(value)
                            setSoraCharUsingShared(false)
                            setCharacters([])
                            setCharCursor(null)
                            if (value) {
                              setCharLoading(true)
                              try {
                                const data = await listSoraCharacters(value)
                                setCharacters(data.items || [])
                                setCharCursor(data.cursor || null)
                              } catch (err: any) {
                                console.error(err)
                                alert($('当前配置不可用，请稍后再试'))
                                setCharacters([])
                                setCharCursor(null)
                              } finally {
                                setCharLoading(false)
                              }
                            } else {
                              setCharacters([])
                              setCharCursor(null)
                            }
                          }}
                        />
                      </Group>
                      <Button
                        size="xs"
                        variant="light"
                        disabled={!selectedTokenId}
                        onClick={handlePickCharacterVideo}
                      >
                        创建角色
                      </Button>
                    </Group>
                    {createCharUploading && (
                      <Group gap="xs">
                        <Loader size="xs" />
                        <Text size="xs" c="dimmed">
                          正在创建 Sora 角色
                          {typeof createCharProgress === 'number'
                            ? `（${Math.round(createCharProgress * 100)}%）`
                            : '，请稍候…'}
                        </Text>
                      </Group>
                    )}
                    {soraCharUsingShared && (
                      <Text size="xs" c="dimmed">
                        正在使用共享的 Sora 配置
                      </Text>
                    )}
                    <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
                      {charLoading && characters.length === 0 && (
                        <Center py="sm">
                          <Group gap="xs">
                            <Loader size="xs" />
                            <Text size="xs" c="dimmed">
                              正在加载 Sora 角色…
                            </Text>
                          </Group>
                        </Center>
                      )}
                      {!charLoading && characters.length === 0 && (
                        <Text size="xs" c="dimmed">暂无角色或未选择 Token</Text>
                      )}
                      <SimpleGrid cols={{ base: 2, sm: 3, md: 4 }} spacing="xs">
                        {characters.map((c, idx) => {
                          const avatar =
                            c.profile_picture_url ||
                            c.owner_profile?.profile_picture_url ||
                            null
                          const name =
                            c.username ||
                            c.owner_profile?.username ||
                            c.display_name ||
                            c.owner_profile?.display_name ||
                            `角色 ${idx + 1}`
                          const desc =
                            c.description ||
                            c.owner_profile?.description ||
                            null
                          const charId = c.user_id as string | undefined
                          return (
                            <Paper key={charId ?? name ?? idx} withBorder radius="md" p="xs">
                              {avatar && (
                                <Image
                                  src={avatar}
                                  alt={name}
                                  radius="sm"
                                  mb={4}
                                  height={100}
                                  fit="cover"
                                />
                              )}
                              <Text size="xs" fw={500} lineClamp={1}>
                                {name}
                              </Text>
                              <div style={{ minHeight: 34, marginTop: 2 }}>
                                {desc && (
                                  <Text size="xs" c="dimmed" lineClamp={2}>
                                    {desc}
                                  </Text>
                                )}
                              </div>
                              <Group justify="flex-end" gap={4} mt={4} wrap="nowrap">
                                <Tooltip label="添加到画布（角色节点）" withArrow>
                                  <ActionIcon
                                    size="sm"
                                    variant="light"
                                    onClick={() => {
                                      addNode('taskNode', name, {
                                        kind: 'character',
                                        autoLabel: false,
                                        source: 'sora',
                                        soraTokenId: selectedTokenId || null,
                                        soraCharacterId: charId || c.user_id || c.id || null,
                                        soraCharacterUsername: c.username || c.owner_profile?.username || '',
                                        characterDisplayName: name,
                                        characterAvatarUrl: avatar,
                                        characterCoverUrl: c.cover_image_url || c.thumbnail_url || c.preview_image_url || null,
                                        characterDescription: desc || '',
                                        prompt: desc || '',
                                      })
                                      setActivePanel(null)
                                    }}
                                  >
                                    <IconPlus size={16} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip label="重命名" withArrow>
                                  <ActionIcon
                                    size="sm"
                                    variant="subtle"
                                    disabled={!selectedTokenId || !charId}
                                    onClick={() => {
                                      if (!selectedTokenId || !charId) return
                                      setRenameCharTarget(c)
                                      setRenameCharName(c.username || name || '')
                                      setRenameCharError(null)
                                      setRenameCharChecking(false)
                                      setRenameCharOpen(true)
                                    }}
                                  >
                                    <IconPencil size={14} />
                                  </ActionIcon>
                                </Tooltip>
                                <Tooltip label="删除" withArrow>
                                  <ActionIcon
                                    size="sm"
                                    variant="subtle"
                                    color="red"
                                    disabled={!selectedTokenId || !charId || deletingCharId === charId}
                                    onClick={async () => {
                                      if (!selectedTokenId || !charId) return
                                      if (!confirm('确定删除该 Sora 角色吗？此操作不可恢复')) return
                                      try {
                                        setDeletingCharId(charId)
                                        await deleteSoraCharacter(selectedTokenId, charId)
                                        setCharacters((prev) => prev.filter((x) => x.user_id !== charId))
                                      } catch (err: any) {
                                        alert(err?.message || '删除角色失败，请稍后重试')
                                      } finally {
                                        setDeletingCharId((prev) => (prev === charId ? null : prev))
                                      }
                                    }}
                                  >
                                    {deletingCharId === charId ? <Loader size="xs" /> : <IconTrash size={14} />}
                                  </ActionIcon>
                                </Tooltip>
                              </Group>
                            </Paper>
                          )
                        })}
                      </SimpleGrid>
                      {charCursor && (
                        <Group justify="center" mt="sm">
                          <Button size="xs" variant="light" loading={charLoading} onClick={loadMoreCharacters}>
                            加载更多
                          </Button>
                        </Group>
                      )}
                    </div>
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="sora-history" pt="xs">
                  <Stack gap="sm">
                    <Text size="sm" c="dimmed">
                      展示最近在本地记录的 Sora 视频任务（包含通过代理创建的任务），便于复用或回溯。
                    </Text>
                    {soraHistoryError && (
                      <Text size="xs" c="red">
                        {soraHistoryError}
                      </Text>
                    )}
                    {soraHistoryLoading && soraHistory.length === 0 && (
                      <Center py="sm">
                        <Group gap="xs">
                          <Loader size="xs" />
                          <Text size="xs" c="dimmed">正在加载视频记录…</Text>
                        </Group>
                      </Center>
                    )}
                    {!soraHistoryLoading && soraHistory.length === 0 && !soraHistoryError && (
                      <Text size="xs" c="dimmed">暂无生成记录。</Text>
                    )}
                    {soraHistory.length > 0 && (
                      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                        {soraHistory.map((record) => (
                          <Card key={record.id} withBorder radius="md" shadow="sm" padding="sm">
                            {record.videoUrl ? (
                              <video
                                src={record.videoUrl}
                                muted
                                controls
                                style={{ width: '100%', borderRadius: 8, background: '#000' }}
                              />
                            ) : (
                              <PlaceholderImage label="Sora 视频" />
                            )}
                            <Stack gap={4} mt="xs">
                              <Text size="sm" fw={500} lineClamp={2}>
                                {record.prompt || '未填写提示词'}
                              </Text>
                              <Group gap={6}>
                                <Badge size="xs" color={historyStatusColor(record.status)}>
                                  {record.status}
                                </Badge>
                                <Text size="xs" c="dimmed">
                                  {new Date(record.createdAt).toLocaleString()}
                                </Text>
                              </Group>
                              <Group gap="xs">
                                {record.videoUrl && (
                                  <Button
                                    size="xs"
                                    variant="light"
                                    leftSection={<IconExternalLink size={14} />}
                                    onClick={() => window.open(record.videoUrl!, '_blank', 'noopener,noreferrer')}
                                  >
                                    查看
                                  </Button>
                                )}
                                {record.prompt && (
                                  <Button
                                    size="xs"
                                    variant="subtle"
                                    leftSection={<IconRepeat size={14} />}
                                    onClick={() => {
                                      navigator.clipboard?.writeText(record.prompt || '').then(
                                        () => toast('提示词已复制', 'success'),
                                        () => toast('复制失败', 'error'),
                                      )
                                    }}
                                  >
                                    复制提示词
                                  </Button>
                                )}
                              </Group>
                            </Stack>
                          </Card>
                        ))}
                      </SimpleGrid>
                    )}
                    {historyHasMore && (
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => handleLoadMoreHistory()}
                        disabled={soraHistoryLoading}
                      >
                        {soraHistoryLoading ? '加载中…' : '加载更多'}
                      </Button>
                    )}
                  </Stack>
                </Tabs.Panel>
              </Tabs>
              </div>
            </Paper>
            <Modal
              opened={renameCharOpen}
              onClose={() => {
                setRenameCharOpen(false)
                setRenameCharTarget(null)
                setRenameCharName('')
                setRenameCharError(null)
                setRenameCharChecking(false)
              }}
              title="重命名 Sora 角色"
              centered
              withinPortal
              zIndex={8005}
            >
              <Stack gap="sm">
                <Text size="xs" c="dimmed">
                  修改角色用户名（用于 Sora 角色卡链接）。输入过程中会自动校验是否合法。
                </Text>
                <TextInput
                  label="用户名"
                  placeholder="例如：my.character.name"
                  value={renameCharName}
                  error={renameCharError || undefined}
                  onChange={async (e) => {
                    const v = e.currentTarget.value.trim()
                    setRenameCharName(v)
                    setRenameCharError(null)
                    if (!selectedTokenId || !renameCharTarget?.user_id) return
                    if (!v || v === renameCharTarget.username) {
                      setRenameCharChecking(false)
                      return
                    }
                    if (renameDebounceRef.current) {
                      window.clearTimeout(renameDebounceRef.current)
                      renameDebounceRef.current = null
                    }
                    setRenameCharChecking(true)
                    renameDebounceRef.current = window.setTimeout(async () => {
                      try {
                        await checkSoraCharacterUsername(selectedTokenId, v)
                        setRenameCharError(null)
                      } catch (err: any) {
                        setRenameCharError(err?.message || '用户名不合法或已被占用')
                      } finally {
                        setRenameCharChecking(false)
                      }
                    }, 500)
                  }}
                />
                <Group justify="flex-end" mt="sm">
                  <Button
                    variant="default"
                    onClick={() => {
                      setRenameCharOpen(false)
                      setRenameCharTarget(null)
                      setRenameCharName('')
                      setRenameCharError(null)
                      setRenameCharChecking(false)
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    disabled={
                      !selectedTokenId ||
                      !renameCharTarget?.user_id ||
                      !renameCharName ||
                      renameCharName === renameCharTarget.username ||
                      !!renameCharError ||
                      renameCharChecking
                    }
                    onClick={async () => {
                      if (
                        !selectedTokenId ||
                        !renameCharTarget?.user_id ||
                        !renameCharName ||
                        renameCharName === renameCharTarget.username ||
                        renameCharChecking ||
                        renameCharError
                      ) {
                        return
                      }
                      try {
                        await updateSoraCharacter({
                          tokenId: selectedTokenId,
                          characterId: renameCharTarget.user_id,
                          username: renameCharName,
                          display_name: renameCharTarget.display_name ?? null,
                          profile_asset_pointer: null,
                        })
                        setCharacters((prev) =>
                          prev.map((x) =>
                            x.user_id === renameCharTarget.user_id
                              ? { ...x, username: renameCharName }
                              : x,
                          ),
                        )
                        setRenameCharOpen(false)
                        setRenameCharTarget(null)
                        setRenameCharName('')
                        setRenameCharError(null)
                        setRenameCharChecking(false)
                      } catch (err: any) {
                        alert(err?.message || '更新角色失败，请稍后重试')
                      }
                    }}
                  >
                    保存
                  </Button>
                </Group>
              </Stack>
            </Modal>
            <Modal
              opened={pickCharVideoOpen}
              onClose={() => {
                setPickCharVideoOpen(false)
                setPickCharError(null)
                setPickCharSelected(null)
                setPickCharTab('local')
                setCreateCharDefaultRange(null)
              }}
              size="xl"
              title="选择角色来源视频"
              withinPortal
              zIndex={12000}
              centered
              styles={{
                content: { paddingBottom: 16 },
                body: { maxHeight: '80vh', overflow: 'hidden' },
              }}
            >
              <Tabs
                value={pickCharTab}
                onChange={(v) => {
                  const next = (v as any) || 'local'
                  setPickCharTab(next)
                  if (next === 'drafts') ensureDraftsForPick()
                  if (next === 'published') ensurePublishedForPick()
                }}
              >
                <Tabs.List>
                  <Tabs.Tab value="local">本地上传</Tabs.Tab>
                  <Tabs.Tab value="drafts">草稿视频</Tabs.Tab>
                  <Tabs.Tab value="published">已发布视频</Tabs.Tab>
                </Tabs.List>
                <Tabs.Panel value="local" mt="sm">
                  <Stack gap="xs">
                    <Text size="sm" c="dimmed">上传本地视频创建角色（≤15秒）</Text>
                    <Group gap="xs">
                      <Button
                        size="xs"
                        onClick={() => {
                          if (createCharInputRef.current) {
                            createCharInputRef.current.value = ''
                            createCharInputRef.current.click()
                          }
                        }}
                      >
                        选择视频
                      </Button>
                    </Group>
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="drafts" mt="sm">
                  {pickCharLoading && (
                    <Group gap="xs">
                      <Loader size="xs" />
                      <Text size="xs" c="dimmed">正在加载草稿…</Text>
                    </Group>
                  )}
                  {!pickCharLoading && drafts.length === 0 && (
                    <Text size="xs" c="dimmed">暂无草稿视频</Text>
                  )}
                  <div style={{ maxHeight: '62vh', overflowY: 'auto', paddingRight: 4 }}>
                    <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs" mt="xs">
                      {drafts.map((d, idx) => (
                        <Card
                          key={d.id ?? idx}
                          withBorder
                          radius="md"
                          p="xs"
                          style={{ display: 'flex', flexDirection: 'column', gap: 6,height:'fit-content' }}
                        >
                          {d.thumbnailUrl && (
                            <Image src={d.thumbnailUrl} alt={d.title || d.id} height={96} radius="sm" fit="cover" />
                          )}
                          <Text size="xs" fw={500} lineClamp={1}>{d.title || `草稿 ${idx + 1}`}</Text>
                          <Text size="xs" c="dimmed" lineClamp={2}>
                            {d.prompt || '—'}
                          </Text>
                          <Group justify="flex-end" gap={6} mt="auto">
                            <Button
                              size="xs"
                              variant={pickCharSelected?.url === getDraftVideoUrl(d) ? 'filled' : 'light'}
                              loading={pickCharLoading}
                              onClick={() => {
                                const url = getDraftVideoUrl(d)
                                setPickCharSelected(url ? { url, title: d.title || d.id || '草稿视频' } : null)
                                prepareCharacterFromUrl(url, d.title || d.id || 'draft')
                              }}
                            >
                              使用
                            </Button>
                          </Group>
                        </Card>
                      ))}
                    </SimpleGrid>
                  </div>
                </Tabs.Panel>
                <Tabs.Panel value="published" mt="sm">
                  {pickCharLoading && (
                    <Group gap="xs">
                      <Loader size="xs" />
                      <Text size="xs" c="dimmed">正在加载已发布视频…</Text>
                    </Group>
                  )}
                  {!pickCharLoading && publishedVideos.length === 0 && (
                    <Text size="xs" c="dimmed">暂无已发布视频</Text>
                  )}
                  <div style={{ maxHeight: '62vh', overflowY: 'auto', paddingRight: 4 }}>
                    <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs" mt="xs">
                      {publishedVideos.map((pv, idx) => (
                        <Card
                          key={pv.id ?? idx}
                          withBorder
                          radius="md"
                          p="xs"
                          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                        >
                          {pv.thumbnailUrl && (
                            <Image src={pv.thumbnailUrl} alt={pv.title || pv.id} height={96} radius="sm" fit="cover" />
                          )}
                          <Text size="xs" fw={500} lineClamp={1}>{pv.title || `作品 ${idx + 1}`}</Text>
                          <Text size="xs" c="dimmed" lineClamp={2}>
                            {pv.prompt || '—'}
                          </Text>
                          <Group justify="flex-end" gap={6} mt="auto">
                            <Button
                              size="xs"
                              variant={pickCharSelected?.url === getPublishedVideoUrl(pv) ? 'filled' : 'light'}
                              loading={pickCharLoading}
                              onClick={() => {
                                const url = getPublishedVideoUrl(pv)
                                setPickCharSelected(url ? { url, title: pv.title || pv.id || '已发布视频' } : null)
                                prepareCharacterFromUrl(url, pv.title || pv.id || 'published')
                              }}
                            >
                              使用
                            </Button>
                          </Group>
                        </Card>
                      ))}
                    </SimpleGrid>
                  </div>
                </Tabs.Panel>
              </Tabs>
              {pickCharError && (
                <Text size="xs" c="red" mt="sm">
                  {pickCharError}
                </Text>
              )}
            </Modal>
            <Modal
              opened={createCharFinalizeOpen}
              onClose={() => {
                setCreateCharFinalizeOpen(false)
                setCreateCharCameoId(null)
                setCreateCharAssetPointer(null)
                if (createCharCoverPreview) {
                  URL.revokeObjectURL(createCharCoverPreview)
                }
                setCreateCharCoverPreview(null)
                setCreateCharUsername('')
                setCreateCharDisplayName('')
                setCreateCharUsernameError(null)
                setCreateCharUsernameChecking(false)
                if (createCharUsernameDebounceRef.current) {
                  window.clearTimeout(createCharUsernameDebounceRef.current)
                  createCharUsernameDebounceRef.current = null
                }
              }}
              title="创建 Sora 角色"
              centered
              withinPortal
              zIndex={8006}
            >
              <Stack gap="sm">
                <Text size="xs" c="dimmed">
                  填写角色的用户名和显示名称。用户名只允许英文，长度不超过 20。
                </Text>
                <Group align="flex-start" gap="sm">
                  <div style={{ width: 72, height: 72, borderRadius: 8, overflow: 'hidden', background: 'rgba(15,23,42,.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {createCharCoverPreview ? (
                      <img
                        src={createCharCoverPreview}
                        alt="封面预览"
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <Text size="xs" c="dimmed">
                        无封面
                      </Text>
                    )}
                  </div>
                  <Button
                    size="xs"
                    variant="light"
                    loading={createCharCoverUploading}
                    onClick={handlePickCover}
                    disabled={!selectedTokenId}
                  >
                    选择封面图片
                  </Button>
                </Group>
                <TextInput
                  label="用户名"
                  placeholder="例如：my.character.name"
                  value={createCharUsername}
                  error={createCharUsernameError || undefined}
                  onChange={async (e) => {
                    const v = e.currentTarget.value.trim()
                    setCreateCharUsername(v)
                    setCreateCharUsernameError(null)
                    if (!selectedTokenId) return
                    if (!v) {
                      setCreateCharUsernameChecking(false)
                      return
                    }
                    if (createCharUsernameDebounceRef.current) {
                      window.clearTimeout(createCharUsernameDebounceRef.current)
                      createCharUsernameDebounceRef.current = null
                    }
                    setCreateCharUsernameChecking(true)
                    createCharUsernameDebounceRef.current = window.setTimeout(async () => {
                      try {
                        await checkSoraCharacterUsername(selectedTokenId, v)
                        setCreateCharUsernameError(null)
                      } catch (err: any) {
                        setCreateCharUsernameError(err?.message || '用户名不合法或已被占用')
                      } finally {
                        setCreateCharUsernameChecking(false)
                      }
                    }, 500)
                  }}
                />
                <TextInput
                  label="显示名称"
                  placeholder="例如：My Cameo Character"
                  value={createCharDisplayName}
                  onChange={(e) => setCreateCharDisplayName(e.currentTarget.value)}
                />
                <Group justify="flex-end" mt="sm">
                  <Button
                    variant="default"
                    onClick={() => {
                      setCreateCharFinalizeOpen(false)
                      setCreateCharCameoId(null)
                      setCreateCharAssetPointer(null)
                      if (createCharCoverPreview) {
                        URL.revokeObjectURL(createCharCoverPreview)
                      }
                      setCreateCharCoverPreview(null)
                      setCreateCharUsername('')
                      setCreateCharDisplayName('')
                      setCreateCharUsernameError(null)
                      setCreateCharUsernameChecking(false)
                      if (createCharUsernameDebounceRef.current) {
                        window.clearTimeout(createCharUsernameDebounceRef.current)
                        createCharUsernameDebounceRef.current = null
                      }
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    disabled={
                      !createCharCameoId ||
                      !selectedTokenId ||
                      !createCharUsername ||
                      !!createCharUsernameError ||
                      createCharUsernameChecking ||
                      createCharSubmitting
                    }
                    loading={createCharSubmitting}
                    onClick={async () => {
                      if (
                        !createCharCameoId ||
                        !selectedTokenId ||
                        !createCharUsername ||
                        createCharUsernameChecking ||
                        createCharUsernameError
                      ) {
                        return
                      }
                      setCreateCharSubmitting(true)
                      try {
                        const finalizeResult = await finalizeSoraCharacter({
                          tokenId: selectedTokenId,
                          cameo_id: createCharCameoId,
                          username: createCharUsername,
                          display_name:
                            createCharDisplayName || createCharUsername,
                          profile_asset_pointer:
                            createCharAssetPointer ?? null,
                        })
                        const cameoIdForVisibility =
                          finalizeResult?.cameo?.id || createCharCameoId
                        if (cameoIdForVisibility) {
                          try {
                            await setSoraCameoPublic(
                              selectedTokenId,
                              cameoIdForVisibility,
                            )
                          } catch (err) {
                            console.warn('设置角色为公共访问失败：', err)
                          }
                        }
                        setCreateCharFinalizeOpen(false)
                        setCreateCharCameoId(null)
                        setCreateCharAssetPointer(null)
                        if (createCharCoverPreview) {
                          URL.revokeObjectURL(createCharCoverPreview)
                        }
                        setCreateCharCoverPreview(null)
                        setCreateCharUsername('')
                        setCreateCharDisplayName('')
                        setCreateCharUsernameError(null)
                        setCreateCharUsernameChecking(false)
                        if (createCharUsernameDebounceRef.current) {
                          window.clearTimeout(createCharUsernameDebounceRef.current)
                          createCharUsernameDebounceRef.current = null
                        }

                        setCharLoading(true)
                        try {
                          const data = await listSoraCharacters(selectedTokenId)
                          setCharacters(data.items || [])
                          setCharCursor(data.cursor || null)
                        } catch (err: any) {
                          console.error(err)
                          alert('角色创建成功，但刷新角色列表失败，请稍后手动刷新')
                        } finally {
                          setCharLoading(false)
                        }
                      } catch (err: any) {
                        console.error(err)
                        alert(err?.message || '创建角色失败，请稍后重试')
                      } finally {
                        setCreateCharSubmitting(false)
                      }
                    }}
                  >
                    创建
                  </Button>
                </Group>
              </Stack>
            </Modal>
            <VideoTrimModal
              opened={createCharTrimOpen}
              videoUrl={createCharVideoUrl || ''}
              originalDuration={createCharDuration || 0}
              thumbnails={createCharThumbs}
              loading={createCharUploading}
              progressPct={createCharProgress}
              defaultRange={createCharDefaultRange || undefined}
              onClose={handleTrimClose}
              onConfirm={handleTrimConfirm}
              centered
            />
          </div>
        )}
      </Transition>
    </div>
  )
}
const getDraftTaskId = (d: any): { taskId: string | null; generationId: string | null } => {
  if (!d) return { taskId: null, generationId: null }
  const raw = (d as any)?.raw || {}
  const rawDraft = raw.draft || {}
  const generationId =
    rawDraft.generation_id ||
    raw.generation_id ||
    d.generationId ||
    d.id ||
    raw.id ||
    d.videoDraftId ||
    d.videoPostId ||
    null
  const taskId =
    rawDraft.task_id ||
    raw.task_id ||
    d.taskId ||
    d.id ||
    raw.id ||
    generationId ||
    d.videoDraftId ||
    d.videoPostId ||
    null
  return { taskId, generationId }
}
