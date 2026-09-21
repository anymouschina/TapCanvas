import { useState } from 'react'
import { Button, Modal } from '@mantine/core'
import { ManagedImage } from '../../../../domain/resource-runtime'
import { readSubmissionInput } from '../submissionReferences'

/** The submitted prompt and image order are shown from one immutable snapshot. */
export function VideoSubmissionInput({ value }: { value: unknown }) {
  const [opened, setOpened] = useState(false)
  if (value === undefined) return null
  const input = readSubmissionInput(value)
  if (!input) return <div className="video-submission-input__div" role="status">本次请求输入记录不完整，无法核对参考图顺序。</div>
  return (
    <>
    <Button className="video-submission-input__button" variant="subtle" color="gray" size="compact-xs" onClick={() => setOpened(true)}>提交记录</Button>
    <Modal className="video-submission-input__modal" opened={opened} onClose={() => setOpened(false)} title="上次提交 · 参考图与提示词" size="lg" withinPortal>
    <div className="nodrag nopan" style={{ margin: '12px 0' }}>

      <div className="video-submission-input__div" style={{ fontSize: 12, opacity: 0.7, margin: '8px 0' }}>
        以下编号与本次请求提示词对应；修改上游连线不会改写这份记录。
      </div>
      <div className="video-submission-input__div" style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
        {input.images.map((image, index) => (
          <figure className="video-submission-input__figure" key={`${index}:${image.url}`} style={{ margin: 0, flex: '0 0 72px' }}>
            <ManagedImage className="video-submission-input__image" src={image.url} alt={image.label} style={{ width: 72, height: 72, objectFit: 'contain' }} />
            <figcaption className="video-submission-input__figcaption" title={image.label} style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: 72 }}>图 {index + 1} · {image.label}</figcaption>
          </figure>
        ))}
      </div>
      <pre className="video-submission-input__pre" style={{ whiteSpace: 'pre-wrap', maxHeight: 240, overflowY: 'auto', font: 'inherit', fontSize: 13 }}>
        {input.prompt}
      </pre>
    </div>
    </Modal>
    </>
  )
}
