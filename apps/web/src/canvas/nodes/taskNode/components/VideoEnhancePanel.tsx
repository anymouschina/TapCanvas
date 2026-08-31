import * as React from 'react'
import { Button, Group, Modal, NumberInput, SegmentedControl, Select, Stack, Text } from '@mantine/core'

export type EnhanceParams = {
  tool_version: 'standard' | 'professional'
  scene: 'aigc' | 'short_series' | 'ugc' | 'old_film'
  resolution?: '720p' | '1080p' | '4k'
  resolution_limit?: number
  fps?: number
}

type ResolutionMode = 'preset' | 'limit'

type Props = {
  onRun: (p: EnhanceParams) => void
  onClose: () => void
}

export function VideoEnhancePanel({ onRun, onClose }: Props) {
  const [toolVersion, setToolVersion] = React.useState<'standard' | 'professional'>('standard')
  const [scene, setScene] = React.useState<'aigc' | 'short_series' | 'ugc' | 'old_film'>('aigc')
  const [resolutionMode, setResolutionMode] = React.useState<ResolutionMode>('preset')
  const [resolution, setResolution] = React.useState<'720p' | '1080p' | '4k'>('1080p')
  const [resolutionLimit, setResolutionLimit] = React.useState<number>(1080)
  const [fps, setFps] = React.useState<number | undefined>(undefined)

  const handleRun = () => {
    const p: EnhanceParams = {
      tool_version: toolVersion,
      scene,
    }
    if (resolutionMode === 'preset') {
      p.resolution = resolution
    } else {
      p.resolution_limit = resolutionLimit
    }
    if (fps !== undefined && fps > 0) {
      p.fps = fps
    }
    onRun(p)
  }

  return (
    <Modal
      opened
      onClose={onClose}
      centered
      title="视频画质增强"
      size={360}
      radius="md"
      zIndex={10200}
      overlayProps={{ backgroundOpacity: 0.58, blur: 2 }}
      classNames={{ root: 'tc-task-node__video-enhance-modal' }}
      styles={{
        content: {
          width: 'min(360px, calc(100vw - 32px))',
          maxWidth: 'calc(100vw - 32px)',
          background: 'rgba(17,18,21,0.98)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.42)',
        },
        header: {
          background: 'transparent',
          color: '#fff',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        },
        title: { color: '#fff', fontWeight: 600, fontSize: 15 },
        body: {
          maxHeight: 'min(680px, calc(100vh - 150px))',
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          padding: 14,
        },
        close: { color: 'rgba(255,255,255,0.62)' },
      }}
    >
      <Stack gap={10}>

        {/* 版本 */}
        <div>
          <Text size="xs" c="dimmed" mb={4}>
            版本
          </Text>
          <SegmentedControl
            size="xs"
            value={toolVersion}
            onChange={(v) => setToolVersion(v as 'standard' | 'professional')}
            data={[
              { value: 'standard', label: '标准' },
              { value: 'professional', label: '专业' },
            ]}
            styles={{ root: { background: 'rgba(255,255,255,0.08)' } }}
          />
        </div>

        {/* 场景 */}
        <div>
          <Text size="xs" c="dimmed" mb={4}>
            场景
          </Text>
          <Select
            size="xs"
            value={scene}
            onChange={(v) => v && setScene(v as EnhanceParams['scene'])}
            comboboxProps={{ withinPortal: true }}
            data={[
              { value: 'aigc', label: 'AIGC 视频' },
              { value: 'short_series', label: '短剧' },
              { value: 'ugc', label: 'UGC 视频' },
              { value: 'old_film', label: '老电影' },
            ]}
            styles={{
              input: { background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' },
            }}
          />
        </div>

        {/* 分辨率模式切换 */}
        <div>
          <Text size="xs" c="dimmed" mb={4}>
            分辨率
          </Text>
          <SegmentedControl
            size="xs"
            value={resolutionMode}
            onChange={(v) => setResolutionMode(v as ResolutionMode)}
            data={[
              { value: 'preset', label: '预设档位' },
              { value: 'limit', label: '短边像素' },
            ]}
            styles={{ root: { background: 'rgba(255,255,255,0.08)' } }}
          />
        </div>

        {resolutionMode === 'preset' ? (
          <SegmentedControl
            size="xs"
            value={resolution}
            onChange={(v) => setResolution(v as '720p' | '1080p' | '4k')}
            data={[
              { value: '720p', label: '720p' },
              { value: '1080p', label: '1080p' },
              { value: '4k', label: '4K' },
            ]}
            styles={{ root: { background: 'rgba(255,255,255,0.08)' } }}
          />
        ) : (
          <NumberInput
            size="xs"
            label="短边最大像素（64–2160）"
            value={resolutionLimit}
            onChange={(v) => setResolutionLimit(typeof v === 'number' ? Math.min(2160, Math.max(64, v)) : 1080)}
            min={64}
            max={2160}
            step={1}
            styles={{
              input: { background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' },
              label: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
            }}
          />
        )}

        {/* 帧率（可选） */}
        <NumberInput
          size="xs"
          label="目标帧率（可选，≤120）"
          placeholder="不填则保持原帧率"
          value={fps ?? ''}
          onChange={(v) => setFps(typeof v === 'number' && v > 0 ? Math.min(120, v) : undefined)}
          min={1}
          max={120}
          step={1}
          styles={{
            input: { background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' },
            label: { color: 'rgba(255,255,255,0.6)', fontSize: 11 },
          }}
        />

        <Group justify="flex-end" gap={8} mt={4}>
          <Button variant="subtle" color="gray" size="xs" onClick={onClose}>
            取消
          </Button>
          <Button size="xs" onClick={handleRun}>
            开始增强
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
