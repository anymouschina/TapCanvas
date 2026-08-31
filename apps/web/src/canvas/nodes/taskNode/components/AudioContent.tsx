import React from 'react'
import { ActionIcon, Group, Stack, Text, Tooltip } from '@mantine/core'
import {
  IconDownload,
  IconMusic,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerSkipBack,
  IconPlayerSkipForward,
  IconUpload,
} from '@tabler/icons-react'
import WaveSurfer from 'wavesurfer.js'
import { downloadUrl } from '../../../../utils/download'
import { toast } from '../../../../ui/toast'

export type AudioContentProps = {
  audioUrl: string | null
  audioDurationSec: number | null
  isRunning: boolean
  readOnly?: boolean
  nodeHeight?: number
  onUpload?: (file: File) => void
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/**
 * 音频节点资产卡：资产=一段音频。
 * 结果态 = wavesurfer 条形波形（可点击/拖动音轴 seek 到指定时间点）+
 * 时间气泡 + 居中播放控制；生成中 = shimmer；空态 = 音符占位 + 上传。
 */
export function AudioContent({
  audioUrl,
  audioDurationSec,
  isRunning,
  readOnly,
  nodeHeight,
  onUpload,
}: AudioContentProps): JSX.Element {
  const waveContainerRef = React.useRef<HTMLDivElement | null>(null)
  const waveSurferRef = React.useRef<WaveSurfer | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [currentSec, setCurrentSec] = React.useState(0)
  const [totalSec, setTotalSec] = React.useState(audioDurationSec ?? 0)
  const [waveReady, setWaveReady] = React.useState(false)

  // 卡片固定 16:9（参考竞品音频资产卡），不随节点高度自由变形
  void nodeHeight

  React.useEffect(() => {
    if (!audioUrl || !waveContainerRef.current) return
    setWaveReady(false)
    setPlaying(false)
    setCurrentSec(0)
    const ws = WaveSurfer.create({
      container: waveContainerRef.current,
      url: audioUrl,
      height: 96,
      waveColor: 'rgba(255,255,255,0.78)',
      progressColor: 'rgba(255,255,255,0.28)',
      cursorColor: '#3da9fc',
      cursorWidth: 2,
      barWidth: 5,
      barGap: 4,
      barRadius: 3,
      normalize: true,
      dragToSeek: true,
      autoplay: false,
    })
    waveSurferRef.current = ws
    ws.on('ready', () => {
      setWaveReady(true)
      setTotalSec(ws.getDuration())
    })
    ws.on('timeupdate', (t: number) => setCurrentSec(t))
    ws.on('play', () => setPlaying(true))
    ws.on('pause', () => setPlaying(false))
    ws.on('finish', () => setPlaying(false))
    return () => {
      waveSurferRef.current = null
      try {
        ws.destroy()
      } catch {
        // wavesurfer 销毁时偶发 AbortError，可忽略
      }
    }
    // cardHeight 变化不重建波形，避免 resize 抖动
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioUrl])

  const togglePlay = React.useCallback(() => {
    void waveSurferRef.current?.playPause()
  }, [])
  const skipBy = React.useCallback((delta: number) => {
    const ws = waveSurferRef.current
    if (!ws) return
    ws.setTime(Math.min(Math.max(0, ws.getCurrentTime() + delta), ws.getDuration()))
  }, [])

  const handlePickFile = React.useCallback(() => {
    fileInputRef.current?.click()
  }, [])
  const handleFileChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (file && onUpload) onUpload(file)
    },
    [onUpload],
  )
  const [downloading, setDownloading] = React.useState(false)
  const handleDownload = React.useCallback(async () => {
    if (!audioUrl || downloading) return
    setDownloading(true)
    try {
      await downloadUrl({ url: audioUrl, filename: 'audio.mp3' })
    } catch (e) {
      toast(e instanceof Error ? e.message : '下载失败，请稍后重试', 'error')
    } finally {
      setDownloading(false)
    }
  }, [audioUrl, downloading])

  // 生成中：shimmer 占位
  if (isRunning && !audioUrl) {
    return (
      <div
        className="tc-audio-card tc-audio-card--loading"
        style={{
          aspectRatio: '16 / 9',
          width: '100%',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.12)',
          background:
            'linear-gradient(100deg, rgba(255,255,255,0.03) 35%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.03) 65%)',
          backgroundSize: '300% 100%',
          animation: 'tc-audio-shimmer 1.6s ease-in-out infinite',
        }}
      >
        <style>{'@keyframes tc-audio-shimmer { 0% { background-position: 100% 0 } 100% { background-position: -100% 0 } }'}</style>
      </div>
    )
  }

  // 空态：音符占位 + 上传
  if (!audioUrl) {
    return (
      <Stack
        className="tc-audio-card tc-audio-card--empty"
        align="center"
        justify="center"
        gap={10}
        style={{
          aspectRatio: '16 / 9',
          width: '100%',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.12)',
          background: 'rgba(255,255,255,0.02)',
        }}
      >
        <IconMusic size={40} stroke={1.2} style={{ opacity: 0.22 }} />
        <Group className="nodrag" gap={8}>
          <Text size="xs" c="dimmed">
            在下方输入文案生成
          </Text>
          {onUpload && !readOnly ? (
            <Tooltip label="上传本地音频" withArrow>
              <ActionIcon variant="default" size="sm" onClick={handlePickFile}>
                <IconUpload size={13} />
              </ActionIcon>
            </Tooltip>
          ) : null}
        </Group>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
      </Stack>
    )
  }

  // 结果态：波形 + 拖动音轴 + 播放控制
  return (
    <Stack
      className="tc-audio-card"
      gap={4}
      style={{
        aspectRatio: '16 / 9',
        width: '100%',
        borderRadius: 12,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'rgba(255,255,255,0.03)',
        padding: '10px 14px 8px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        ref={waveContainerRef}
        className="nodrag"
        style={{ flex: 1, minHeight: 0, cursor: waveReady ? 'pointer' : 'default' }}
      />
      <Group justify="center" gap={2} style={{ marginTop: -2 }}>
        <Text
          size="xs"
          style={{
            background: '#3da9fc',
            color: '#fff',
            borderRadius: 999,
            padding: '0 8px',
            fontSize: 10,
            lineHeight: '16px',
          }}
        >
          {formatClock(currentSec)}/{formatClock(totalSec || audioDurationSec || 0)}
        </Text>
      </Group>
      <Group className="nodrag" justify="center" gap={14}>
        <ActionIcon variant="subtle" color="gray" size="md" onClick={() => skipBy(-5)} disabled={!waveReady}>
          <IconPlayerSkipBack size={15} />
        </ActionIcon>
        <ActionIcon
          variant="white"
          radius="xl"
          size={36}
          onClick={togglePlay}
          disabled={!waveReady}
          style={{ background: 'rgba(255,255,255,0.92)', color: '#111' }}
        >
          {playing ? <IconPlayerPause size={17} /> : <IconPlayerPlay size={17} style={{ marginLeft: 2 }} />}
        </ActionIcon>
        <ActionIcon variant="subtle" color="gray" size="md" onClick={() => skipBy(5)} disabled={!waveReady}>
          <IconPlayerSkipForward size={15} />
        </ActionIcon>
      </Group>
      <Group className="nodrag" gap={4} style={{ position: 'absolute', top: 8, right: 8 }}>
        {onUpload && !readOnly ? (
          <Tooltip label="替换为本地音频" withArrow>
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={handlePickFile}>
              <IconUpload size={13} />
            </ActionIcon>
          </Tooltip>
        ) : null}
        <Tooltip label="下载音频" withArrow>
          <ActionIcon variant="subtle" color="gray" size="sm" loading={downloading} onClick={() => { void handleDownload() }}>
            <IconDownload size={13} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </Stack>
  )
}
