import React from 'react'
import { createPortal } from 'react-dom'
import { ActionIcon, Alert, Box, Group, Loader, Text, Tooltip } from '@mantine/core'
import { IconAlertTriangle, IconX } from '@tabler/icons-react'
import { agentsChatStream, type AgentsChatRequestDto } from '../../../api/server'
import { useModelOptionsState } from '../../../config/useModelOptions'
import { resolveSelectedChatModelRequest } from '../../../ui/chat/chatModelSelection'
import { useUIStore } from '../../../ui/uiStore'
import { createDirectorDeskHost, type DirectorDeskChannel } from './directorDeskHost'
import './DirectorDeskFrame.css'

/**
 * 导演台静态子应用的入口，与 apps/director-desk/vite.config.ts 的 base 一致。
 *
 * 必须显式带 index.html：目录形式 /director-desk/ 会被 Web 开发服务器的 SPA fallback
 * 命中并返回 TapCanvas 自身的 index.html，iframe 里就会渲染出整个主应用。
 */
export const DIRECTOR_DESK_ENTRY = '/director-desk/index.html'

type DeskProbe = { state: 'ok' } | { state: 'missing'; detail: string }

/**
 * 探测导演台构建产物是否存在。
 *
 * 产物由 apps/web 的 predev / prebuild 生成；缺失时 iframe 只会显示一个 404 页面，
 * 所以这里先显式判定并把原因暴露给用户，不做静默兜底。
 */
async function probeDeskBundle(signal: AbortSignal): Promise<DeskProbe> {
  try {
    const res = await fetch(DIRECTOR_DESK_ENTRY, { method: 'HEAD', signal })
    if (!res.ok) return { state: 'missing', detail: `导演台构建产物不可用（HTTP ${res.status}）` }
    return { state: 'ok' }
  } catch (error) {
    if (signal.aborted) throw error
    return { state: 'missing', detail: `导演台构建产物请求失败：${(error as Error).message}` }
  }
}

function DeskLoading({ label }: { label: string }) {
  return (
    <Group className="tc-director-desk__state" gap={8} justify="center" role="status" aria-live="polite" aria-busy="true">
      <Loader size="xs" aria-hidden="true" />
      <Text className="tc-director-desk__state-text" size="xs">
        {label}
      </Text>
    </Group>
  )
}

/**
 * 全屏承载导演台，并把它的 AI 面板接到 TapCanvas 的 AI 对话链路。
 *
 * 同源 iframe：导演台是独立 Vite 应用，运行在自己的文档里；画布负责入口、生命周期，
 * 以及作为宿主回答导演台的 `window.directorDesktop` 请求（模型目录、对话、技能）。
 * 顶部只保留一条极简控制条与关闭按钮——导演台自带菜单栏，不在这里重复标题与操作。
 */
export function DirectorDeskFrame({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const [probe, setProbe] = React.useState<DeskProbe | null>(null)
  const [frameReady, setFrameReady] = React.useState(false)
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const currentProjectId = useUIStore((s) => s.currentProject?.id ?? '')
  const currentFlowId = useUIStore((s) => s.currentFlow?.id ?? '')
  const { options: modelOptions, loading: modelsLoading } = useModelOptionsState('text')

  const channels = React.useMemo<DirectorDeskChannel[]>(
    () => modelOptions.map((option) => ({
      id: option.value,
      name: option.label,
      protocol: 'chat',
      baseUrl: '',
      model: option.modelAlias || option.modelKey || option.value,
      hasKey: true,
      remembered: true,
      stream: true,
      maxTokens: 0,
      maxRounds: 0,
    })),
    [modelOptions],
  )

  const hostRef = React.useRef<ReturnType<typeof createDirectorDeskHost> | null>(null)

  React.useEffect(() => {
    const controller = new AbortController()
    setProbe(null)
    setFrameReady(false)
    void probeDeskBundle(controller.signal)
      .then((next) => { if (!controller.signal.aborted) setProbe(next) })
      .catch(() => { /* abort：组件已卸载，不再更新状态 */ })
    return () => controller.abort()
  }, [])

  // 导演台全屏期间把画布右侧对话抽屉抬到其之上，复用同一条抽屉。
  React.useEffect(() => {
    document.body.classList.add('tc-director-console-open')
    return () => { document.body.classList.remove('tc-director-console-open') }
  }, [])

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // 宿主用 ref 读取最新值：桥接回调在 iframe 的事件里触发，不随 React 渲染重建。
  const depsRef = React.useRef({ channels, modelOptions, currentProjectId, currentFlowId, nodeId })
  depsRef.current = { channels, modelOptions, currentProjectId, currentFlowId, nodeId }

  React.useEffect(() => {
    const host = createDirectorDeskHost({
      get channels() { return depsRef.current.channels },
      resolveModelRequest: (channelId) => {
        const option = depsRef.current.modelOptions.find((item) => item.value === channelId) ?? null
        return resolveSelectedChatModelRequest(option)
      },
      runChat: ({ prompt, modelRequest, onEvent, onSettled }) => {
        const { currentProjectId: projectId, currentFlowId: flowId } = depsRef.current
        let stop: (() => void) | null = null
        let settled = false
        const settle = (error?: Error) => {
          if (settled) return
          settled = true
          onSettled(error)
        }
        // 导演台的场景工具是项目作用域的画布能力。没有项目作用域时，网关只会给出
        // 一个不含任何画布工具的回合，模型必然卡在“工具不在能力面”的空转里。
        // 与其派发一个不可能完成的请求，不如当场如实说明缺什么。
        if (!projectId) {
          settle(new Error('导演台需要在大模型项目画布内使用：当前没有可解析的项目作用域，无法读取或操作场景。请先打开一个项目再发起对话。'))
          return () => {}
        }
        const payload: AgentsChatRequestDto = {
          vendor: 'agents',
          prompt,
          stream: true,
          // 每轮唯一幂等键：与画布主对话同约定，重试同一轮不会重复受理。
          clientPendingId: `m_director_${depsRef.current.nodeId}_${Date.now()}`,
          // 导演台面板有自己的对话线：按节点隔离，不并入画布主对话历史。
          sessionKey: `director-desk:${depsRef.current.nodeId}`,
          canvasNodeId: depsRef.current.nodeId,
          chatContext: { selectedNodeKind: 'directorConsole', selectedNodeLabel: '导演台' },
          ...(projectId ? { canvasProjectId: projectId } : {}),
          ...(flowId ? { canvasFlowId: flowId } : {}),
          ...(modelRequest.field === 'modelKey' ? { modelKey: modelRequest.model } : { modelAlias: modelRequest.model }),
        }
        void agentsChatStream(payload, {
          onEvent: (event) => {
            onEvent(event)
            if (event.event === 'result' || event.event === 'error') settle()
          },
          onError: (error) => settle(error),
        }).then(
          (abort) => { stop = abort },
          (error: unknown) => settle(error instanceof Error ? error : new Error(String(error))),
        )
        return () => { stop?.(); settle() }
      },
      canvasNodeId: nodeId,
      get currentProjectId() { return depsRef.current.currentProjectId || undefined },
    })
    hostRef.current = host
    return () => {
      hostRef.current = null
      host.detach()
    }
  }, [nodeId])

  const handleFrameLoad = React.useCallback(() => {
    setFrameReady(true)
    const frame = iframeRef.current
    if (frame) hostRef.current?.attach(frame)
  }, [])

  return createPortal(
    <Box className="tc-director-desk">
      <Group className="tc-director-desk__bar" justify="flex-end" gap={4} wrap="nowrap">
        {modelsLoading ? (
          <Text className="tc-director-desk__state-text" size="xs">
            AI 模型目录读取中…
          </Text>
        ) : null}
        <Tooltip label="关闭导演台 (Esc)" position="bottom-end" withArrow>
          <ActionIcon
            className="tc-director-desk__close"
            variant="subtle"
            color="gray"
            size="sm"
            radius="xs"
            aria-label="关闭导演台"
            onClick={onClose}
          >
            <IconX size={15} />
          </ActionIcon>
        </Tooltip>
      </Group>

      <Box className="tc-director-desk__body">
        {probe?.state === 'missing' ? (
          <Box className="tc-director-desk__state tc-director-desk__state--error">
            <Alert
              className="tc-director-desk__alert"
              variant="light"
              color="red"
              title={probe.detail}
              icon={<IconAlertTriangle size={18} />}
            >
              请先执行 <code>npm --prefix apps/director-desk install</code> 与{' '}
              <code>npm --prefix apps/director-desk run build</code>。
            </Alert>
          </Box>
        ) : null}

        {probe === null ? <DeskLoading label="正在打开导演台…" /> : null}

        {probe?.state === 'ok' ? (
          <>
            <iframe
              ref={iframeRef}
              className="tc-director-desk__iframe"
              title="导演台"
              src={DIRECTOR_DESK_ENTRY}
              onLoad={handleFrameLoad}
              allow="fullscreen; clipboard-write"
            />
            {frameReady ? null : <DeskLoading label="正在加载导演台…" />}
          </>
        ) : null}
      </Box>
    </Box>,
    document.body,
  )
}

export default DirectorDeskFrame
