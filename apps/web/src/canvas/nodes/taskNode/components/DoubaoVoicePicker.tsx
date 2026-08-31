import React from 'react'
import {
  ActionIcon,
  Avatar,
  Box,
  Group,
  Popover,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import {
  IconChevronDown,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
  IconSearch,
} from '@tabler/icons-react'
import { ManagedImage } from '../../../../domain/resource-runtime/components/ManagedImage'
import { fetchSeedAudioVoices, type SeedAudioVoice } from '../../seedAudioVoiceService'

type Props = {
  value: string
  /** name = 选中音色的目录显示名（清空音色时为空）；配音卡节点靠它同步 voiceLabel/label。 */
  onChange: (id: string, name?: string) => void
  /** 画布节点内阻止拖拽用（与其它芯片一致）。 */
  stopNodeDrag?: (event: React.SyntheticEvent) => void
  /** true：渲染为底部 toolbar 芯片样式（auto 宽、无边框文本），与其它控制芯片一致。 */
  compact?: boolean
}

const HOVER_PLAY_DELAY_MS = 150

/**
 * 豆包语音富音色选择器（Mantine 版，画布优先：节点底部 toolbar 内 Popover overlay，
 * 不开全屏 Modal）。头部芯片显示当前音色，点开展开搜索框 + 头像/名称/描述行列表，
 * 支持悬停自动试听（150ms 防抖，单个共享 <audio>）+ 行内 ▶ 按钮 + 选中高亮。
 * 后端配了 VOLC AK/SK → 富数据（头像+试听）；否则回落静态库（仍可选音色）。
 */
export default function DoubaoVoicePicker({ value, onChange, stopNodeDrag, compact }: Props) {
  const [open, setOpen] = React.useState(false)
  const [keyword, setKeyword] = React.useState('')
  const [voices, setVoices] = React.useState<SeedAudioVoice[]>([])
  const [playingId, setPlayingId] = React.useState<string>('')

  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollingRef = React.useRef(false)
  const scrollTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // 拉取富音色目录（含头像/试听）；失败回落静态库。拿到富数据后不再重复请求。
  const fetchedRichRef = React.useRef(false)
  const loadVoices = React.useCallback(() => {
    fetchSeedAudioVoices()
      .then((list) => {
        setVoices(list)
        if (list.some((v) => v.avatar || v.trialUrl)) fetchedRichRef.current = true
      })
      .catch(() => {})
  }, [])
  React.useEffect(() => {
    loadVoices()
  }, [loadVoices])
  // 打开时若仍是静态回落（后端启动短暂不可用），重试拉取自愈到富数据
  React.useEffect(() => {
    if (open && !fetchedRichRef.current) loadVoices()
  }, [open, loadVoices])

  React.useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
      const audio = audioRef.current
      if (audio) {
        audio.pause()
        audio.src = ''
      }
    }
  }, [])

  const ensureAudio = (): HTMLAudioElement => {
    if (!audioRef.current) {
      const el = new Audio()
      el.preload = 'none'
      el.onended = () => setPlayingId('')
      audioRef.current = el
    }
    return audioRef.current
  }

  const stopPlayback = () => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      try {
        audio.currentTime = 0
      } catch {
        /* ignore */
      }
    }
    setPlayingId('')
  }

  const playVoice = (voice: SeedAudioVoice) => {
    if (!voice.trialUrl) return
    const audio = ensureAudio()
    if (audio.src !== voice.trialUrl) audio.src = voice.trialUrl
    try {
      audio.currentTime = 0
    } catch {
      /* ignore */
    }
    audio
      .play()
      .then(() => setPlayingId(voice.id))
      .catch(() => setPlayingId(''))
  }

  // 悬停自动试听（防抖）。滚动中/刚结束不触发，需用户主动把鼠标移到行上。
  const handleRowEnter = (voice: SeedAudioVoice) => {
    if (!voice.trialUrl || scrollingRef.current) return
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current)
    hoverTimerRef.current = setTimeout(() => {
      if (scrollingRef.current) return
      playVoice(voice)
    }, HOVER_PLAY_DELAY_MS)
  }

  const togglePlay = (event: React.MouseEvent, voice: SeedAudioVoice) => {
    event.stopPropagation()
    if (!voice.trialUrl) return
    if (playingId === voice.id) stopPlayback()
    else playVoice(voice)
  }

  // 滚动优先：滚动即停试听 + 取消待播，滚停后也不自动补播。
  const handleListScroll = () => {
    scrollingRef.current = true
    stopPlayback()
    if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current)
    scrollTimerRef.current = setTimeout(() => {
      scrollingRef.current = false
    }, 250)
  }

  const selectVoice = (id: string) => {
    stopPlayback()
    onChange(id, voices.find((v) => v.id === id)?.name || '')
    setOpen(false)
  }

  const filtered = React.useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return voices
    return voices.filter((v) =>
      `${v.name} ${v.id} ${v.scene} ${v.description} ${v.gender} ${v.age}`.toLowerCase().includes(kw),
    )
  }, [voices, keyword])

  const selectedVoice = React.useMemo(() => voices.find((v) => v.id === value), [voices, value])
  const headerLabel = value
    ? selectedVoice
      ? `${selectedVoice.name}${selectedVoice.scene ? `（${selectedVoice.scene}）` : ''}`
      : value
    : '不指定音色'

  const renderRow = (voice: SeedAudioVoice) => {
    const isSelected = voice.id === value
    const isPlaying = playingId === voice.id
    return (
      <UnstyledButton
        key={voice.id}
        onClick={() => selectVoice(voice.id)}
        onMouseEnter={() => handleRowEnter(voice)}
        onMouseLeave={stopPlayback}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: 6,
          borderRadius: 8,
          border: isSelected
            ? '1px solid var(--mantine-color-blue-5)'
            : '1px solid transparent',
          background: isSelected ? 'var(--mantine-color-blue-light)' : 'transparent',
        }}
      >
        {voice.avatar ? (
          <Box
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            <ManagedImage
              className="doubao-voice-avatar"
              src={voice.avatar}
              alt={voice.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </Box>
        ) : (
          <Avatar size={36} radius="xl" color="blue">
            {(voice.name || '?').slice(0, 1)}
          </Avatar>
        )}

        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap={6} wrap="nowrap" align="baseline">
            <Text size="xs" fw={600} truncate>
              {voice.name}
            </Text>
            {(voice.gender || voice.age || voice.scene) && (
              <Text size="10px" c="dimmed" truncate>
                {[voice.gender, voice.age, voice.scene].filter(Boolean).join(' · ')}
              </Text>
            )}
          </Group>
          {voice.description && (
            <Text size="11px" c="dimmed" lineClamp={2}>
              {voice.description}
            </Text>
          )}
        </Stack>

        {voice.trialUrl && (
          <ActionIcon
            variant={isPlaying ? 'filled' : 'light'}
            color="blue"
            size="sm"
            radius="xl"
            onClick={(e) => togglePlay(e, voice)}
            title="试听"
          >
            {isPlaying ? (
              <IconPlayerPauseFilled size={12} />
            ) : (
              <IconPlayerPlayFilled size={12} />
            )}
          </ActionIcon>
        )}
      </UnstyledButton>
    )
  }

  return (
    <Popover
      opened={open}
      onChange={setOpen}
      position="top-start"
      withinPortal
      shadow="md"
      width={320}
    >
      <Popover.Target>
        <UnstyledButton
          className="nodrag"
          onPointerDownCapture={stopNodeDrag}
          onMouseDownCapture={stopNodeDrag}
          onClick={() => setOpen((o) => !o)}
          title={`音色 · ${headerLabel}`}
          style={
            compact
              ? {
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  maxWidth: 160,
                  fontSize: 12,
                  color: 'inherit',
                }
              : {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 6,
                  width: '100%',
                  minHeight: 28,
                  padding: '4px 8px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: value
                    ? '1px solid var(--mantine-color-blue-5)'
                    : '1px solid var(--mantine-color-default-border)',
                  background: 'var(--mantine-color-body)',
                }
          }
        >
          <Text size="xs" truncate span>
            {headerLabel}
          </Text>
          <IconChevronDown size={12} style={{ opacity: 0.6, flexShrink: 0 }} />
        </UnstyledButton>
      </Popover.Target>
      <Popover.Dropdown
        className="nodrag"
        onPointerDownCapture={stopNodeDrag}
        onMouseDownCapture={stopNodeDrag}
        p={8}
      >
        <Stack gap={6}>
          <TextInput
            size="xs"
            value={keyword}
            placeholder="搜索音色（名称/场景/ID/描述）"
            leftSection={<IconSearch size={13} />}
            onChange={(e) => setKeyword(e.currentTarget.value)}
          />
          <UnstyledButton
            onClick={() => selectVoice('')}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              border: '1px solid var(--mantine-color-blue-5)',
              background: value === '' ? 'var(--mantine-color-blue-light)' : 'transparent',
            }}
          >
            不指定音色（用文本/参考生成）
          </UnstyledButton>
          <ScrollArea.Autosize mah={300} type="auto" onScrollCapture={handleListScroll}>
            <Stack gap={4} onWheel={handleListScroll}>
              {filtered.length === 0 ? (
                <Text size="xs" c="dimmed" p={8}>
                  暂无匹配音色
                </Text>
              ) : (
                filtered.map(renderRow)
              )}
            </Stack>
          </ScrollArea.Autosize>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
