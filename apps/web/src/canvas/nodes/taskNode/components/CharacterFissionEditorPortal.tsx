import React from 'react'
import { createPortal } from 'react-dom'
import { Select, Textarea } from '@mantine/core'
import { IconArrowNarrowUp, IconX } from '@tabler/icons-react'
import { useStore } from '@xyflow/react'
import { selectNodesById, useRFStore } from '../../../store'
import {
  CHARACTER_FISSION_DIRECTIONS,
  CHARACTER_FISSION_VARIANT_COUNT,
  type CharacterFissionDirection,
  type CharacterFissionDraft,
} from '../characterFissionContract'

type CharacterFissionEditorPortalProps = Readonly<{
  nodeId: string
  nodeWidth: number
  nodeHeight?: number
  defaultHeight: number
  requiredGenerationCredits: number
  onClose: () => void
  onExecute: (draft: CharacterFissionDraft) => void
}>

export function CharacterFissionEditorPortal({
  nodeId,
  nodeWidth,
  nodeHeight,
  defaultHeight,
  requiredGenerationCredits,
  onClose,
  onExecute,
}: CharacterFissionEditorPortalProps): JSX.Element {
  const [panX, panY, zoom] = useStore((state) => state.transform)
  const position = useRFStore((state) => selectNodesById(state).get(nodeId)?.position)
  const [direction, setDirection] = React.useState<CharacterFissionDirection>('body_proportion')
  const [additionalPrompt, setAdditionalPrompt] = React.useState('')
  const nodeX = position?.x ?? 0
  const nodeY = position?.y ?? 0
  const effectiveNodeHeight = nodeHeight ?? defaultHeight
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
  const portalWidth = Math.min(664, Math.max(440, Math.min(nodeWidth * zoom, viewportWidth - 48)))
  const rawLeft = nodeX * zoom + panX + (nodeWidth * zoom - portalWidth) / 2
  const portalLeft = Math.max(24, Math.min(rawLeft, viewportWidth - portalWidth - 24))
  const belowTop = nodeY * zoom + panY + effectiveNodeHeight * zoom + 14
  const portalHeightEstimate = 220
  const aboveTop = nodeY * zoom + panY - portalHeightEstimate - 14
  const portalTop = belowTop + portalHeightEstimate <= viewportHeight - 24
    ? belowTop
    : Math.max(24, aboveTop)
  const totalCredits = requiredGenerationCredits > 0
    ? requiredGenerationCredits * CHARACTER_FISSION_VARIANT_COUNT
    : 0

  return createPortal(
    <>
      <button
        className="tc-character-fission-editor__intercept nodrag nopan"
        type="button"
        aria-label="关闭角色裂变编辑"
        onClick={onClose}
      />
      <section
        className="tc-character-fission-editor nodrag nopan"
        aria-label="角色裂变待生成编辑"
        style={{ left: portalLeft, top: portalTop, width: portalWidth }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="tc-character-fission-editor__header">
          <button
            className="tc-character-fission-editor__close"
            type="button"
            aria-label="取消角色裂变"
            onClick={onClose}
          >
            <IconX className="tc-character-fission-editor__close-icon" size={15} />
          </button>
          <div className="tc-character-fission-editor__title-block">
            <strong className="tc-character-fission-editor__title">角色裂变</strong>
            <span className="tc-character-fission-editor__meta">生成 {CHARACTER_FISSION_VARIANT_COUNT} 个独立候选，不覆盖母版</span>
          </div>
          {totalCredits > 0 ? (
            <span className="tc-character-fission-editor__credits" aria-label={`预计消耗 ${totalCredits} 积分`}>
              <span className="tc-character-fission-editor__credits-icon" aria-hidden="true">⚡</span>
              {totalCredits}
            </span>
          ) : null}
        </div>

        <div className="tc-character-fission-editor__fields">
          <Select
            className="tc-character-fission-editor__direction"
            label="裂变方向"
            data={CHARACTER_FISSION_DIRECTIONS.map((item) => ({ value: item.value, label: item.label }))}
            value={direction}
            onChange={(value) => {
              if (value) setDirection(value as CharacterFissionDirection)
            }}
            allowDeselect={false}
            withinPortal
          />
          <Textarea
            className="tc-character-fission-editor__prompt"
            label="附加提示词（可选）"
            placeholder={direction === 'body_proportion' ? '例如：从三头身到八头身，整体更偏少年感' : '补充你希望变化或必须保持的细节'}
            value={additionalPrompt}
            onChange={(event) => setAdditionalPrompt(event.currentTarget.value)}
            autosize
            minRows={1}
            maxRows={3}
          />
          <button
            className="tc-character-fission-editor__submit"
            type="button"
            aria-label="生成角色裂变候选"
            onClick={() => onExecute({ direction, additionalPrompt })}
          >
            <IconArrowNarrowUp className="tc-character-fission-editor__submit-icon" size={22} />
          </button>
        </div>
      </section>
    </>,
    document.body,
  )
}
