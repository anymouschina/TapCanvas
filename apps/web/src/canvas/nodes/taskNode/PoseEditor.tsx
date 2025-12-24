import React from 'react'
import { Button, Group, Modal, Stack, Text, Textarea, Badge, Tooltip, SegmentedControl } from '@mantine/core'
import { IconAdjustments } from '@tabler/icons-react'

import { runTaskByVendor, uploadSoraImage } from '../../../api/server'
import { toast } from '../../../ui/toast'
import { useUIStore } from '../../../ui/uiStore'
import { extractTextFromTaskResult, tryParseJsonLike } from '../taskNodeHelpers'
import { isRemoteUrl } from './utils'

export type PosePoint = { name: string; x: number; y: number }

export const POSE_CANVAS_SIZE = { width: 260, height: 260 }
const EDIT_PANEL_HEIGHT = POSE_CANVAS_SIZE.height + 220

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
    poseStickmanUrl: string | null
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
  const [editMode, setEditMode] = React.useState<'pose' | 'depth'>('pose')
  const [depthPrompt, setDepthPrompt] = React.useState('')
  const [depthLoading, setDepthLoading] = React.useState(false)
  const [depthError, setDepthError] = React.useState<string | null>(null)
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
    setDepthPrompt('')
    setDepthError(null)
    setOpen(true)
  }, [options.hasImages, options.promptValue])

  React.useEffect(() => {
    if (!open) return
    setPromptInput(options.promptValue || '')
    setDepthPrompt((prev) => prev || options.promptValue || '')
    setDepthError(null)
  }, [open, options.promptValue])

  React.useEffect(() => {
    if (!open) return
    if (editMode !== 'depth') return
    setDepthPrompt((prev) => prev || options.promptValue || '')
  }, [editMode, open, options.promptValue])

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

  React.useEffect(() => {
    if (!open) return
    if (editMode !== 'pose') return
    let frame = requestAnimationFrame(function paint() {
      if (!canvasRef.current) {
        frame = requestAnimationFrame(paint)
        return
      }
      drawPoseCanvas()
    })
    return () => cancelAnimationFrame(frame)
  }, [drawPoseCanvas, editMode, open])

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
      toast('主图不是在线地址，将仅上传参考图/圈选，推荐先上传到可访问的链接', 'warning')
    }
    setUploading(true)
    try {
      const mergedPrompt = (editMode === 'depth' ? depthPrompt : promptInput).trim() || (options.promptValue || '')
      if (mergedPrompt && options.onPromptSave && editMode === 'pose') {
        options.onPromptSave(mergedPrompt)
      }
      let remoteUrl: string | null = null
    if (editMode === 'pose') {
        const blob: Blob = await new Promise((resolve, reject) => {
          canvas.toBlob((b) => {
            if (b) resolve(b)
            else reject(new Error('生成参考图失败'))
          }, 'image/png')
        })
        const file = new File([blob], 'pose-stickman.png', { type: 'image/png' })
        const result = await uploadSoraImage(undefined, file)
        remoteUrl =
          result?.url ||
          (result as any)?.asset_pointer ||
          (result as any)?.azure_asset_pointer ||
          null
        if (!remoteUrl || !isRemoteUrl(remoteUrl)) {
          throw new Error('上传参考图失败，请稍后重试')
        }
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
            remoteUrl?.trim() || null,
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
      toast('图片编辑参考已保存，将作为 Nano Banana 图像编辑参考', 'success')
      setOpen(false)
    } catch (err: any) {
      console.error('handleApplyPose error', err)
      toast(err?.message || '图片编辑参考保存失败', 'error')
    } finally {
      setUploading(false)
    }
  }, [options.baseImageUrl, options.nodeId, options.poseReferenceImages, options.updateNodeData, options.onPoseSaved, options.onPromptSave, options.promptValue, maskDirty, promptInput, editMode, depthPrompt])

  const handleGenerateDepth = React.useCallback(async () => {
    if (!isRemoteUrl(options.baseImageUrl)) {
      toast('请先上传主图到可访问的链接再进行深度调整', 'error')
      return
    }
    setDepthLoading(true)
    setDepthError(null)
    try {
      const persist = useUIStore.getState().assetPersistenceEnabled
      const task = await runTaskByVendor('openai', {
        kind: 'image_to_prompt',
        prompt: '请从输入图像中智能、全面地提取视觉风格信息，并将结果以严格有效的 JSON 格式输出。字段数量不做限制，可根据图像特征灵活增减，但需保持结构清晰、语义明确、分类合理。以下为建议的通用结构，请在此基础上根据实际情况动态调整、增删字段。',
        extras: {
          imageUrl: options.baseImageUrl,
          nodeId: options.nodeId,
          persistAssets: persist,
        },
      })
      const rawText = extractTextFromTaskResult(task)
      const parsed = tryParseJsonLike(rawText)
      const baseText = parsed ? JSON.stringify(parsed, null, 2) : (rawText || '')
      if (!baseText.trim()) {
        throw new Error('未返回可用的 JSON 数据')
      }
      const refinePrompt = parsed
        ? [
            '请将下面的 JSON 进行更细维度的拆分与归类，保持严格有效的 JSON 输出。',
            '字段数量不做限制，但要结构清晰、语义明确、分类合理。',
            '只输出 JSON，不要额外文字或代码块。',
            '原始 JSON：',
            baseText,
          ].join('\n')
        : [
            '请将下面的描述转换为结构化的 JSON（严格有效）。',
            '字段数量不做限制，但要结构清晰、语义明确、分类合理。',
            '只输出 JSON，不要额外文字或代码块。',
            '原始描述：',
            baseText,
          ].join('\n')

      const refineTask = await runTaskByVendor('openai', {
        kind: 'prompt_refine',
        prompt: refinePrompt,
        extras: {
          nodeId: options.nodeId,
          persistAssets: persist,
        },
      })
      const refinedText = extractTextFromTaskResult(refineTask)
      const refinedParsed = tryParseJsonLike(refinedText)
      const nextText = refinedParsed ? JSON.stringify(refinedParsed, null, 2) : baseText
      setDepthPrompt(nextText)
    } catch (err: any) {
      const message = err?.message || '深度调整失败'
      setDepthError(message)
      toast(message, 'error')
    } finally {
      setDepthLoading(false)
    }
  }, [options.baseImageUrl, options.nodeId])

  const modal = open ? (
    <Modal
      className="pose-editor__modal"
      opened={open}
      onClose={() => setOpen(false)}
      title={(
        <Group className="pose-editor__header" gap={10} align="center" justify="space-between" wrap="nowrap">
          <Text className="pose-editor__title" size="md" fw={700}>
            编辑模式
          </Text>
          <SegmentedControl
            className="pose-editor__mode"
            size="sm"
            value={editMode}
            onChange={(value) => setEditMode(value as 'pose' | 'depth')}
            data={[
              { value: 'pose', label: '姿势调整' },
              { value: 'depth', label: '深度调整' },
            ]}
            styles={{
              label: { color: options.isDarkUi ? '#e2e8f0' : '#0f172a' },
            }}
          />
        </Group>
      )}
      centered
      size={1100}
      withinPortal
      zIndex={320}
    >
      <Stack className="pose-editor__content" gap="sm">
        <Text className="pose-editor__intro" size="xs" c="dimmed">
          使用方法：可拖动火柴人调整姿势，或只用圈选 + 提示词编辑局部。保存后会生成图片编辑参考，影响后续的出图效果。
        </Text>
        <Group className="pose-editor__panels" align="flex-start" gap="md" grow>
          <Stack className="pose-editor__panel" gap={8} style={{ height: EDIT_PANEL_HEIGHT }}>
            <Group className="pose-editor__panel-header" gap={8} align="center">
              <Text className="pose-editor__panel-title" size="sm" fw={600}>
                原图圈选（可选）
              </Text>
              <Badge className="pose-editor__panel-badge" size="xs" variant="outline" color="orange">
                画笔圈中需要调整的主体
              </Badge>
            </Group>
            <div
              className="pose-editor__mask-canvas"
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
                  className="pose-editor__base-image"
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
                <Text className="pose-editor__base-empty" size="xs" c="dimmed" style={{ padding: 12 }}>
                  未找到在线主图，请先上传到可访问的地址
                </Text>
              )}
              <canvas
                className="pose-editor__mask-layer"
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
            <Group className="pose-editor__panel-actions" gap={6}>
              <Button className="pose-editor__clear-mask" variant="subtle" size="xs" onClick={clearMask} disabled={!maskDirty}>
                清除圈选
              </Button>
            </Group>
          </Stack>
          <Stack className="pose-editor__panel" gap={8} style={{ height: EDIT_PANEL_HEIGHT }}>
              {editMode === 'pose' ? (
                <>
                  <Stack className="pose-editor__panel-stack" gap={8}>
                    <Group className="pose-editor__panel-header" gap={8} align="center">
                      <Text className="pose-editor__panel-title" size="sm" fw={600}>
                        火柴人参考（必选）
                      </Text>
                      <Badge className="pose-editor__panel-badge" size="xs" variant="light">
                        必选
                      </Badge>
                    </Group>
                    <canvas
                      className="pose-editor__pose-canvas"
                      ref={canvasRef}
                      width={POSE_CANVAS_SIZE.width}
                      height={POSE_CANVAS_SIZE.height}
                      style={{
                        width: POSE_CANVAS_SIZE.width,
                        height: POSE_CANVAS_SIZE.height,
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
                      className="pose-editor__pose-prompt"
                      label="补充提示词"
                      placeholder="示例：保持原衣着，只调整手部动作；光影延续原图"
                      autosize
                      minRows={2}
                      maxRows={4}
                      value={promptInput}
                      onChange={(e) => setPromptInput(e.currentTarget.value)}
                    />
                  </Stack>
                  <div className="pose-editor__spacer" style={{ flex: 1 }} />
                  <Group className="pose-editor__panel-actions" gap={6}>
                    <Button
                      className="pose-editor__reset-pose"
                      variant="subtle"
                      size="xs"
                      onClick={() => setPoints(createDefaultPosePoints())}
                    >
                      重置火柴人
                    </Button>
                    <Tooltip className="pose-editor__save-tooltip" label="保存参考图、圈选和提示词，并创建引用节点">
                      <Button
                        className="pose-editor__save"
                        size="xs"
                        leftSection={<IconAdjustments size={14} />}
                        onClick={handleApply}
                        loading={uploading}
                      >
                        保存并生成
                      </Button>
                    </Tooltip>
                  </Group>
                </>
              ) : (
                <>
                  <Stack className="pose-editor__panel-stack" gap={8}>
                    <Text className="pose-editor__panel-title" size="sm" fw={600}>
                      深度描述（JSON，可编辑）
                    </Text>
                    <Text
                      className="pose-editor__depth-hint"
                      size="xs"
                      c="dimmed"
                      style={{ color: options.isDarkUi ? 'rgba(226,232,240,0.7)' : '#475569' }}
                    >
                      先生成 JSON，再按需要修改内容；保存后会作为 prompt 使用。
                    </Text>
                    <Group className="pose-editor__panel-actions" gap={6}>
                      <Button
                        className="pose-editor__generate-depth"
                        size="xs"
                        variant="light"
                        loading={depthLoading}
                        onClick={handleGenerateDepth}
                      >
                        生成深度描述
                      </Button>
                      {depthError && (
                        <Text className="pose-editor__depth-error" size="xs" c="red">
                          {depthError}
                        </Text>
                      )}
                    </Group>
                    <Textarea
                      className="pose-editor__depth-textarea"
                      label="JSON 内容"
                      placeholder="点击“生成深度描述”后在此编辑"
                      autosize
                      minRows={4}
                      maxRows={7}
                      value={depthPrompt}
                      onChange={(e) => setDepthPrompt(e.currentTarget.value)}
                    />
                  </Stack>
                  <div className="pose-editor__spacer" style={{ flex: 1 }} />
                  <Group className="pose-editor__panel-actions" gap={6}>
                    <Tooltip className="pose-editor__save-tooltip" label="保存参考图、圈选和深度描述，并创建引用节点">
                      <Button
                        className="pose-editor__save"
                        size="xs"
                        leftSection={<IconAdjustments size={14} />}
                        onClick={handleApply}
                        loading={uploading}
                      >
                        保存并生成
                      </Button>
                    </Tooltip>
                  </Group>
                </>
              )}
            </Stack>
        </Group>
        <Text className="pose-editor__note" size="xs" c="dimmed" style={{ whiteSpace: 'normal' }}>
          效果：参考区域与提示词会被模型优先遵循，未圈选区域尽量保持原样。
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
