import React from 'react'
import {
  ActionIcon,
  Button,
  Collapse,
  Group,
  Loader,
  Modal,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core'
import { IconChevronDown, IconChevronUp, IconDownload, IconRefresh } from '@tabler/icons-react'
import QRCode from 'qrcode'
import {
  getReferralCampaign,
  listProjects,
  runPublicTaskWithAuth,
  searchMemoryEntries,
  uploadServerAssetFile,
  writeMemoryEntries,
  type ProjectDto,
  type ReferralCampaignDto,
} from '../api/server'
import { downloadUrl } from '../utils/download'
import { toast } from '../ui/toast'

// ─── persistence ─────────────────────────────────────────────────────────────

const POSTER_SCOPE_ID = 'invite-poster-v1'

async function loadSavedPoster(): Promise<{ posterUrl: string; prompt: string } | null> {
  try {
    const res = await searchMemoryEntries({
      scopes: [{ scopeType: 'user', scopeId: POSTER_SCOPE_ID }],
      memoryTypes: ['artifact_ref'],
      status: 'active',
      limit: 1,
    })
    const item = res.items[0]
    if (!item) return null
    const url = typeof item.content.posterUrl === 'string' ? item.content.posterUrl : ''
    const prompt = typeof item.content.prompt === 'string' ? item.content.prompt : ''
    return url ? { posterUrl: url, prompt } : null
  } catch {
    return null
  }
}

async function savePoster(posterUrl: string, prompt: string): Promise<void> {
  await writeMemoryEntries([{
    scopeType: 'user',
    scopeId: POSTER_SCOPE_ID,
    memoryType: 'artifact_ref',
    title: '邀请海报',
    summaryText: '用户生成的邀请电影海报',
    content: { posterUrl, prompt, generatedAt: new Date().toISOString() },
    sourceKind: 'user_input',
    importance: 0.6,
    tags: ['invite', 'poster'],
    status: 'active',
  }])
}

// ─── prompt ──────────────────────────────────────────────────────────────────

const UNNAMED_PATTERNS = /^(未命名|untitled|unnamed)/i

function buildDefaultPrompt(projects: ProjectDto[], campaign: ReferralCampaignDto | null): string {
  const firstName = projects
    .map((p) => (p.name || '').trim())
    .find((n) => n && !UNNAMED_PATTERNS.test(n)) ?? null

  const rewardCredits = campaign?.inviteeWelcomeCredits ?? null
  const heroText = rewardCredits != null
    ? `赠送 ${rewardCredits} 积分`
    : '创作即奖励'
  const subText = firstName
    ? `我正在用 TapCanvas 制作《${firstName}》，邀您共创`
    : '邀请好友，一起用 TapCanvas 创作'

  const infoLine = [
    firstName ? `「${firstName}」` : null,
    rewardCredits != null ? `受邀注册赠 ${rewardCredits} 积分` : '邀请好友共创',
  ].filter(Boolean).join(' · ')

  return [
    'Vertical artistic promotional poster, 9:16 ratio, 4K cinematic quality.',
    'VISUAL: Full-bleed breathtaking hero scene — a lone creator standing before an enormous glowing canvas portal in a vast dreamlike cosmos. Swirling galaxies, volumetric light shafts, floating illustrated story panels drifting like stars. Rich deep purples, midnight blues, warm gold highlights. Painterly realism, ultra-detailed, ethereal atmosphere.',
    'TEXT — all text is small, refined, and secondary to the visual. Use elegant thin serif or light-weight sans font throughout:',
    '  · Top-center: "TapCanvas" in small tasteful lettering.',
    `  · Lower-middle: one line of small elegant Chinese text — 「${infoLine}」`,
    '  · Do NOT use large bold text anywhere. Let the image speak.',
    'BOTTOM 15%: pure solid black, no illustration — reserved for QR code.',
    'No border. Poster feel: a premium art print, not an advertisement.',
  ].join(' ')
}

// ─── canvas compositing ───────────────────────────────────────────────────────

async function renderQrCanvas(url: string, size: number): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas')
  await QRCode.toCanvas(c, url, {
    width: size,
    margin: 1,
    color: { dark: '#ffffff', light: '#00000000' },
  })
  return c
}

async function compositePosterWithQr(posterUrl: string, inviteUrl: string): Promise<Blob> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context unavailable')

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = posterUrl
  })

  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  ctx.drawImage(img, 0, 0)

  const qrSize = Math.round(canvas.width * 0.22)
  const qrCanvas = await renderQrCanvas(inviteUrl, qrSize)

  const pad = Math.round(qrSize * 0.1)
  const boxW = qrSize + pad * 2
  const boxH = qrSize + pad * 2
  const bx = Math.round((canvas.width - boxW) / 2)
  const by = canvas.height - boxH - Math.round(canvas.height * 0.035)
  const r = Math.round(boxW * 0.1)

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(bx + r, by)
  ctx.lineTo(bx + boxW - r, by)
  ctx.quadraticCurveTo(bx + boxW, by, bx + boxW, by + r)
  ctx.lineTo(bx + boxW, by + boxH - r)
  ctx.quadraticCurveTo(bx + boxW, by + boxH, bx + boxW - r, by + boxH)
  ctx.lineTo(bx + r, by + boxH)
  ctx.quadraticCurveTo(bx, by + boxH, bx, by + boxH - r)
  ctx.lineTo(bx, by + r)
  ctx.quadraticCurveTo(bx, by, bx + r, by)
  ctx.closePath()
  ctx.fillStyle = 'rgba(0,0,0,0.72)'
  ctx.fill()
  ctx.restore()

  ctx.drawImage(qrCanvas, bx + pad, by + pad, qrSize, qrSize)

  const labelFontSize = Math.round(canvas.width * 0.028)
  ctx.font = `${labelFontSize}px -apple-system, "PingFang SC", sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  ctx.textAlign = 'center'
  ctx.fillText('扫码加入 TapCanvas', canvas.width / 2, by + boxH + labelFontSize + Math.round(canvas.height * 0.008))

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
  )
}

async function uploadBlob(blob: Blob): Promise<string> {
  const file = new File([blob], `invite-poster-${Date.now()}.png`, { type: 'image/png' })
  const asset = await uploadServerAssetFile(file, file.name, { taskKind: 'image_generation' })
  const url = typeof asset?.data?.url === 'string' ? asset.data.url.trim() : ''
  if (!url) throw new Error('上传后未获取到 URL')
  return url
}

// ─── state ────────────────────────────────────────────────────────────────────

type PosterState =
  | { phase: 'loading_saved' }
  | { phase: 'idle'; savedUrl: string | null; savedPrompt: string }
  | { phase: 'generating'; stage: 'ai' | 'compositing' | 'uploading' }
  | { phase: 'done'; url: string; prompt: string }
  | { phase: 'error'; message: string; lastUrl: string | null; lastPrompt: string }

// ─── component ────────────────────────────────────────────────────────────────

type Props = {
  opened: boolean
  onClose: () => void
  inviteUrl: string
}

export default function InvitePosterModal({ opened, onClose, inviteUrl }: Props): React.ReactElement {
  const [state, setState] = React.useState<PosterState>({ phase: 'loading_saved' })
  const [projects, setProjects] = React.useState<ProjectDto[]>([])
  const [campaign, setCampaign] = React.useState<ReferralCampaignDto | null>(null)
  const [customPrompt, setCustomPrompt] = React.useState('')
  const [showPrompt, setShowPrompt] = React.useState(false)

  // load projects + campaign + saved poster on open
  React.useEffect(() => {
    if (!opened) return
    setState({ phase: 'loading_saved' })
    setShowPrompt(false)
    Promise.all([
      listProjects().catch(() => [] as ProjectDto[]),
      getReferralCampaign().catch(() => null),
      loadSavedPoster(),
    ]).then(([projs, camp, saved]) => {
      setProjects(projs)
      setCampaign(camp)
      const defaultPrompt = buildDefaultPrompt(projs, camp)
      setCustomPrompt(defaultPrompt)
      if (saved) {
        setState({ phase: 'done', url: saved.posterUrl, prompt: saved.prompt })
      } else {
        setState({ phase: 'idle', savedUrl: null, savedPrompt: defaultPrompt })
      }
    })
  }, [opened])

  const generate = React.useCallback(async (prompt: string) => {
    setState({ phase: 'generating', stage: 'ai' })
    try {
      const res = await runPublicTaskWithAuth({
        request: {
          kind: 'text_to_image',
          prompt,
          extras: {
            modelKey: 'gpt-image-2',
            quality: 'high',
            resolution: '2K',
            aspectRatio: '9:16',
          },
        },
      })
      const rawUrl = res.result?.assets?.[0]?.url
      if (!rawUrl) throw new Error('未获取到生成图片 URL')

      setState({ phase: 'generating', stage: 'compositing' })
      const blob = await compositePosterWithQr(rawUrl, inviteUrl)

      setState({ phase: 'generating', stage: 'uploading' })
      const finalUrl = await uploadBlob(blob)

      await savePoster(finalUrl, prompt).catch(() => {})
      setState({ phase: 'done', url: finalUrl, prompt })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '生成失败，请重试'
      setState((prev) => ({
        phase: 'error',
        message: msg,
        lastUrl: prev.phase === 'done' ? prev.url : null,
        lastPrompt: prompt,
      }))
    }
  }, [inviteUrl])

  const handleGenerate = React.useCallback(() => {
    const prompt = customPrompt.trim() || buildDefaultPrompt(projects, campaign)
    void generate(prompt)
  }, [customPrompt, projects, campaign, generate])

  const [downloading, setDownloading] = React.useState(false)
  const handleDownload = React.useCallback(async () => {
    if (state.phase !== 'done' || downloading) return
    setDownloading(true)
    try {
      await downloadUrl({ url: state.url, filename: 'tapcanvas-invite-poster.png' })
    } catch (e) {
      toast(e instanceof Error ? e.message : '下载失败，请稍后重试', 'error')
    } finally {
      setDownloading(false)
    }
  }, [state, downloading])

  const stageLabel =
    state.phase === 'generating'
      ? state.stage === 'ai' ? '正在生成电影海报…'
        : state.stage === 'compositing' ? '正在合成二维码…'
        : '正在上传保存…'
      : ''

  const showPoster = state.phase === 'done' || (state.phase === 'error' && !!state.lastUrl)
  const posterUrl = state.phase === 'done' ? state.url : state.phase === 'error' ? (state.lastUrl ?? '') : ''

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      centered
      size="sm"
      radius="md"
      title="邀请海报"
      styles={{ body: { paddingTop: 8 } }}
    >
      <Stack gap={12}>
        {/* 加载中 */}
        {state.phase === 'loading_saved' && (
          <Stack align="center" gap={8} py={40}>
            <Loader size="sm" />
            <Text size="xs" c="dimmed">加载中…</Text>
          </Stack>
        )}

        {/* 首次未生成 */}
        {state.phase === 'idle' && (
          <Stack gap={8}>
            <Text size="xs" c="dimmed">点击生成你的专属 AI 电影邀请海报（含二维码）</Text>
            <Button onClick={handleGenerate} fullWidth>生成邀请海报</Button>
          </Stack>
        )}

        {/* 生成中 */}
        {state.phase === 'generating' && (
          <Stack align="center" gap={8} py={40}>
            <Loader size="md" />
            <Text size="sm" c="dimmed">{stageLabel}</Text>
          </Stack>
        )}

        {/* 错误 */}
        {state.phase === 'error' && !state.lastUrl && (
          <Stack align="center" gap={8} py={16}>
            <Text size="sm" c="red">{state.message}</Text>
            <Button size="xs" variant="light" onClick={handleGenerate}>重试</Button>
          </Stack>
        )}
        {state.phase === 'error' && !!state.lastUrl && (
          <Text size="xs" c="red" ta="center">{state.message}</Text>
        )}

        {/* 海报展示 — 一次性刚生成的图，直接用 img 显示无需资源管理器 */}
        {showPoster && posterUrl && (
          <Stack align="center" gap={10}>
            <img
              src={posterUrl}
              alt="邀请海报"
              crossOrigin="anonymous"
              style={{ width: '100%', maxWidth: 280, borderRadius: 8, display: 'block' }}
            />
          </Stack>
        )}

        {/* 操作区 */}
        {(state.phase === 'done' || state.phase === 'error') && (
          <Group justify="center" gap={8}>
            <Tooltip label="重新生成">
              <ActionIcon variant="light" onClick={handleGenerate}>
                <IconRefresh size={16} />
              </ActionIcon>
            </Tooltip>
            {posterUrl && (
              <Button
                size="xs"
                variant="light"
                leftSection={<IconDownload size={14} />}
                loading={downloading}
                onClick={() => { void handleDownload() }}
              >
                下载
              </Button>
            )}
          </Group>
        )}

        {/* 自定义提示词 */}
        {(state.phase === 'done' || state.phase === 'idle' || state.phase === 'error') && (
          <Stack gap={4}>
            <Group
              gap={4}
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setShowPrompt((v) => !v)}
            >
              <Text size="xs" c="dimmed">自定义提示词</Text>
              {showPrompt ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
            </Group>
            <Collapse in={showPrompt}>
              <Stack gap={6}>
                <Textarea
                  size="xs"
                  rows={4}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.currentTarget.value)}
                  placeholder="留空则使用智能生成的提示词"
                  autosize
                  minRows={3}
                  maxRows={8}
                />
                <Button
                  size="xs"
                  variant="filled"
                  onClick={handleGenerate}
                >
                  用此提示词重新生成
                </Button>
              </Stack>
            </Collapse>
          </Stack>
        )}
      </Stack>
    </Modal>
  )
}
