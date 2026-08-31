import { Button } from '@mantine/core'
import { IconArrowsLeftRight } from '@tabler/icons-react'
import type { VideoCompareSelectionResolution } from './videoCompareSelection'

type VideoCompareSelectionActionProps = {
  className?: string
  resolution: VideoCompareSelectionResolution
  onCompare: (resolution: Extract<VideoCompareSelectionResolution, { kind: 'ready' }>) => void
  onMissingAssets: (nodeIds: readonly string[]) => void
}

export function VideoCompareSelectionAction({
  className,
  resolution,
  onCompare,
  onMissingAssets,
}: VideoCompareSelectionActionProps): JSX.Element | null {
  if (resolution.kind === 'not-video-pair') return null

  const actionClassName = [
    'tc-canvas__selection-action-bar-action',
    'tc-video-compare-selection-action',
    className,
  ].filter(Boolean).join(' ')

  return (
    <Button
      className={actionClassName}
      size="xs"
      radius="xs"
      variant="subtle"
      color="gray"
      leftSection={(
        <IconArrowsLeftRight
          className="tc-video-compare-selection-action__icon"
          size={14}
          aria-hidden
        />
      )}
      styles={{ root: { color: '#f5f5f7', fontWeight: 600 } }}
      onClick={() => {
        if (resolution.kind === 'missing-assets') {
          onMissingAssets(resolution.nodeIds)
          return
        }
        onCompare(resolution)
      }}
    >
      对比还原度
    </Button>
  )
}
