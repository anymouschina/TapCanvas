import React from 'react'
import { Button, Group, Modal, Stack, Text, Textarea, Badge, Tooltip } from '@mantine/core'
import { IconAdjustments } from '@tabler/icons-react'

import { uploadSoraImage } from '../../../api/server'
import { toast } from '../../../ui/toast'
import { isRemoteUrl } from './utils'

export type PosePoint = { name: string; x: number; y: number }

export const POSE_CANVAS_SIZE = { width: 360, height: 360 }

export const createDefaultPosePoints = (): PosePoint[] => {
  const w = POSE_CANVAS_SIZE.width
  const h = POSE_CANVAS_SIZE.height
  const cx = w / 2
  const cy = h / 2
  return [
    { name: 'head', x: cx, y: cy - 110 },
    { name: 'neck', x: cx, y: cy - 80 },
    { name: 'shoulderL', x: cx - 40, y: cy - 70 },
    { name: 'elbowL', x: cx - 70, y: cy - 20 },
    { name: 'wristL', x: cx - 60, y: cy + 40 },
    { name: 'shoulderR', x: cx + 40, y: cy - 70 },
    { name: 'elbowR', x: cx + 70, y: cy - 20 },
    { name: 'wristR', x: cx + 60, y: cy + 40 },
    { name: 'hipL', x: cx - 25, y: cy - 10 },
    { name: 'kneeL', x: cx - 30, y: cy + 70 },
    { name: 'ankleL', x: cx - 25, y: cy + 130 },
    { name: 'hipR', x: cx + 25, y: cy - 10 },
    { name: 'kneeR', x: cx + 30, y: cy + 70 },
    { name: 'ankleR', x: cx + 25, y: cy + 130 },
  ]
}

const POSE_LINES: [string, string][] = [
  ['head', 'neck'],
  ['neck', 'shoulderL'],
  ['shoulderL', 'elbowL'],
  ['elbowL', 'wristL'],
  ['neck', 'shoulderR'],
  ['shoulderR', 'elbowR'],
  ['elbowR', 'wristR'],
  ['neck', 'hipL'],
  ['neck', 'hipR'],
  ['hipL', 'kneeL'],
  ['kneeL', 'ankleL'],
  ['hipR', 'kneeR'],
  ['kneeR', 'ankleR'],
  ['hipL', 'hipR'],
]

type UsePoseEditorOptions = {
  nodeId: string
  baseImageUrl: string
  poseReferenceImages?: string[]
  poseStickmanUrl?: string
  onPoseSaved?: (payload: {
    poseStickmanUrl: string
    poseReferenceImages: string[]
    baseImageUrl: string
    maskUrl?: string | null
    prompt?: string
  }) => void
  promptValue?: string
  onPromptSave?: (next: string) => void
  hasImages: boolean
  isDarkUi: boolean
  inlineDividerColor: string
  updateNodeData: (id: string, patch: any) => void
}

type PointerPhase = 'down' | 'move' | 'up'

export function usePoseEditor(options: UsePoseEditorOptions) {
  const [open, setOpen] = React.useState(false)
  const [points, setPoints] = React.useState<PosePoint[]>(() => createDefaultPosePoints())
  const [draggingIndex, setDraggingIndex] = React.useState<number | null>(null)
  const [uploading, setUploading] = React.useState(false)
  const [maskDrawing, setMaskDrawing] = React.useState(false)
  const [maskDirty, setMaskDirty] = React.useState(false)
  const [promptInput, setPromptInput] = React.useState(() => options.promptValue || '')
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const maskCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const maskCtxRef = React.useRef<CanvasRenderingContext2D | null>(null)
  const lastMaskPointRef = React.useRef<{ x: number; y: number } | null>(null)
  const maskDrawingRef = React.useRef(false)

  const poseReady = React.useMemo(() => isRemoteUrl(options.baseImageUrl), [options.baseImageUrl])

  const openEditor = React.useCallback(() => {
    if (!options.hasImages) {
      toast('请先上传或生成图片', 'warning')
      return
    }
    setPoints(createDefaultPosePoints())
    setPromptInput(options.promptValue || '')
    setMaskDirty(false)
    setOpen(true)
  }, [options.hasImages, options.promptValue])

  React.useEffect(() => {
    if (!open) return
    setPromptInput(options.promptValue || '')
  }, [open, options.promptValue])

  const lines = React.useMemo(() => POSE_LINES, [])

  const drawPoseCanvas = React.useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, POSE_CANVAS_SIZE.width, POSE_CANVAS_SIZE.height)
    ctx.fillStyle = options.isDarkUi ? 'rgba(5,8,16,0.92)' : 'rgba(245,248,255,0.95)'
    ctx.fillRect(0, 0, POSE_CANVAS_SIZE.width, POSE_CANVAS_SIZE.height)

    ctx.strokeStyle = options.isDarkUi ? '#7dd3fc' : '#0ea5e9'
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    lines.forEach(([a, b]) => {
      const pa = points.find((p) => p.name === a)
      const pb = points.find((p) => p.name === b)
      if (!pa || !pb) return
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(pb.x, pb.y)
      ctx.stroke()
    })

    points.forEach((p) => {
      ctx.beginPath()
      ctx.fillStyle = options.isDarkUi ? '#e0f2fe' : '#0f172a'
      ctx.strokeStyle = options.isDarkUi ? '#38bdf8' : '#0ea5e9'
      ctx.lineWidth = 2
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    })
  }, [lines, options.isDarkUi, points])

  React.useEffect(() => {
    if (!open) return
    // Modal content mounts after transition; wait for the canvas ref before drawing.
    let frame = requestAnimationFrame(function paint() {
      if (!canvasRef.current) {
        frame = requestAnimationFrame(paint)
        return
      }
      drawPoseCanvas()
    })
    return () => cancelAnimationFrame(frame)
  }, [open, drawPoseCanvas])

  const initMaskCanvas = React.useCallback(() => {
    const canvas = maskCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, POSE_CANVAS_SIZE.width, POSE_CANVAS_SIZE.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#ff7a1a'
    ctx.lineWidth = 18
    ctx.globalAlpha = 0.92
    ctx.globalCompositeOperation = 'source-over'
    ctx.shadowBlur = 0
    maskCtxRef.current = ctx
    lastMaskPointRef.current = null
  }, [])

  React.useEffect(() => {
    if (!open) return
    let frame: number | null = null
    const ensureCanvas = () => {
      if (maskCanvasRef.current) {
        initMaskCanvas()
        return
      }
      frame = requestAnimationFrame(ensureCanvas)
    }
    ensureCanvas()
    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [initMaskCanvas, open])

  const handleMaskPointer = React.useCallback(
    (evt: React.MouseEvent<HTMLCanvasElement>, phase: PointerPhase) => {
      const canvas = maskCanvasRef.current
      const ctx = maskCtxRef.current
      if (!canvas || !ctx) return
      const rect = canvas.getBoundingClientRect()
      const x = evt.clientX - rect.left
      const y = evt.clientY - rect.top

      if (phase === 'down') {
        setMaskDrawing(true)
        maskDrawingRef.current = true
        setMaskDirty(true)
        lastMaskPointRef.current = { x, y }
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.stroke()
        return
      }

      if (phase === 'move') {
        if (!maskDrawingRef.current || !lastMaskPointRef.current) return
        ctx.lineTo(x, y)
        ctx.stroke()
        lastMaskPointRef.current = { x, y }
        return
      }

      setMaskDrawing(false)
      maskDrawingRef.current = false
      lastMaskPointRef.current = null
    },
    [],
  )

  const clearMask = React.useCallback(() => {
    const canvas = maskCanvasRef.current
    const ctx = maskCtxRef.current
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, POSE_CANVAS_SIZE.width, POSE_CANVAS_SIZE.height)
    initMaskCanvas()
    setMaskDirty(false)
  }, [initMaskCanvas])

  const handlePointer = React.useCallback(
    (evt: React.MouseEvent<HTMLCanvasElement>, phase: PointerPhase) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const x = evt.clientX - rect.left
      const y = evt.clientY - rect.top

      if (phase === 'down') {
        const hitIndex = points.findIndex((p) => Math.hypot(p.x - x, p.y - y) <= 12)
        if (hitIndex >= 0) {
          setDraggingIndex(hitIndex)
        }
        return
      }

      if (phase === 'move') {
        if (draggingIndex === null) return
        setPoints((prev) =>
          prev.map((p, idx) =>
            idx === draggingIndex
              ? {
                  ...p,
                  x: Math.max(0, Math.min(POSE_CANVAS_SIZE.width, x)),
                  y: Math.max(0, Math.min(POSE_CANVAS_SIZE.height, y)),
                }
              : p,
          ),
        )
        return
      }

      setDraggingIndex(null)
    },
    [draggingIndex, points],
  )

  const handleApply = React.useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!isRemoteUrl(options.baseImageUrl)) {
      toast('主图不是在线地址，将仅上传姿势/圈选，推荐先上传到可访问的链接', 'warning')
    }
    setUploading(true)
    try {
      const mergedPrompt = (promptInput || '').trim() || (options.promptValue || '')
      if (mergedPrompt && options.onPromptSave) {
        options.onPromptSave(mergedPrompt)
      }
      const blob: Blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b)
          else reject(new Error('生成姿势图失败'))
        }, 'image/png')
      })
      const file = new File([blob], 'pose-stickman.png', { type: 'image/png' })
      const result = await uploadSoraImage(undefined, file)
      const remoteUrl =
        result?.url ||
        (result as any)?.asset_pointer ||
        (result as any)?.azure_asset_pointer ||
        null
      if (!remoteUrl || !isRemoteUrl(remoteUrl)) {
        throw new Error('上传姿势参考失败，请稍后重试')
      }

      let maskUrl: string | null = null
      if (maskDirty && maskCanvasRef.current) {
        const maskBlob: Blob = await new Promise((resolve, reject) => {
          maskCanvasRef.current?.toBlob((b) => {
            if (b) resolve(b)
            else reject(new Error('生成圈选蒙版失败'))
          }, 'image/png')
        })
        const maskFile = new File([maskBlob], 'pose-mask.png', { type: 'image/png' })
        const maskRes = await uploadSoraImage(undefined, maskFile)
        maskUrl =
          (maskRes as any)?.url ||
          (maskRes as any)?.asset_pointer ||
          (maskRes as any)?.azure_asset_pointer ||
          null
      }

      const refs = Array.from(
        new Set(
          [
            maskUrl?.trim() || null,
            options.baseImageUrl.trim(),
            remoteUrl.trim(),
            ...(options.poseReferenceImages || []).filter(isRemoteUrl),
          ].filter(Boolean),
        ),
      ).slice(0, 3)
      options.updateNodeData(options.nodeId, {
        poseStickmanUrl: remoteUrl,
        poseReferenceImages: refs,
        ...(maskUrl ? { poseMaskUrl: maskUrl } : {}),
      })
      if (options.onPoseSaved) {
        options.onPoseSaved({
          poseStickmanUrl: remoteUrl,
          poseReferenceImages: refs,
          baseImageUrl: options.baseImageUrl,
          maskUrl,
          prompt: mergedPrompt,
        })
      }
      toast('姿势参考已保存，将作为 Nano Banana 图像编辑参考', 'success')
      setOpen(false)
    } catch (err: any) {
      console.error('handleApplyPose error', err)
      toast(err?.message || '姿势参考保存失败', 'error')
    } finally {
      setUploading(false)
    }
  }, [options.baseImageUrl, options.nodeId, options.poseReferenceImages, options.updateNodeData, options.onPoseSaved, options.onPromptSave, options.promptValue, maskDirty, promptInput])

  const modal = open ? (
    <Modal
      opened={open}
      onClose={() => setOpen(false)}
      title="姿势调整（火柴人参考）"
      centered
      size="xl"
      withinPortal
      zIndex={320}
    >
      <Stack gap="sm">
        <Text size="xs" c="dimmed">
          拖动节点调整火柴人姿势。可在右侧原图上用画笔圈选主体，补充提示词。保存后，主图、火柴人图与圈选蒙版会作为参考图传给 Nano Banana 进行图像编辑（需主图为在线 URL）。
        </Text>
        <Group align="flex-start" gap="md" grow>
          <Stack gap={8}>
            <Group gap={8} align="center">
              <Text size="sm" fw={600}>原图圈选（可选）</Text>
              <Badge size="xs" variant="outline" color="orange">
                画笔圈中需要调整的主体
              </Badge>
            </Group>
            <div
              style={{
                position: 'relative',
                width: POSE_CANVAS_SIZE.width,
                height: POSE_CANVAS_SIZE.height,
                borderRadius: 12,
                border: `1px solid ${options.inlineDividerColor}`,
                overflow: 'hidden',
                background: options.isDarkUi ? 'rgba(5,8,16,0.9)' : 'rgba(245,248,255,0.95)',
              }}
            >
              {poseReady ? (
                <img
                  src={options.baseImageUrl}
                  alt="base"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                    pointerEvents: 'none',
                    position: 'absolute',
                    inset: 0,
                  }}
                />
              ) : (
                <Text size="xs" c="dimmed" style={{ padding: 12 }}>
                  未找到在线主图，请先上传到可访问的地址
                </Text>
              )}
              <canvas
                ref={maskCanvasRef}
                width={POSE_CANVAS_SIZE.width}
                height={POSE_CANVAS_SIZE.height}
                style={{
                  position: 'absolute',
                  inset: 0,
                  cursor: maskDrawing ? 'crosshair' : 'cell',
                  zIndex: 2,
                  pointerEvents: 'auto',
                }}
                onMouseDown={(e) => handleMaskPointer(e, 'down')}
                onMouseMove={(e) => handleMaskPointer(e, 'move')}
                onMouseUp={(e) => handleMaskPointer(e, 'up')}
                onMouseLeave={(e) => handleMaskPointer(e, 'up')}
              />
            </div>
            <Group gap={6}>
              <Button variant="subtle" size="xs" onClick={clearMask} disabled={!maskDirty}>
                清除圈选
              </Button>
            </Group>
          </Stack>
          <Stack gap={8}>
            <Group gap={8} align="center">
              <Text size="sm" fw={600}>姿势火柴人 + 提示词</Text>
              <Badge size="xs" variant="light">必选</Badge>
            </Group>
            <canvas
              ref={canvasRef}
              width={POSE_CANVAS_SIZE.width}
              height={POSE_CANVAS_SIZE.height}
              style={{
                borderRadius: 12,
                border: `1px solid ${options.inlineDividerColor}`,
                background: options.isDarkUi ? 'rgba(5,8,16,0.92)' : 'rgba(245,248,255,0.95)',
                cursor: draggingIndex !== null ? 'grabbing' : 'grab',
              }}
              onMouseDown={(e) => handlePointer(e, 'down')}
              onMouseMove={(e) => handlePointer(e, 'move')}
              onMouseUp={(e) => handlePointer(e, 'up')}
              onMouseLeave={(e) => handlePointer(e, 'up')}
            />
            <Textarea
              label="补充提示词"
              placeholder="示例：保持原衣着，只调整手部动作；光影延续原图"
              autosize
              minRows={2}
              maxRows={4}
              value={promptInput}
              onChange={(e) => setPromptInput(e.currentTarget.value)}
            />
            <Group gap={6}>
              <Button
                variant="subtle"
                size="xs"
                onClick={() => setPoints(createDefaultPosePoints())}
              >
                重置姿势
              </Button>
              <Tooltip label="保存姿势、圈选和提示词，并创建引用节点">
                <Button
                  size="xs"
                  leftSection={<IconAdjustments size={14} />}
                  onClick={handleApply}
                  loading={uploading}
                >
                  保存并生成
                </Button>
              </Tooltip>
            </Group>
          </Stack>
        </Group>
        <Text size="xs" c="dimmed">
          主图：{poseReady ? options.baseImageUrl : '未找到在线主图（需上传到在线地址）'}
        </Text>
      </Stack>
    </Modal>
  ) : null

  return {
    open: openEditor,
    modal,
    poseReady,
    setOpen,
  }
}
