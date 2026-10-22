import React, { useState } from 'react'
import { IconPlayerPlay } from '@tabler/icons-react'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import type { WorkbenchItem } from './workbenchModel'
import type { ShotDesignItem } from './shotDesign'

type Props = { item: ShotDesignItem; onPreview: (item: WorkbenchItem) => void; onPlay?: () => void }

/** Display the persisted clip script verbatim; reference relationships come from graph metadata. */
export const ShotDesignCard = React.memo(function ShotDesignCard({ item, onPreview, onPlay }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  return (
    <article className="tc-shot-card" data-node-id={item.shotDesign.videoId} data-expanded={expanded}>
      <header className="tc-shot-card__header">
        <div className="tc-shot-card__heading">
          <h3 className="tc-shot-card__name">{onPlay
            ? <button className="tc-shot-card__play" type="button" onClick={onPlay} aria-label={`播放${item.label}`}>
              {item.label}<IconPlayerPlay className="tc-shot-card__play-icon" size={13} />
            </button>
            : item.label}</h3>
          {item.durationSeconds !== null && <span className="tc-shot-card__meta">{item.durationSeconds}s</span>}
        </div>
        {item.shotDesign.staging.some((diagram) => diagram.imageUrl) && <div className="tc-shot-card__staging" aria-label="站位图">
          {item.shotDesign.staging.map((diagram) => diagram.imageUrl
            ? <button className="tc-shot-card__staging-thumb" key={diagram.id} type="button" title={diagram.label}
              aria-label={`预览${diagram.label}`} onClick={() => onPreview(diagram)}>
              <ManagedImage className="tc-shot-card__staging-image" src={diagram.imageUrl} alt={diagram.label} ownerNodeId={diagram.id} priority="visible" />
            </button>
            : null)}
        </div>}
      </header>
      <p className="tc-shot-card__raw" style={expanded ? { maxHeight: 'none' } : undefined}>{item.text}</p>
      <button className="tc-shot-card__toggle" type="button" aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}>{expanded ? '收起' : '展开完整镜头脚本'}</button>
    </article>
  )
})
