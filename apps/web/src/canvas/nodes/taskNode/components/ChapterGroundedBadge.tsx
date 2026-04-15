import React from 'react'
import { Badge } from '@mantine/core'

import type { ChapterGroundedProductionMetadata } from '../../../productionMeta'

type ChapterGroundedBadgeProps = {
  metadata: ChapterGroundedProductionMetadata
}

function buildBadgeLabel(metadata: ChapterGroundedProductionMetadata): string {
  const missingCount = metadata.lockedAnchors.missing.length
  if (metadata.authorityBaseFrame.status === 'confirmed') {
    return missingCount > 0 ? `章锁·${missingCount}缺口` : '章锁·已定'
  }
  return missingCount > 0 ? `章锁·${missingCount}待补` : '章锁·待基底'
}

export function ChapterGroundedBadge({ metadata }: ChapterGroundedBadgeProps): JSX.Element {
  const confirmed = metadata.authorityBaseFrame.status === 'confirmed'
  const badgeColor = confirmed ? 'teal' : 'yellow'

  return (
    <div className="tc-task-node__chapter-grounded-badge">
      <Badge
        className="tc-task-node__chapter-grounded-badge-chip"
        size="xs"
        radius="sm"
        color={badgeColor}
        variant={confirmed ? 'light' : 'outline'}
      >
        {buildBadgeLabel(metadata)}
      </Badge>
    </div>
  )
}
