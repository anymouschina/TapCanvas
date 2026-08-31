import React from 'react'
import { Loader, Paper, Text } from '@mantine/core'
import { getPendingUploads, useUploadRuntimeStore } from '../domain/upload-runtime/store/uploadRuntimeStore'

function formatPendingUploadSummary(fileNames: string[]): string {
  if (fileNames.length === 0) return ''
  if (fileNames.length === 1) return fileNames[0]
  if (fileNames.length === 2) return `${fileNames[0]}、${fileNames[1]}`
  return `${fileNames[0]}、${fileNames[1]} 等 ${fileNames.length} 个文件`
}

export default function PendingUploadsBar(): JSX.Element | null {
  useUploadRuntimeStore((state) => state.handlesById)
  const pendingUploads = getPendingUploads()

  if (pendingUploads.length === 0) return null

  const visibleNames = pendingUploads
    .slice()
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((item) => item.fileName)
    .slice(0, 3)

  const summary = formatPendingUploadSummary(visibleNames)

  return (
    <div
      className="pending-uploads-bar-shell"
      style={{
        position: 'fixed',
        // Center in the space between the left asset drawer and the right AI chat panel (same channel
        // as FloatingNav), so the bar re-centers when either side panel is open instead of staying
        // pinned to the full-viewport center.
        left: 'calc(50% + var(--tc-asset-drawer-width, 0px) / 2 - var(--tc-ai-chat-reserved-width, 0px) / 2)',
        bottom: 18,
        transform: 'translateX(-50%)',
        transition: 'left 220ms ease',
        zIndex: 1200,
        pointerEvents: 'none',
      }}
    >
      <Paper
        className="pending-uploads-bar-card"
        radius="md"
        p="sm"
        shadow="xl"
        style={{
          minWidth: 320,
          maxWidth: 'min(720px, calc(100vw - 32px))',
          background: 'rgba(17, 18, 21, 0.92)',
          border: '1px solid rgba(152, 158, 168, 0.28)',
          backdropFilter: 'blur(16px)',
          pointerEvents: 'auto',
        }}
      >
        <div
          className="pending-uploads-bar-content"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <Loader className="pending-uploads-bar-spinner" size="sm" color="gray" />
          <div
            className="pending-uploads-bar-copy"
            style={{
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <Text className="pending-uploads-bar-title" size="sm" fw={600} c="#eff6ff">
              {`正在上传 ${pendingUploads.length} 个本地文件`}
            </Text>
            <Text className="pending-uploads-bar-detail" size="xs" c="rgba(212, 215, 220, 0.92)" lineClamp={2}>
              {`${summary} 正在上传中。现在刷新、关闭页面或切换项目，图片可能暂时不会出现在当前画布里。`}
            </Text>
          </div>
        </div>
      </Paper>
    </div>
  )
}
