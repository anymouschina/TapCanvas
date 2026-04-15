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
        left: '50%',
        bottom: 18,
        transform: 'translateX(-50%)',
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
          background: 'rgba(15, 23, 42, 0.92)',
          border: '1px solid rgba(96, 165, 250, 0.28)',
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
          <Loader className="pending-uploads-bar-spinner" size="sm" color="blue" />
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
            <Text className="pending-uploads-bar-detail" size="xs" c="rgba(226, 232, 240, 0.92)" lineClamp={2}>
              {`${summary} 正在上传中。现在刷新、关闭页面或切换项目，图片可能暂时不会出现在当前画布里。`}
            </Text>
          </div>
        </div>
      </Paper>
    </div>
  )
}
