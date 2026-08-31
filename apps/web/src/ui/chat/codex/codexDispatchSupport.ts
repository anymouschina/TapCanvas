import type {
  CodexCanvasScope,
  CodexPairingSession,
  CodexTask,
  CodexTaskState,
} from '@tapcanvas/codex-task-protocol'
import { isCodexTerminalTaskState } from '@tapcanvas/codex-task-protocol'

export type ChatExecutionTarget = 'agents' | 'codex'

export type PairingView = {
  session: CodexPairingSession
  prompt: string
  copied: boolean
}

export type DispatchAttempt = {
  signature: string
  idempotencyKey: string
}

export const TARGET_STORAGE_KEY = 'tapcanvas-chat-execution-target'
export const BRIDGE_STORAGE_KEY = 'tapcanvas-codex-bridge-id'
export const WORKSPACE_STORAGE_KEY = 'tapcanvas-codex-workspace-id'

export const STEERABLE_CODEX_TASK_STATES: ReadonlySet<CodexTaskState> = new Set([
  'queued',
  'claimed',
  'codex_running',
])

export function readStoredTarget(): ChatExecutionTarget {
  try {
    return localStorage.getItem(TARGET_STORAGE_KEY) === 'codex'
      ? 'codex'
      : 'agents'
  } catch {
    return 'agents'
  }
}

export function readStoredValue(key: string): string {
  try {
    return String(localStorage.getItem(key) || '').trim()
  } catch {
    return ''
  }
}

export function writeStoredValue(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
}

export function codexDispatchErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback
}

function quoteShellArgument(value: string): string {
  return `'${value.split("'").join("'\\''")}'`
}

export function buildCodexPairingPrompt(input: {
  pairingCode: string
  apiBaseUrl: string
  connectPackageUrl: string
  expiresAt: string
}): string {
  const command = [
    'npx',
    '-y',
    quoteShellArgument(input.connectPackageUrl),
    'pair',
    '--base-url',
    quoteShellArgument(input.apiBaseUrl),
    '--pairing-code',
    quoteShellArgument(input.pairingCode),
    '--workspace',
    '.',
  ].join(' ')
  return [
    '请把当前代码仓库连接为 TapCanvas 画布可派发的本地 Codex workspace。这是首次安装任务，请直接执行，不要只给说明。',
    '',
    '1. 先读取当前目录所有适用的 AGENTS.md、Design.md 和 package scripts，确认真实框架、包管理器、测试、构建、产物目录和预览命令。',
    '2. 创建 `.tapcanvas/codex-workspace.json`。必须使用下面的 version 1 契约，所有 commands 都是 argv 数组，禁止 shell 字符串、no-op、占位命令或猜测：',
    '   - id / label：当前 workspace 的稳定标识和名称',
    '   - commands.install / test / build / preview：仓库真实可执行命令',
    '   - outputDirectory / previewPort / previewReadyPath / previewReadyTimeoutMs：与真实项目一致',
    '   - remoteBuild：`{"provider":"vercel-sandbox","runtime":"node24","timeoutMs":1800000,"vcpus":2}`',
    '   - environmentVariables：只列构建确实要求的环境变量名，不写入值',
    '   - localDocker 可省略；只有本机 Docker 可用且能给出不可变 `@sha256:` 镜像 digest 时才配置，禁止浮动 tag',
    '   如果无法从仓库事实确认任一关键命令或产物目录，请明确说明缺失事实并停止，不得生成假配置。',
    '3. 配置完成后运行下面这条一次性命令。不要打印、转述或持久化配对码；安装器会把专用密钥以 0600 权限保存在本机，并安装 TapCanvas MCP、Codex Skill 和常驻 Bridge：',
    '',
    command,
    '',
    `配对码在 ${input.expiresAt} 失效且只能使用一次。`,
    '4. 等命令明确显示 Bridge 已在线后再结束，并报告 workspace id、真实验证命令和常驻服务状态。',
  ].join('\n')
}

export async function copyCodexPairingPrompt(value: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('当前浏览器不允许直接写入剪贴板，请手动复制下方安装任务')
  }
  await navigator.clipboard.writeText(value)
}

export function codexTaskSignature(input: {
  kind: 'task' | 'steering'
  goal: string
  context: CodexCanvasScope
  activeTaskId: string | null
}): string {
  return JSON.stringify(input)
}

function hasSameCanvasScope(
  task: CodexTask,
  context: CodexCanvasScope,
): boolean {
  return (
    task.context.projectId === context.projectId &&
    task.context.flowId === context.flowId &&
    task.context.chapterId === context.chapterId
  )
}

function hasSameSelectedNodes(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const leftIds = new Set(left)
  const rightIds = new Set(right)
  if (leftIds.size !== rightIds.size) return false
  return [...leftIds].every((nodeId) => rightIds.has(nodeId))
}

export function hasSameCodexTurnContext(input: {
  task: CodexTask
  context: CodexCanvasScope
}): boolean {
  return (
    hasSameCanvasScope(input.task, input.context) &&
    input.task.context.canvasRevision === input.context.canvasRevision &&
    hasSameSelectedNodes(
      input.task.context.selectedNodeIds,
      input.context.selectedNodeIds,
    )
  )
}

export function hasSameCodexDispatchTarget(input: {
  task: CodexTask
  bridgeId: string
  workspaceId: string
}): boolean {
  return (
    input.task.bridgeId === input.bridgeId &&
    input.task.workspaceId === input.workspaceId
  )
}

export function filterCodexTasksForTarget(input: {
  tasks: CodexTask[]
  projectId: string
  bridgeId: string
  workspaceId: string
  sessionId?: string | null
  ownerNodeId?: string | null
}): CodexTask[] {
  return input.tasks.filter((task) => (
    task.context.projectId === input.projectId &&
    (!input.bridgeId || task.bridgeId === input.bridgeId) &&
    (!input.workspaceId || task.workspaceId === input.workspaceId) &&
    (input.sessionId
      ? task.sessionId === input.sessionId
      : input.ownerNodeId
        ? task.context.selectedNodeIds.includes(input.ownerNodeId)
        : true)
  ))
}

export function resolveCodexContinuationTask(input: {
  tasks: CodexTask[]
  context: CodexCanvasScope
  bridgeId: string
  workspaceId: string
}): CodexTask | null {
  return [...input.tasks]
    .sort((left, right) => right.turnSequence - left.turnSequence)
    .find((task) => (
      isCodexTerminalTaskState(task.state) &&
      hasSameCodexDispatchTarget({
        task,
        bridgeId: input.bridgeId,
        workspaceId: input.workspaceId,
      }) &&
      hasSameCanvasScope(task, input.context) &&
      Boolean(task.deliveryEvidence.codex?.threadId)
    )) || null
}

export function shouldRetainCodexDispatchAttempt(error: unknown): boolean {
  if (!error || typeof error !== 'object') return true
  const status =
    'status' in error && typeof error.status === 'number'
      ? error.status
      : 0
  const code =
    'code' in error && typeof error.code === 'string'
      ? error.code
      : ''
  if (code === 'codex_invalid_json_response') return true
  if (status <= 0) return true
  return status >= 500
}
