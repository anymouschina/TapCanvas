import React from 'react'
import { Group, Stack, Text, UnstyledButton } from '@mantine/core'
import {
  IconPlayerPlay,
  IconPhoto,
  IconLayoutGrid,
  IconBookUpload,
  type IconProps,
} from '@tabler/icons-react'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import { hostedAssetUrl } from '../../config/objectStorageAssets'
import { sanitizeGraphForCanvas, useRFStore } from '../store'
import { getQuickStartSampleFlow, type QuickStartStarterKey } from '../quickStartSample'

const CARD_COVERS: Partial<Record<string, string>> = {
  'storyboard-guide': hostedAssetUrl('assets/onboarding/cover_storyboard_guide-1778423664834.png'),
  'scene-image': hostedAssetUrl('assets/onboarding/cover_scene_image-1778424163943.png'),
  'image-to-video': hostedAssetUrl('assets/onboarding/cover_image_to_video-1778424168566.png'),
}

type Card = {
  key: QuickStartStarterKey | 'upload-novel' | 'storyboard-guide'
  title: string
  subtitle: string
  Icon: React.ComponentType<IconProps>
}

const CARDS: Card[] = [
  { key: 'upload-novel', title: '上传小说', subtitle: '解析原文后创建章节', Icon: IconBookUpload },
  { key: 'storyboard-guide', title: '故事板生成引导', subtitle: '输入故事 → 场景卡 → 分镜', Icon: IconLayoutGrid },
  { key: 'scene-image', title: '一句话出图', subtitle: '文本 → 参考图', Icon: IconPhoto },
  { key: 'image-to-video', title: '首帧转视频', subtitle: '关键帧 → 短视频', Icon: IconPlayerPlay },
]

type Props = {
  onStartStoryboardWizard: () => void
  onOpenNovelImport: () => void
}

export function CanvasEmptyOverlay({ onStartStoryboardWizard, onOpenNovelImport }: Props) {
  const importWorkflow = useRFStore((s) => s.importWorkflow)

  function handleCardClick(key: Card['key']) {
    if (key === 'upload-novel') {
      onOpenNovelImport()
      return
    }
    if (key === 'storyboard-guide') {
      onStartStoryboardWizard()
      return
    }
    const flow = getQuickStartSampleFlow(key)
    importWorkflow(sanitizeGraphForCanvas(flow))
    // 示例流坐标是固定值（视口外左上角），且 importWorkflow 会重映射节点 id；
    // 引导卡只在空画布出现，导入后直接 fit 全部节点即可把视图带过去。
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const fitView = (window as Window & { __tcFitView?: (ids?: string[]) => void }).__tcFitView
        fitView?.()
      })
    })
  }

  return (
    <div className="canvas-empty-overlay">
      <div className="canvas-empty-overlay__hint">
        <span className="canvas-empty-overlay__hint-icon">✦</span>
        <Text className="canvas-empty-overlay__hint-text" size="sm" c="dimmed">
          右键画布 自由生成节点
        </Text>
      </div>
      <Group className="canvas-empty-overlay__cards" gap={12} wrap="nowrap" data-tour="empty-quickstart">
        {CARDS.map(({ key, title, subtitle, Icon }) => {
          const cover = CARD_COVERS[key]
          return (
            <UnstyledButton
              key={key}
              className={`canvas-empty-overlay__card${key === 'upload-novel' ? ' canvas-empty-overlay__card--novel' : ''}${key === 'storyboard-guide' ? ' canvas-empty-overlay__card--primary' : ''}`}
              onClick={() => handleCardClick(key)}
            >
              <div className="canvas-empty-overlay__card-content">
                <Icon className="canvas-empty-overlay__card-icon" size={22} stroke={1.5} />
                <Stack className="canvas-empty-overlay__card-text" gap={2}>
                  <Text className="canvas-empty-overlay__card-title" size="sm" fw={600}>
                    {title}
                  </Text>
                  <Text className="canvas-empty-overlay__card-subtitle" size="xs" c="dimmed">
                    {subtitle}
                  </Text>
                </Stack>
              </div>
              {cover && (
                <ManagedImage
                  className="canvas-empty-overlay__card-bg"
                  src={cover}
                  alt={title}
                />
              )}
            </UnstyledButton>
          )
        })}
      </Group>
    </div>
  )
}
