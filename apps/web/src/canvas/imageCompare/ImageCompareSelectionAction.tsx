import { Button } from '@mantine/core'
import { IconArrowsDiff } from '@tabler/icons-react'
import type { ImageCompareSelectionResolution } from './imageCompareSelection'

type ImageCompareSelectionActionProps = {
  className?: string
  resolution: ImageCompareSelectionResolution
  /** 新建对比节点并连上这两张图；还没出图的节点也连，出图后对比节点自动显示。 */
  onCompare: () => void
}

export function ImageCompareSelectionAction({
  className,
  resolution,
  onCompare,
}: ImageCompareSelectionActionProps): JSX.Element | null {
  if (resolution.kind === 'not-image-pair') return null

  const actionClassName = [
    'tc-canvas__selection-action-bar-action',
    'tc-image-compare-selection-action',
    className,
  ].filter(Boolean).join(' ')

  return (
    <Button
      className={actionClassName}
      size="xs"
      radius="xs"
      variant="subtle"
      color="gray"
      leftSection={<IconArrowsDiff className="tc-image-compare-selection-action__icon" size={14} aria-hidden />}
      styles={{ root: { color: '#f5f5f7', fontWeight: 600 } }}
      onClick={onCompare}
    >
      图片对比
    </Button>
  )
}
