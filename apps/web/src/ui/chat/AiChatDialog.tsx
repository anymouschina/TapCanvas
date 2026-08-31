import React from 'react'
import { ActionIcon, Badge, Button, Group, Menu, Modal, Paper, Popover, ScrollArea, Select, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { IconArrowsMaximize, IconArrowsMinimize, IconBook2, IconChevronDown, IconChevronLeft, IconChevronRight, IconFileText, IconHistory, IconMapPin, IconMessageCircle, IconMessagePlus, IconMicrophone, IconMicrophoneOff, IconPaperclip, IconPhoto, IconPhotoCog, IconPlayerStop, IconRefresh, IconSend2, IconSparkles, IconTerminal2, IconTrash, IconUpload, IconUsersGroup, IconX } from '@tabler/icons-react'
import { GenerationPrefsModal } from './GenerationPrefsModal'
import { SkillPickerPopover } from './SkillPickerPopover'
import {
  PendingUserInputChoices,
  type PendingUserInputAnswer,
} from './PendingUserInputChoices'
import ChatQueueDock, { type ChatQueuedItem } from './ChatQueueDock'
import { projectChatQueue } from './chatQueueProjection'
import { useSkillLibraryData } from '../skills/useSkillLibraryData'
import { loadGenerationPrefs } from '../../config/generationPrefs'
import ReactMarkdown from 'react-markdown'
import { createStreamingTextBuffer } from './streamingTextBuffer'
import remarkGfm from 'remark-gfm'

// 全量 GFM 支持：表格 / 删除线 / 任务列表 / 裸链接自动成链。
// 不接 remark-gfm 时 react-markdown 只解析 CommonMark，竖线表格语法会原样当普通文本，
// 表格分镜表/镜头列表全揉成一坨 —— 这正是「流式对话格式太乱」的根因。
const CHAT_REMARK_PLUGINS = [remarkGfm]
import {
  normalizeStoryboardSelectionContext,
  type StoryboardSelectionContext,
} from '@tapcanvas/storyboard-selection-protocol'
import { $ } from '../../canvas/i18n'
import {
  API_BASE,
  agentsChatStream,
  enqueueAgentsChatMessage,
  interruptAgentsChatTurn,
  cancelProjectVideoRuns,
  createMaterialAsset,
  getServerFlow,
  getMemoryContext,
  llmAuxiliaryChat,
  listProjectMaterials,
  listProjectChatSessions,
  searchMemoryEntries,
  updateProjectWorkspaceContextFile,
  writeMemoryEntries,
  type AgentsChatRequestDto,
  type AgentsChatToolStreamPayload,
  uploadServerAssetFile,
  type ChatSessionSummaryDto,
  type MemoryConversationItemDto,
  type AgentsChatResponseDto,
} from '../../api/server'
import { toast } from '../toast'
import { TapCanvasMark } from '../brand/TapCanvasMark'
import { resolveNonOverlappingPosition, useRFStore } from '../../canvas/store'
import { isImageKind } from '../../canvas/utils/edgeRules'
import { collectCanvasMediaUrlKeys, isMediaUrlOnCanvas } from './assistantAssetDedupe'
import type { Node } from '@xyflow/react'
import { useUIStore } from '../uiStore'
import { useLiveChatRunStore } from './liveChatRunStore'
import { useChatActivityStore } from './chatActivityStore'
import { isTerminalRunState, useVideoRunStore } from '../../runner/videoRunStore'
import {
  AsyncProductionProgress,
  resolveAsyncArtifactProgress,
  resolveAsyncProductionProgress,
  resolvePhysicalExecutionProgress,
  resolveVideoProductionWorkflowNode,
  shouldAutoDismissAsyncProductionProgress,
  shouldAwaitFirstVideoRunStatus,
  TERMINAL_PRODUCTION_PROGRESS_AUTO_DISMISS_MS,
} from './AsyncProductionProgress'
import { selectAgentTodoItems } from './chatAgentTodo'
import { useToolProgressStore, selectToolProgress, formatBatchProgressLabel } from '../../canvas/toolProgressStore'
import { formatAgentsStreamErrorMessage } from './agentsStreamError'
import { selectNewBroadcastChatMessages } from './chatBroadcastMessageMerge'
import {
  bindAcceptedTurnMessageIds,
  buildRecoveredChatMessageIds,
  canStartVerifiedChatTurn,
  formatRecoveredChatTurnSummary,
  isContinuingChatTurn,
  isRevokableChatTurn,
  isLocallySettledTurnMessage,
  isChatTurnStateUncertain,
  reconcileRecoveredProgressMessages,
  projectRecoveredFailedTurnMessage,
  removeTrailingHistoryAssistantMessagesForNonterminalTurn,
  resolveRecoveredChatTurnTerminalText,
  shouldQueueAfterAuthoritativeAdmission,
  shouldReconcileLocalTurnFromDurableStatus,
  shouldQueueIntoRecoveredTurn,
  shouldTerminateChatTurnForStreamError,
  terminalChatMessageKind,
} from './chatTurnRecovery'
import { isChatTurnResumeError, useChatTurnRecovery } from './useChatTurnRecovery'
import {
  canSubmitChatComposer,
  shouldAwaitChatSubmissionReadiness,
  type ChatSubmissionOrigin,
} from './chatSubmissionAdmission'
import { recoverAcceptedChatTurnAfterTransportLoss } from './durableChatTransportRecovery'
import { resolveChatInterruptPresentation } from './chatInterruptPresentation'
import { executeCanvasPlan, parseCanvasPlanFromReply } from './canvasPlan'
import { autoRunAiChatCanvasNodes, autoRunAiChatPatchedCanvasNodes } from './autoRunCanvasNodes'
import { resolveAiChatReloadAutoRunPlan } from './canvasMutation'
import { resolveChatCanvasInsertionScope } from './canvasInsertion'
import { resolveLiveCanvasBinding } from './canvasBinding'
import {
  buildEffectiveChatSessionKey,
  buildProjectScopedChatSessionBaseKey,
  createChatSessionBaseKey,
  getChatSessionConversationScope,
  isProjectOnlyChatSessionScope,
  isSameChatConversationScope,
  persistChatSessionBaseKey,
  persistScopedChatSessionBaseKey,
  readOrCreateChatSessionBaseKey,
  resolveChatSessionLane,
  resolveLiveChatSessionScope,
  resolveRestoredBaseKey,
  shouldPreserveOwnedChatScopeTransition,
  type ChatSessionLane,
} from './chatSessionKey'
import {
  buildSelectedImageAssetInputs,
  resolveChatRequestExecution,
  type ChatAssetInput,
  type ChatAssetInputRole,
} from './chatRequestPayload'
import {
  formatChatTurnVerdictSummary,
  formatTurnVerdictSummary,
  isFailedChatTurn,
  resolveAssistantReplyText,
  readChatTurnVerdict,
  resolveChatTerminalProjection,
  resolveTerminalReply,
  shouldAutoAddAssistantAssetsToCanvas,
  shouldShowMissingCanvasPlanError,
} from './replyDisposition'
import {
  isDeferredChatToolStep,
  replaceDeferredToolStep,
  resolveDeferredToolSteps,
  type DeferredChatToolStep,
} from './chatFailureProjection'
import { buildChatInspirationQuickActions, type ChatQuickActionPreset } from './quickActions'
import { shouldAttachSelectedCanvasAssets } from './chatRequestAssetScope'
import { useChatCommandStore, type ChatSendCommand, type GenerationProposalContext } from './chatCommandStore'
import { XIAOT_ROLE, TEAM_ROLES, getTeamRole, teamRoleAvatar, teamRoleName, type TeamRole } from './teamRoster'
import { getProjectRoleSkillAssignments, useProjectRoleSkillConfigStore } from './roleSkillConfigStore'
import { chapterOverrideToChatContext } from '../../projects/chapterCreative'
import { useVoiceInput } from './useVoiceInput'
import { PanelCard } from '../PanelCard'
import { AppErrorBoundary } from '../AppErrorBoundary'
import {
  getNodeProductionMeta,
  resolveChapterGroundedProductionMetadataForNode,
} from '../../canvas/productionMeta'
import {
  normalizePublicFlowAnchorBindings,
  type PublicFlowAnchorBinding,
} from '@tapcanvas/flow-anchor-bindings'
import {
  resolvePrimarySemanticAnchorBinding,
  resolveSemanticNodeAnchorBindings,
  resolveSemanticNodeRoleBinding,
} from '../../canvas/utils/semanticBindings'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import { HOSTED_IMAGE_HOSTS } from '../../domain/resource-runtime/services/imageUrlTransform'
import { useSseChatStore } from '../../canvas/sync/sseChatStore'
import { takeHomePendingPrompt } from '../../utils/homePendingPrompt'
import { useAuth } from '../../auth/store'
import type { ContentBlock } from './blocks/types'
import { emptyBlockState, reconcileBlocks, toOrderedBlocks } from './blocks/reconcile'
import { BlockList, blocksHaveMedia } from './blocks/BlockList'
import { MediaItemView } from './blocks/MediaBlockView'
import { extractTcCardBlocks, mergeInlineCardBlocks } from './blocks/tcCard'
import { extractChoicesCardBlocks, supersedeStaleChoices, trimDanglingChoices } from './blocks/choicesCard'
import { markdownNodeHasImage } from './markdownNesting'
import { terminalizeInterruptedTodos, terminalizeOpenTodos } from './todoLifecycle'
import {
  buildAgentContinuationSummary,
  buildToolProgressSummary,
  buildToolStepSummary,
  readPresentedToolName,
  resolvePresentedToolName,
  type PresentedToolStatus,
} from './toolStepPresentation'
import { resolveChatExecutionStage } from './chatExecutionStage'
import {
  toExternalChatSkillReference,
  toSystemChatSkillReference,
  buildChatReferenceDocuments,
  type ChatReferenceDocuments,
  resolveChatSkillToolLabel,
  type ChatSkillReference,
} from './chatSkillReference'
import {
  persistChatModelValue,
  readStoredChatModelValue,
  resolveSelectedChatModelRequest,
  toAgentsChatModelPayload,
} from './chatModelSelection'
import {
  bindChatSessionLanguageModel,
  buildSessionTitleLlmRequest,
  isSessionTitleEligibleAssistantMessage,
  readChatSessionLanguageModel,
  readChatSessionTitle,
  reconcileChatSessionTitleGenerationState,
  sanitizeSessionTitle,
  shouldBindChatSessionLanguageModel,
  writeChatSessionTitle,
  type ChatSessionTitleGenerationState,
} from './chatSessionTitle'
import { mergeLoadedHistoryWithLocalMessages } from './chatMessageHistoryMerge'
import { resolveChatHistorySelection } from './chatHistoryArchive'
import {
  extractTextFiles,
  extractTextFromFile,
  buildImportedTextBlock,
  SUPPORTED_TEXT_ACCEPT,
} from './textFileImport'
import { findModelOptionByIdentifier, useModelOptionsState } from '../../config/useModelOptions'
import { stopPanelWheelPropagation } from '../utils/panelWheel'
import {
  persistCodexCanvasBeforeDispatch,
  type PersistedCodexCanvasScope,
} from './codex/codexCanvasPersistence'
import { buildCodexTimeline } from './codex/codexConversation'
import { useCodexDispatch } from './codex/useCodexDispatch'

const SkillLibraryDialog = React.lazy(() => import('../skills/SkillLibraryDialog').then((module) => ({
  default: module.SkillLibraryDialog,
})))

type ChatRole = 'assistant' | 'user'

function readCodexCanvasSelection(): {
  selectedNodeIds: string[]
} {
  const selectedNodeIds: string[] = []
  for (const node of useRFStore.getState().nodes) {
    if (!node.selected) continue
    selectedNodeIds.push(node.id)
  }
  return { selectedNodeIds }
}

type ChatMessage = {
  id: string
  /**
   * 稳定的渲染身份：onOpen 时消息 id 会从临时 m_user_ 与 m_ai_pending_ 前缀重绑为
   * turnId 派生的稳定 id（用于与历史/广播去重），若直接以 id 作 React key 会整卡
   * 重挂载 → ChatTaskPlan 折叠状态丢失、滚动抖动。localKey 在创建时固定，重绑后
   * 仍保留，作为渲染 key 的唯一身份（历史/恢复消息无此字段，回退用稳定 id）。
   */
  localKey?: string
  role: ChatRole
  content: string
  ts: string
  source?: 'agents' | 'codex'
  phase?: 'thinking' | 'final'
  kind?: 'progress' | 'result' | 'error'
  assets?: AssistantAsset[]
  /** 本轮工具调用的结构化步骤（挂在任务清单子级渲染） */
  toolSteps?: ChatToolStep[]
  turnVerdict?: {
    status: 'satisfied' | 'partial' | 'failed'
    reasons: string[]
  }
  diagnosticFlags?: Array<{
    code: string
    severity: 'high' | 'medium'
    title: string
    detail: string
  }>
  /** Only a verified succeeded user turn may trigger silent title metadata. */
  logicalTaskStatus?: 'active' | 'waiting_input' | 'waiting_external' | 'succeeded' | 'failed' | 'cancelled'
  todoSnapshot?: ChatTodoItem[]
  pendingUserInput?: {
    requestId: string
    questions: Array<{
      id: string
      header: string
      question: string
      options: Array<{ label: string; description?: string; imageUrl?: string; thumbnailUrl?: string }>
    }>
  }
  blocks?: ContentBlock[]
  suggestions?: string[]
  /** 本轮参与工作的流水线角色子 agent（分镜师/生成师/剪辑师/后期），按 agentId 去重 */
  workingRoles?: ChatWorkingRole[]
  /** 本轮耗时（毫秒）：从你发出这条消息到小T最终回复完成的总墙钟时间 */
  turnDurationMs?: number
  /** 发起该轮主对话时的精确语言模型键；标题等派生语言调用必须继承它。 */
  languageModel?: string
  /** 本轮实际读取的 Skill / Knowledge 文档；仅来自结构化 provenance。 */
  referenceDocuments?: ChatReferenceDocuments
  /** 显式有界工作流身份；用于从权威定义投影聊天 Todo，禁止从消息文案猜测。 */
  workflowKey?: string
  /** 运行中回合排队消息的模式（m_user_queued_* 本地投影的元数据）。 */
  queuedMode?: 'steering' | 'follow_up'
}

type ArchivedConversationView = Readonly<{
  sessionKey: string
  title: string
  messages: ChatMessage[]
}>

type ChatWorkingRole = {
  agentId: string
  role: string
  roleName: string
  status: 'queued' | 'running' | 'idle' | 'completed' | 'failed' | 'closed'
  progressSummary?: string
  at?: string
}

// 角色头像 → 见 teamRoster.ts（与 agents-cli agent-definitions 的 name / agent_role SSE role 对齐）。
// 旧的 emoji 图标表已由 gpt-image-2 生成的角色立绘头像取代。

const CHAT_STREAM_ABORT_ERROR = '__tapcanvas_ai_chat_aborted__'
const CHAT_ABORTED_MESSAGE = '已中断本次对话。'
const AUTO_SCROLL_BOTTOM_THRESHOLD_MIN_PX = 72
const AUTO_SCROLL_BOTTOM_THRESHOLD_MAX_PX = 160
const AUTO_SCROLL_BOTTOM_THRESHOLD_RATIO = 0.18

type SendOptions = {
  /** Composer clicks use already-rendered admission facts; background commands may wait for them. */
  origin?: ChatSubmissionOrigin
  text?: string
  displayText?: string
  skill?: ChatSkillReference | null
  /** Explicitly starts a new logical task in a newly rotated conversation. */
  freshConversation?: boolean
  attachCanvasContext?: boolean
  requiredSkills?: string[]
	executionToolPolicy?: AgentsChatRequestDto['executionToolPolicy']
	canvasNodeId?: string
  forcedAgentRole?: string
  allowedSubagentTypes?: string[]
  requireAgentsTeamExecution?: boolean
  creativePhaseOverride?: 'prep' | 'writing'
  onFinalReply?: (reply: string) => Promise<void>
  workflowKey?: string
  requestedWorkflowExecutionVariant?: 'full_video' | 'first_video'
  generationProposal?: GenerationProposalContext
}

type UploadedReferenceAssetMeta = {
  nodeId?: string
  assetId?: string
  assetRefId?: string
  name?: string
}

type ProjectTextMaterialState = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  count: number
  error: string
}

type InspirationQuickAction = ChatQuickActionPreset & {
  skill: ChatSkillReference | null
}

const AI_CHAT_LAYOUT_PREFERENCE_STORAGE_KEY = 'tapcanvas.aiChat.layoutPreference.v1'
const CREATIVE_PHASE_CACHE_KEY = 'tapcanvas.creativePhase.v1'
const CREATIVE_BRIEF_CONFIRMED_TAG = 'creative-brief-confirmed'

function readCachedCreativePhase(projectId: string | null): 'prep' | 'writing' | null {
  if (!projectId || typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(`${CREATIVE_PHASE_CACHE_KEY}.${projectId}`) === 'writing' ? 'writing' : null
  } catch { return null }
}

function setCachedCreativePhase(projectId: string | null, phase: 'prep' | 'writing') {
  if (!projectId || typeof window === 'undefined') return
  try {
    if (phase === 'writing') {
      window.localStorage.setItem(`${CREATIVE_PHASE_CACHE_KEY}.${projectId}`, 'writing')
    } else {
      window.localStorage.removeItem(`${CREATIVE_PHASE_CACHE_KEY}.${projectId}`)
    }
  } catch { /* ignore */ }
}
const AI_CHAT_MODE_TRANSITION_MS = 220

type AiChatPreferenceMode = 'compact' | 'expanded'

type AiChatLayoutPreference = {
  dockRight: boolean
  mode: AiChatPreferenceMode
}

const DEFAULT_AI_CHAT_LAYOUT_PREFERENCE: AiChatLayoutPreference = {
  dockRight: true,
  mode: 'compact',
}

const AI_CHAT_LAYOUT_RESERVED_WIDTH_EXPANDED = 'calc(min(480px, calc(100vw - 32px)) + 24px)'
const AI_CHAT_LAYOUT_RESERVED_WIDTH_COMPACT = '96px'
const AI_CHAT_LAYOUT_RESERVED_WIDTH_NONE = '0px'

function normalizeAiChatPreferenceMode(value: unknown): AiChatPreferenceMode {
  return value === 'expanded' ? 'expanded' : 'compact'
}

function readAiChatLayoutPreference(): AiChatLayoutPreference {
  if (typeof window === 'undefined') return DEFAULT_AI_CHAT_LAYOUT_PREFERENCE
  try {
    const raw = window.localStorage.getItem(AI_CHAT_LAYOUT_PREFERENCE_STORAGE_KEY) || ''
    if (!raw.trim()) return DEFAULT_AI_CHAT_LAYOUT_PREFERENCE
    const parsed = JSON.parse(raw) as Partial<AiChatLayoutPreference>
    return {
      dockRight: typeof parsed.dockRight === 'boolean' ? parsed.dockRight : DEFAULT_AI_CHAT_LAYOUT_PREFERENCE.dockRight,
      mode: normalizeAiChatPreferenceMode(parsed.mode),
    }
  } catch {
    return DEFAULT_AI_CHAT_LAYOUT_PREFERENCE
  }
}

function writeAiChatLayoutPreference(next: AiChatLayoutPreference) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AI_CHAT_LAYOUT_PREFERENCE_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // ignore
  }
}

function resolveInitialBubbleVisualState(preference: AiChatLayoutPreference): 'bubble' | 'panel' {
  return preference.mode === 'compact' ? 'bubble' : 'panel'
}

function formatNowTime(): string {
  try {
    const d = new Date()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  } catch {
    return ''
  }
}

function formatMessageTime(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return formatNowTime()
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return formatNowTime()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function formatSessionDate(isoString: string): string {
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return isoString
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return isToday ? `今天 ${hhmm}` : `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

// 选项的 label/description 偶尔从上游（AskUserQuestion 风格）回成 { text: '...' } 而非裸字符串，
// 直接 {option.label} 渲染会抛 "Objects are not valid as a React child"。统一拍平成字符串。
function coerceChoiceText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    const inner = rec.text ?? rec.label ?? rec.value ?? rec.title
    if (typeof inner === 'string') return inner
    if (typeof inner === 'number' || typeof inner === 'boolean') return String(inner)
  }
  return ''
}

function normalizeComparableKind(value: unknown): string {
  return readTrimmedString(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function inferSelectedImageAssetRole(node: Node): ChatAssetInputRole {
  const data = asRecord(node.data)
  const source = readTrimmedString(data?.source)
  const primaryAnchor = resolvePrimarySemanticAnchorBinding(data)
  const semanticRoleBinding = resolveSemanticNodeRoleBinding(data)
  const roleCardId = readTrimmedString(data?.roleCardId) || String(semanticRoleBinding.roleCardId || '').trim()
  const roleName = readTrimmedString(data?.roleName) || String(semanticRoleBinding.roleName || '').trim()
  if (primaryAnchor?.kind === 'scene') return 'scene'
  if (primaryAnchor?.kind === 'prop') return 'prop'
  if (primaryAnchor?.kind && primaryAnchor.kind !== 'character') return 'context'
  if (
    roleCardId ||
    (roleName && (source === 'role_card_library' || source === 'chapter_assets_confirm'))
  ) {
    return 'character'
  }
  const kind = normalizeComparableKind(data?.kind)
  const productionMeta = getNodeProductionMeta(node)
  if (
    kind === 'storyboardshot' ||
    kind === 'storyboardimage' ||
    kind === 'novelstoryboard' ||
    productionMeta.productionLayer === 'anchors' ||
    productionMeta.creationStage === 'shot_anchor_lock'
  ) {
    return 'context'
  }
  return 'reference'
}

function buildSelectedImageAssetNote(node: Node, role: ChatAssetInputRole): string {
  const data = asRecord(node.data)
  const source = readTrimmedString(data?.source)
  if (role === 'character') {
    if (source === 'chapter_assets_confirm') return '章节已确认角色卡锚点'
    if (source === 'role_card_library') return '角色卡库锚点'
    return '角色锚点'
  }
  if (role === 'scene') return '场景锚点'
  if (role === 'prop') return '道具锚点'
  if (role === 'context') return '场景/镜头锚点'
  return ''
}

function buildSelectedImageAssetCandidate(node: Node, url: string): {
  nodeId: string
  assetId?: string
  assetRefId?: string
  url: string
  role: ChatAssetInputRole
  note?: string
  name?: string
} {
  const data = asRecord(node.data)
  const primaryResult = readCurrentCanvasNodeImageResult(node)
  const nodeId = readTrimmedString(node.id)
  const assetId = readTrimmedString(primaryResult?.assetId || data?.assetId)
  const assetRefId = readTrimmedString(primaryResult?.assetRefId || data?.assetRefId)
  const role = inferSelectedImageAssetRole(node)
  const note = buildSelectedImageAssetNote(node, role)
  const primaryAnchor = resolvePrimarySemanticAnchorBinding(data)
  const roleName = readTrimmedString(
    primaryAnchor?.label
    || data?.roleName
    || primaryResult?.assetName
    || data?.label
    || primaryResult?.assetRefId,
  )
  return {
    nodeId,
    ...(assetId ? { assetId } : {}),
    ...(assetRefId ? { assetRefId } : {}),
    url,
    role,
    ...(note ? { note } : {}),
    ...(roleName ? { name: roleName } : {}),
  }
}

type CanvasNodeImageResult = {
  url: string | null
  title: string | null
  assetId: string | null
  assetRefId: string | null
  assetName: string | null
  prompt: string | null
  storyboardScript: string | null
  storyboardShotPrompt: string | null
  shotNo: number | null
  storyboardSelectionContext: StoryboardSelectionContext | null
}

function readCanvasNodeImageResults(node: Node | undefined): CanvasNodeImageResult[] {
  const data = node ? asRecord(node.data) : null
  if (!data) return []
  const rawResults = Array.isArray(data.imageResults) ? data.imageResults : []
  return rawResults
    .map((item): CanvasNodeImageResult | null => {
      const record = asRecord(item)
      if (!record) return null
      const url = typeof record.url === 'string' && record.url.trim() ? record.url.trim() : null
      if (!url) return null
      const shotNoRaw = typeof record.shotNo === 'number' ? record.shotNo : Number(record.shotNo)
      return {
        url,
        title: typeof record.title === 'string' && record.title.trim() ? record.title.trim() : null,
        assetId: typeof record.assetId === 'string' && record.assetId.trim() ? record.assetId.trim() : null,
        assetRefId: typeof record.assetRefId === 'string' && record.assetRefId.trim() ? record.assetRefId.trim() : null,
        assetName:
          typeof record.assetName === 'string' && record.assetName.trim()
            ? record.assetName.trim()
            : typeof record.title === 'string' && record.title.trim()
              ? record.title.trim()
              : null,
        prompt: typeof record.prompt === 'string' && record.prompt.trim() ? record.prompt.trim() : null,
        storyboardScript: typeof record.storyboardScript === 'string' && record.storyboardScript.trim() ? record.storyboardScript.trim() : null,
        storyboardShotPrompt:
          typeof record.storyboardShotPrompt === 'string' && record.storyboardShotPrompt.trim()
            ? record.storyboardShotPrompt.trim()
            : typeof record.shotPrompt === 'string' && record.shotPrompt.trim()
              ? record.shotPrompt.trim()
            : null,
        shotNo:
          Number.isFinite(shotNoRaw) && shotNoRaw > 0
            ? Math.trunc(shotNoRaw)
            : null,
        storyboardSelectionContext: normalizeStoryboardSelectionContext(record.storyboardSelectionContext),
      }
    })
    .filter((item): item is CanvasNodeImageResult => Boolean(item))
}

function readCurrentCanvasNodeImageResult(node: Node | undefined): CanvasNodeImageResult | null {
  if (!node) return null
  const data = asRecord(node.data)
  if (!data) return null
  const imageResults = readCanvasNodeImageResults(node)
  if (!imageResults.length) return null
  const primaryIndexRaw = typeof data.imagePrimaryIndex === 'number' ? data.imagePrimaryIndex : Number(data.imagePrimaryIndex)
  const primaryIndex =
    Number.isFinite(primaryIndexRaw) && primaryIndexRaw >= 0 && primaryIndexRaw < imageResults.length
      ? Math.trunc(primaryIndexRaw)
      : 0
  return imageResults[primaryIndex] || imageResults[0] || null
}

function readStoryboardSelectionContextFromCanvasNode(node: Node | undefined): StoryboardSelectionContext | null {
  if (!node) return null
  const fromPrimaryImage = readCurrentCanvasNodeImageResult(node)?.storyboardSelectionContext
  if (fromPrimaryImage) return fromPrimaryImage
  const data = asRecord(node.data)
  if (!data) return null
  return normalizeStoryboardSelectionContext(data.storyboardSelectionContext)
}

function readImageUrlFromCanvasNode(node: Node | undefined): string {
  if (!node) return ''
  const data = asRecord(node.data)
  if (!data) return ''

  const directImageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
  if (directImageUrl) return directImageUrl

  const imageResults = Array.isArray(data.imageResults) ? data.imageResults : []
  const primaryIndexRaw = typeof data.imagePrimaryIndex === 'number' ? data.imagePrimaryIndex : Number(data.imagePrimaryIndex)
  const primaryIndex =
    Number.isFinite(primaryIndexRaw) && primaryIndexRaw >= 0 && primaryIndexRaw < imageResults.length
      ? Math.trunc(primaryIndexRaw)
      : 0
  const primaryItem = asRecord(imageResults[primaryIndex])
  if (primaryItem && typeof primaryItem.url === 'string' && primaryItem.url.trim()) {
    return primaryItem.url.trim()
  }
  const fallbackItem = imageResults
    .map((item) => asRecord(item))
    .find((item) => item && typeof item.url === 'string' && item.url.trim())
  return fallbackItem && typeof fallbackItem.url === 'string' ? fallbackItem.url.trim() : ''
}

function pickPrimaryCreationNodeId(nodeIds: string[]): string {
  const nodes = useRFStore.getState().nodes
  const rankByKind = (kind: string): number => {
    if (kind === 'video') return 4
    if (kind === 'image') return 2
    if (kind === 'text') return 1
    return 0
  }
  const created = nodeIds
    .map((id) => nodes.find((node) => String(node.id || '').trim() === String(id || '').trim()))
    .filter(Boolean)
  const primaryWithImage = created.find((node) => Boolean(readImageUrlFromCanvasNode(node)))
  if (primaryWithImage?.id) return String(primaryWithImage.id)
  const primary = created
    .slice()
    .sort((left, right) => {
      const leftKind = String(((left as { data?: { kind?: unknown } }).data?.kind) || '').trim()
      const rightKind = String(((right as { data?: { kind?: unknown } }).data?.kind) || '').trim()
      return rankByKind(rightKind) - rankByKind(leftKind)
    })[0]
  return primary?.id ? String(primary.id) : ''
}

function buildSceneCreationSummary(reply: string, nextIndex: number): string {
  const normalized = String(reply || '').trim()
  if (!normalized) return `第 ${nextIndex} 个场景已生成。`
  const firstLine = normalized
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean) || ''
  return firstLine ? `第 ${nextIndex} 个场景已生成：${firstLine}` : `第 ${nextIndex} 个场景已生成。`
}

function pickPrimaryImageUrlFromNode(node: Node): string {
  const data: any = node?.data || {}
  const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
  if (imageUrl) return imageUrl
  const results = Array.isArray(data.imageResults) ? data.imageResults : []
  const idx =
    typeof data.imagePrimaryIndex === 'number' && data.imagePrimaryIndex >= 0 && data.imagePrimaryIndex < results.length
      ? data.imagePrimaryIndex
      : 0
  const fromResults = typeof results[idx]?.url === 'string' ? String(results[idx].url).trim() : ''
  return fromResults || ''
}

function toAbsoluteApiUrl(rawUrl: string): string | null {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/')) {
    const base = String(API_BASE || '').trim().replace(/\/+$/, '')
    if (base) return `${base}${trimmed}`
    try {
      const origin = typeof window !== 'undefined' ? String(window.location?.origin || '').trim() : ''
      if (origin) return `${origin}${trimmed}`
    } catch {
      // ignore
    }
  }
  return null
}

function isPlaceholderAssetUrl(rawUrl: string): boolean {
  const value = String(rawUrl || '').trim()
  if (!value) return true
  if (!/^https?:\/\//i.test(value)) return true
  try {
    const u = new URL(value)
    const host = String(u.hostname || '').toLowerCase()
    return (
      host === 'example.com' ||
      host === 'www.example.com' ||
      host === 'example.org' ||
      host === 'www.example.org' ||
      host === 'example.net' ||
      host === 'www.example.net' ||
      host === 'localhost' ||
      host === '127.0.0.1'
    )
  } catch {
    return true
  }
}

const blobReferenceImageResolutionCache = new Map<string, string>()
const blobReferenceImageResolutionInflight = new Map<string, Promise<string | null>>()

async function resolveReferenceImageUrl(rawUrl: string): Promise<string | null> {
  const trimmed = String(rawUrl || '').trim()
  if (!trimmed) return null

  const abs = toAbsoluteApiUrl(trimmed)
  if (abs) return abs

  if (trimmed.startsWith('blob:')) {
    const cached = blobReferenceImageResolutionCache.get(trimmed)
    if (cached) return cached

    const inflight = blobReferenceImageResolutionInflight.get(trimmed)
    if (inflight) return inflight

    const resolvePromise = (async (): Promise<string | null> => {
    try {
      const res = await fetch(trimmed)
      if (!res.ok) return null
      const blob = await res.blob()
      const mime = blob.type || 'image/png'
      const ext =
        mime.includes('jpeg') || mime.includes('jpg')
          ? 'jpg'
          : mime.includes('webp')
            ? 'webp'
            : 'png'
      const stableBlobId = `${blob.size}-${mime.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'image'}`
      const fileName = `selection-${stableBlobId}.${ext}`
      const file = new File([blob], fileName, { type: mime, lastModified: 0 })
      const hosted = await uploadServerAssetFile(file, fileName, { taskKind: 'image_edit' })
      const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
      const resolved = hostedUrl ? toAbsoluteApiUrl(hostedUrl) : null
      if (resolved) {
        blobReferenceImageResolutionCache.set(trimmed, resolved)
      }
      return resolved
    } catch {
      return null
    } finally {
      blobReferenceImageResolutionInflight.delete(trimmed)
    }
    })()

    blobReferenceImageResolutionInflight.set(trimmed, resolvePromise)
    return resolvePromise
  }

  return null
}

type TapCanvasAutoGeneratedImage = { title: string; url: string }

const IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|gif|avif|bmp)(?:[?#]|$)/i

// Whether a URL points at an image we should render inline (extension or a known image host).
function isLikelyImageUrl(raw: unknown): boolean {
  const url = String(raw || '').trim()
  if (!/^https?:\/\//i.test(url)) return false
  if (IMAGE_EXT_RE.test(url)) return true
  try {
    return HOSTED_IMAGE_HOSTS.has(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

// Bare image URLs printed in assistant text are plain text to ReactMarkdown (no gfm autolink).
// Wrap them as markdown images so they route through the img renderer -> ManagedImage.
// The lookbehind skips URLs already inside markdown link/image or html attribute syntax.
const BARE_IMAGE_URL_RE =
  /(?<![("'=<\]!])\bhttps?:\/\/[^\s)<>"'\]]+\.(?:png|jpe?g|webp|gif|avif|bmp)(?:\?[^\s)<>"'\]]*)?/gi
function linkifyImageUrls(text: string): string {
  if (!text || text.indexOf('http') === -1) return text
  return text.replace(BARE_IMAGE_URL_RE, (url) => `\n\n![](${url})\n\n`)
}

// Pick an image node size that preserves the source aspect ratio around a target area,
// so freshly generated nodes don't render at a wrong (e.g. portrait) default until refresh.
function computeImageNodeSize(naturalW: number, naturalH: number): { w: number; h: number } {
  if (!naturalW || !naturalH) return { w: 420, h: 280 }
  const ratio = naturalW / naturalH
  const targetArea = 420 * 280
  let w = Math.sqrt(targetArea * ratio)
  let h = w / ratio
  w = Math.max(200, Math.min(640, w))
  h = Math.max(160, Math.min(720, h))
  return { w: Math.round(w), h: Math.round(h) }
}
type AssistantAsset = {
  title: string
  url: string
  thumbnailUrl?: string
  mediaType: 'image' | 'video' | 'audio'
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getScrollDistanceToBottom(element: HTMLDivElement): number {
  return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight)
}

function getAutoScrollBottomThreshold(element: HTMLDivElement): number {
  return clampNumber(
    Math.round(element.clientHeight * AUTO_SCROLL_BOTTOM_THRESHOLD_RATIO),
    AUTO_SCROLL_BOTTOM_THRESHOLD_MIN_PX,
    AUTO_SCROLL_BOTTOM_THRESHOLD_MAX_PX,
  )
}

function isViewportNearBottom(element: HTMLDivElement): boolean {
  return getScrollDistanceToBottom(element) <= getAutoScrollBottomThreshold(element)
}

// AI 回复末尾经常附带"下一步建议"等元评论，入画布时只保留正文部分
function stripAssistantMetaTail(text: string): string {
  const trimmed = text.trim()
  // 以 \n---\n 或 \n***\n 分割段落
  const parts = trimmed.split(/\n[ \t]*(?:---|[*]{3})[ \t]*\n/)
  if (parts.length <= 1) return trimmed
  const last = parts[parts.length - 1].trim()
  // 含有这些关键词 → 视为元评论尾巴，丢弃
  const metaKeywords = ['如果你', '我建议', '下一步', '接着写', '继续往下', '继续写', '我下一条', '建议直接', '我可以继续']
  if (metaKeywords.some((k) => last.includes(k))) {
    return parts.slice(0, -1).join('\n\n---\n\n').trim()
  }
  return trimmed
}

function extractTapCanvasAutoGeneratedImages(replyText: string): TapCanvasAutoGeneratedImage[] {
  const raw = String(replyText || '')
  const startTag = '<tapcanvas_auto_json>'
  const endTag = '</tapcanvas_auto_json>'
  const start = raw.indexOf(startTag)
  const end = raw.indexOf(endTag)
  if (start < 0 || end < 0 || end <= start) return []
  const jsonText = raw.slice(start + startTag.length, end).trim()
  if (!jsonText) return []
  try {
    const parsed: unknown = JSON.parse(jsonText)
    const items =
      parsed && typeof parsed === 'object' && Array.isArray((parsed as { generatedImages?: unknown }).generatedImages)
        ? (parsed as { generatedImages: Array<{ title?: unknown; url?: unknown }> }).generatedImages
        : []
    const out: TapCanvasAutoGeneratedImage[] = []
    const seen = new Set<string>()
    for (const item of items) {
      const urlRaw = typeof item?.url === 'string' ? item.url.trim() : ''
      const url = urlRaw ? (toAbsoluteApiUrl(urlRaw) || urlRaw) : ''
      if (!url || !/^https?:\/\//i.test(url) || isPlaceholderAssetUrl(url) || seen.has(url)) continue
      seen.add(url)
      const title = typeof item?.title === 'string' ? item.title.trim() : ''
      out.push({ title, url })
      if (out.length >= 12) break
    }
    return out
  } catch {
    return []
  }
}

function mergeAssistantAssets(
  base: AssistantAsset[],
  extraImages: TapCanvasAutoGeneratedImage[],
): AssistantAsset[] {
  const out: AssistantAsset[] = []
  const seen = new Set<string>()

  for (const asset of Array.isArray(base) ? base : []) {
    const url = String(asset?.url || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(asset)
  }

  for (const image of Array.isArray(extraImages) ? extraImages : []) {
    const url = String(image?.url || '').trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push({
      title: String(image?.title || '').trim() || `生成图-${out.length + 1}`,
      url,
      mediaType: 'image',
    })
  }

  return out.slice(0, 12)
}

function addAutoGeneratedImagesToCanvas(images: TapCanvasAutoGeneratedImage[]) {
  if (!images.length) return
  const store = useRFStore.getState()
  // 查重：画布已有同 URL 资产（角色卡/场景卡/往轮生成图等被小T回显）不再重复落卡，
  // 更不为它们新建「AI多图」组——否则已有资产会被原样复制成一组"生成图-N"。
  // 全是已有资产时这里一张不加，末尾的选中逻辑会把画布上的对应节点高亮出来。
  const existingKeys = collectCanvasMediaUrlKeys(store.nodes as Node[])
  const freshImages = images.filter((img) => !isMediaUrlOnCanvas(String(img.url || ''), existingKeys))
  if (freshImages.length === 1) {
    const img = freshImages[0]
    const title = img.title || '生成图'
    // Size the node to the image's real aspect ratio so it doesn't render at a wrong
    // default (e.g. portrait/9:16) until a refresh re-reads the corrected size.
    const addWithNaturalSize = (naturalW: number, naturalH: number) => {
      const size = computeImageNodeSize(naturalW, naturalH)
      const insertion = resolveChatCanvasInsertionScope({ w: size.w, h: size.h })
      const position = resolveNonOverlappingPosition(
        useRFStore.getState().nodes,
        { x: insertion.anchor.x, y: insertion.anchor.y },
        { w: size.w, h: size.h },
        null,
      )
      store.addNode('taskNode', title, {
        kind: 'image',
        imageUrl: img.url,
        status: 'success',
        position,
        autoLabel: false,
        nodeWidth: size.w,
        nodeHeight: size.h,
      })
    }
    let settled = false
    const finish = (w: number, h: number) => {
      if (settled) return
      settled = true
      addWithNaturalSize(w, h)
    }
    const probe = new Image()
    probe.onload = () => finish(probe.naturalWidth || 0, probe.naturalHeight || 0)
    probe.onerror = () => finish(0, 0)
    probe.src = img.url
    // Safety net: add with fallback size if the probe neither loads nor errors promptly.
    setTimeout(() => finish(0, 0), 4000)
  } else if (freshImages.length > 1) {
    const genId = (): string => {
      try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
          return crypto.randomUUID()
        }
      } catch {
        // ignore
      }
      return `n-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    }
    useRFStore.setState((s) => {
      const usedIds = new Set((s.nodes || []).map((n) => String(n.id || '').trim()).filter(Boolean))
      let groupNo = Math.max(1, Number(s.nextGroupId || 1))
      let groupId = `g${groupNo}`
      while (usedIds.has(groupId)) {
        groupNo += 1
        groupId = `g${groupNo}`
      }

      const cols = Math.min(4, Math.max(2, Math.ceil(Math.sqrt(freshImages.length))))
      const cardW = 180
      const cardH = 140
      const gapX = 12
      const gapY = 12
      const padding = 16
      const rows = Math.ceil(freshImages.length / cols)
      const groupW = Math.max(560, padding * 2 + cols * cardW + Math.max(0, cols - 1) * gapX)
      const groupH = Math.max(220, padding * 2 + rows * cardH + Math.max(0, rows - 1) * gapY)
      const insertion = resolveChatCanvasInsertionScope({ w: groupW, h: groupH })

      const children: Node[] = freshImages.map((img, idx) => {
        const col = idx % cols
        const row = Math.floor(idx / cols)
        const label = String(img.title || '').trim() || `生成图-${idx + 1}`
        return {
          id: genId(),
          type: 'taskNode' as any,
          parentId: groupId,
          position: {
            x: padding + col * (cardW + gapX),
            y: padding + row * (cardH + gapY),
          },
          data: {
            label,
            kind: 'image',
            imageUrl: img.url,
            status: 'success',
            nodeWidth: cardW,
            nodeHeight: cardH,
          },
          selected: false,
        } as Node
      })
      const groupNode: Node = {
        id: groupId,
        type: 'groupNode' as any,
        position: insertion.anchor,
        data: {
          label: `AI多图-${freshImages.length}张`,
          isGroup: true,
          groupKind: 'ai_chat_multi_images',
        },
        style: {
          width: groupW,
          height: groupH,
        },
        selected: true,
      } as Node

      const nextNodes = [
        ...s.nodes.map((n) => ({ ...n, selected: false })),
        groupNode,
        ...children,
      ]
      return {
        nodes: nextNodes,
        edges: s.edges.map((e) => ({ ...e, selected: false })),
        nextGroupId: groupNo + 1,
      }
    })
  }

  try {
    const nextStore = useRFStore.getState()
    const byUrl = new Set(images.map((img) => String(img.url || '').trim()).filter(Boolean))
    const matchedIds = nextStore.nodes
      .filter((node) => {
        const data: any = node?.data || {}
        const url = typeof data.imageUrl === 'string' ? data.imageUrl.trim() : ''
        return isImageKind(String(data.kind || '')) && !!url && byUrl.has(url)
      })
      .map((node) => node.id)

    if (matchedIds.length >= 1) {
      const idSet = new Set(matchedIds)
      const parentGroup = nextStore.nodes.find((node: any) => {
        if (node?.type !== 'groupNode') return false
        const groupId = String(node?.id || '').trim()
        if (!groupId) return false
        const children = nextStore.nodes.filter((n: any) => String(n?.parentId || '').trim() === groupId)
        if (!children.length) return false
        return children.every((n) => idSet.has(String(n?.id || '').trim()))
      })
      const finalSelection = parentGroup?.id ? new Set([String(parentGroup.id)]) : idSet
      useRFStore.setState((s) => ({
        nodes: s.nodes.map((n) => ({ ...n, selected: finalSelection.has(n.id) })),
        edges: s.edges.map((e) => ({ ...e, selected: false })),
      }))
    }
  } catch {
    // ignore selection errors
  }
}

function addAssistantAssetsToCanvasAsImages(
  assets: AssistantAsset[],
) {
  const images = assets
    .filter((asset) => asset.mediaType === 'image')
    .map((asset) => ({ title: asset.title, url: asset.url }))
  if (!images.length) return
  addAutoGeneratedImagesToCanvas(images)
}

function countAssistantAssetsByMediaType(assets: AssistantAsset[]): { imageCount: number; videoCount: number } {
  let imageCount = 0
  let videoCount = 0
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (asset.mediaType === 'image') imageCount += 1
    if (asset.mediaType === 'video') videoCount += 1
  }
  return { imageCount, videoCount }
}

function addAssistantAssetsToCanvas(assets: AssistantAsset[]): { imageCount: number; videoCount: number } {
  const { imageCount, videoCount } = countAssistantAssetsByMediaType(assets)
  if (imageCount > 0) addAssistantAssetsToCanvasAsImages(assets)
  if (videoCount > 0) addAssistantVideoAssetsToCanvas(assets)
  return { imageCount, videoCount }
}

function addAssistantVideoAssetsToCanvas(
  assets: AssistantAsset[],
) {
  const store = useRFStore.getState()
  // 同图片侧：画布上已有同 URL 的视频节点不再重复落卡（小T回顾/引用已有成片时会回显其 URL）。
  const existingKeys = collectCanvasMediaUrlKeys(store.nodes as Node[])
  const videos = assets.filter(
    (asset) => asset.mediaType === 'video' && !isMediaUrlOnCanvas(String(asset.url || ''), existingKeys),
  )
  if (!videos.length) return

  const videoSize = { w: 460, h: 260 }
  const insertion = resolveChatCanvasInsertionScope({
    w: videoSize.w,
    h: Math.max(videoSize.h, videos.length * 280),
  })

  videos.forEach((asset, idx) => {
    const url = String(asset.url || '').trim()
    if (!url) return
    const thumbnailUrl = String(asset.thumbnailUrl || '').trim()
    const liveNodes = useRFStore.getState().nodes
    const position = resolveNonOverlappingPosition(
      liveNodes,
      {
        x: insertion.anchor.x,
        y: insertion.anchor.y + idx * 280,
      },
      videoSize,
      null,
    )
    store.addNode('taskNode', asset.title || `视频-${idx + 1}`, {
      kind: 'video',
      videoUrl: url,
      videoResults: [{
        url,
        ...(thumbnailUrl ? { thumbnailUrl } : null),
        title: asset.title || `视频-${idx + 1}`,
      }],
      videoPrimaryIndex: 0,
      status: 'success',
      position,
      autoLabel: false,
    })
  })
}

function normalizeAssistantAssets(input: unknown): AssistantAsset[] {
  if (input !== undefined && !Array.isArray(input)) {
    throw new Error('agents chat 返回的 assets 必须是数组')
  }
  const items = Array.isArray(input) ? input : []
  const out: AssistantAsset[] = []
  const seen = new Set<string>()
  for (const rawItem of items) {
    if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
      throw new Error('agents chat 返回了无效的资产记录')
    }
    const item = rawItem as Record<string, unknown>
    const rawUrl = typeof item.url === 'string' ? item.url.trim() : ''
    const absUrl = rawUrl ? (toAbsoluteApiUrl(rawUrl) || rawUrl) : ''
    if (!absUrl || !/^https?:\/\//i.test(absUrl) || isPlaceholderAssetUrl(absUrl)) {
      throw new Error('agents chat 返回了无效的资产 URL')
    }
    if (seen.has(absUrl)) continue
    seen.add(absUrl)

    const rawThumb = typeof item.thumbnailUrl === 'string' ? item.thumbnailUrl.trim() : ''
    const absThumb = rawThumb ? (toAbsoluteApiUrl(rawThumb) || rawThumb) : ''
    const rawType = typeof item.type === 'string' ? item.type.trim().toLowerCase() : ''
    if (rawType !== 'image' && rawType !== 'video' && rawType !== 'audio') {
      throw new Error(`agents chat 返回了不支持的资产类型：${rawType || 'missing'}`)
    }
    const mediaType = rawType
    const title =
      typeof item.title === 'string' && item.title.trim()
        ? item.title.trim()
        : `${mediaType === 'video' ? '生成视频' : mediaType === 'audio' ? '生成音频' : '生成图'}-${out.length + 1}`

    out.push({
      title,
      url: absUrl,
      mediaType,
      ...(absThumb ? { thumbnailUrl: absThumb } : null),
    })
    if (out.length >= 12) break
  }
  return out
}

function normalizeChatRole(input: string): ChatRole | null {
  if (input === 'user' || input === 'assistant') return input
  return null
}

function mapMemoryConversationItemToChatMessage(item: MemoryConversationItemDto, index: number): ChatMessage | null {
  const role = normalizeChatRole(String(item.role || '').trim())
  const content = String(item.content || '').trim()
  if (!role || !content) return null
  const createdAt = String(item.createdAt || '').trim()
  const turnId = String(item.turnId || '').trim()
  const messageId = String(item.messageId || '').trim()
  const stableMessageId = turnId
    ? role === 'user'
      ? buildRecoveredChatMessageIds(turnId).userMessageId
      : buildRecoveredChatMessageIds(turnId).assistantMessageId
    : `m_history_${messageId || `${createdAt || 'na'}_${index}`}`
  return {
    id: stableMessageId,
    role,
    content,
    ts: formatMessageTime(createdAt),
    phase: 'final',
    kind: 'result',
    ...(role === 'assistant'
      ? {
          assets: normalizeAssistantAssets(item.assets),
          ...((): { referenceDocuments: ChatReferenceDocuments } | null => {
            const referenceDocuments = buildChatReferenceDocuments(item.executionProvenance)
            return referenceDocuments.skills.length > 0 || referenceDocuments.knowledge.length > 0
              ? { referenceDocuments }
              : null
          })(),
        }
      : null),
  }
}

function patchChatMessageById(
  messages: ChatMessage[],
  messageId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  let changed = false
  const next = messages.map((message) => {
    if (message.id !== messageId) return message
    changed = true
    return updater(message)
  })
  return changed ? next : messages
}

function isChatAbortError(error: unknown): boolean {
  if (!error) return false
  if (error instanceof DOMException) return error.name === 'AbortError'
  if (error instanceof Error) {
    return error.message === CHAT_STREAM_ABORT_ERROR || error.name === 'AbortError'
  }
  return false
}

type ChatTodoItem = {
  status: 'pending' | 'in_progress' | 'completed'
  content: string
  /** 该任务处于 in_progress 的墙钟耗时（毫秒，前端测量）；用于定位高耗时阶段 */
  durationMs?: number
  /** 首次观察到该阶段进入 in_progress 的客户端时间戳；用于阶段进行中的实时计时。 */
  startedAt?: number
}

type ChatToolStep = {
  callId: string
  toolName: string
  label: string
  status: 'running' | 'succeeded' | 'failed' | 'denied' | 'blocked' | 'cancelled'
  severity?: 'warning' | 'error'
  /** 工具启动时正在 in_progress 的 todo 序号；-1 = 还没有任务清单 */
  anchorTodoIndex: number
  /** 工具调用耗时（毫秒，服务端 SSE 下发）；用于定位高耗时工具 */
  durationMs?: number
  /** 进入 running 的客户端时间戳（ms）；用于在 running 期间显示实时累计耗时，避免长任务看着像卡死 */
  startedAt?: number
}

// 常见画布/创作工具的友好步骤文案；未知工具回退「调用工具」并在 UI 旁挂英文小字便于排查。
// key 已归一化（去 tapcanvas_ 前缀 + 小写）。覆盖 agents-cli/bridge 实际下发的工具名。
const TOOL_STEP_LABELS: Record<string, string> = {
  // 图片
  generate_image: '调用工具生成图片',
  edit_image: '调用工具编辑图片',
  image_generate_to_canvas: '生成图片到画布',
  analyze_image: '图像理解分析',
  // 视频
  video_generate: '调用工具生成视频',
  video_generate_to_canvas: '生成视频到画布',
  equipped_workflow_run: '启动已装配工作流',
  workflow_execution_inspect: '检查一键成片执行状态',
  workflow_resume: '恢复一键成片执行',
  video_concat: '拼接视频片段',
  video_to_canvas: '视频落画布',
  analyze_video: '视频理解审片',
  decompose_video: '拆解视频分镜',
  distill_director_breakdown: '蒸馏导演拆解',
  // 画布结构
  flow_patch: '更新画布节点',
  flow_read: '读取画布结构',
  flow_get: '读取画布结构',
  add_node: '新增画布节点',
  connect_edge: '连接节点',
  set_param: '设置节点参数',
  creategroup: '画布打组',
  reflowlayout: '整理画布布局',
  link_existing_asset: '关联已有素材',
  capture_director_scene: '导演台机位取景',
  add_director_console: '搭建导演台',
  // 分镜 / 故事板
  shot_table_critic: '校验分镜表',
  annotate_shot: '标注分镜',
  book_chapter_get: '读取章节原文',
  book_index_get: '读取书目索引',
  book_storyboard_plan_get: '读取分镜方案',
  book_storyboard_plan_upsert: '保存分镜方案',
  // 检索 / 记忆
  knowledge_catalog: '查看知识目录',
  web_search: '联网检索资料',
  knowledge_search: '检索知识库',
  knowledge_read: '读取知识卡',
  memory_save: '沉淀经验记忆',
  memory_search: '检索经验记忆',
  memory_reflect: '复盘经验记忆',
  // 流程控制
  record_user_intent: '确认任务目标',
  skill: '加载技能',
  skill_search: '查找技能',
  skill_lookup: '查找技能',
  active_workflow: '激活工作流',
  canvas_plan: '规划画布步骤',
  request_user_input: '等待你的选择',
  present_media: '展示素材',
  suggest_replies: '准备建议回复',
  finalize: '收尾整理',
}

// 元操作工具：不在子步骤展示英文兜底（call_tool 只是分发壳）。
const GENERIC_TOOL_LABEL = '调用工具'

const KNOWLEDGE_TOOL_NAMES = new Set(['knowledge_catalog', 'knowledge_search', 'knowledge_read'])

function normalizeToolStepName(toolName: unknown): string {
  return readPresentedToolName(toolName).replace(/^tapcanvas[_-]/i, '').toLowerCase()
}

function isKnowledgeToolName(toolName: unknown): boolean {
  return KNOWLEDGE_TOOL_NAMES.has(normalizeToolStepName(toolName))
}

function isMappedTool(toolName: unknown): boolean {
  const normalized = normalizeToolStepName(toolName)
  return Boolean(normalized && TOOL_STEP_LABELS[normalized])
}

function describeToolStep(
  toolName: unknown,
  toolInput: unknown,
  availableSkills: readonly ChatSkillReference[],
): string {
  const raw = readPresentedToolName(toolName)
  const normalized = normalizeToolStepName(raw)
  if (normalized === 'skill') {
    const label = resolveChatSkillToolLabel(toolInput, availableSkills)
    if (label) return label
  }
  // 未命中映射时只回退通用中文，原始英文名由渲染层挂成灰色小字（不混进主标签）。
  return TOOL_STEP_LABELS[normalized] || GENERIC_TOOL_LABEL
}

// 从工具 SSE 载荷取耗时：优先 durationMs，缺失时按 finishedAt-startedAt 兜底。
function resolveToolDurationMs(data: { durationMs?: number; startedAt?: string; finishedAt?: string }): number | null {
  if (typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) && data.durationMs >= 0) {
    return data.durationMs
  }
  const start = data.startedAt ? Date.parse(data.startedAt) : NaN
  const end = data.finishedAt ? Date.parse(data.finishedAt) : NaN
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start
  return null
}

// 自适应精度时长：很多画布/读取工具是子秒级，统一 mm:ss 会把 0.2s 压成 00:00、
// 看不出快慢梯度。所以 <1s 显示毫秒、<60s 显示秒（<10s 带 1 位小数）、≥60s 才用 m:ss / h:mm:ss。
// 目的就是让「高耗时场景」一眼可辨。
function formatDurationMs(ms: unknown): string | null {
  const n = typeof ms === 'number' ? ms : Number(ms)
  if (!Number.isFinite(n) || n < 0) return null
  if (n < 1000) return `${Math.round(n)}ms`
  const totalSec = n / 1000
  if (totalSec < 60) {
    return totalSec < 10 ? `${totalSec.toFixed(1)}s` : `${Math.round(totalSec)}s`
  }
  const whole = Math.round(totalSec)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

function KnowledgeTaskExternal({ steps, now }: { steps: ChatToolStep[]; now: number }): JSX.Element | null {
  if (steps.length === 0) return null

  const runningStep = [...steps].reverse().find((step) => step.status === 'running') ?? null
  const failedStep = [...steps].reverse().find((step) =>
    step.severity !== 'warning' &&
    (step.status === 'failed' || step.status === 'denied' || step.status === 'blocked' || step.status === 'cancelled'),
  ) ?? null
  const completedCount = steps.filter((step) => step.status === 'succeeded').length
  const state = runningStep ? 'active' : failedStep ? 'failed' : 'completed'
  const statusLabel = state === 'active' ? '处理中' : state === 'failed' ? '需检查' : '已完成'
  const progressLabel = runningStep
    ? `当前：${runningStep.label}`
    : `${completedCount}/${steps.length} 个知识步骤已完成`

  return (
    <section className={`tc-ai-plan__knowledge tc-ai-plan__knowledge--${state}`} aria-label="知识任务外显">
      <div className="tc-ai-plan__knowledge-header">
        <span className="tc-ai-plan__knowledge-icon" aria-hidden="true">
          <IconBook2 className="tc-ai-plan__knowledge-icon-svg" size={15} />
        </span>
        <div className="tc-ai-plan__knowledge-copy">
          <span className="tc-ai-plan__knowledge-title">知识任务</span>
          <span className="tc-ai-plan__knowledge-summary">{progressLabel}</span>
        </div>
        <span className="tc-ai-plan__knowledge-status">{statusLabel}</span>
      </div>
      <div className="tc-ai-plan__knowledge-steps">
        {steps.map((step) => {
          const duration = step.status === 'running' && typeof step.startedAt === 'number'
            ? formatDurationMs(Math.max(0, now - step.startedAt))
            : formatDurationMs(step.durationMs)
          const stepFailed = step.severity !== 'warning'
            && (step.status === 'failed' || step.status === 'denied' || step.status === 'blocked' || step.status === 'cancelled')
          return (
            <div key={step.callId} className={`tc-ai-plan__knowledge-step tc-ai-plan__knowledge-step--${step.status}`}>
              <span className="tc-ai-plan__knowledge-step-mark" aria-hidden="true">
                {step.status === 'running'
                  ? <span className="tc-ai-plan__spinner" />
                  : step.status === 'succeeded'
                    ? '✓'
                    : stepFailed
                      ? '!'
                      : '·'}
              </span>
              <span className="tc-ai-plan__knowledge-step-label">{step.label}</span>
              {duration ? <span className="tc-ai-plan__knowledge-step-duration">{duration}</span> : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// todo/计划类与 schema 取数类工具是元操作，不进任务清单子步骤。
function shouldHideToolStep(toolName: unknown): boolean {
  const normalized = normalizeToolStepName(toolName)
  return !normalized || normalized.includes('todo') || normalized === 'get_tool_schema' || normalized === 'update_plan'
}

function normalizeChatTodoItems(
  value: unknown,
): ChatTodoItem[] {
  if (!Array.isArray(value)) return []
  const items: ChatTodoItem[] = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const content = String(record.text || '').trim()
    if (!content) continue
    const statusRaw = String(record.status || '').trim()
    const status: ChatTodoItem['status'] =
      statusRaw === 'completed' || statusRaw === 'in_progress' || statusRaw === 'pending'
        ? statusRaw
        : record.completed === true
          ? 'completed'
          : 'pending'
    items.push({ status, content })
    if (items.length >= 20) break
  }
  return items
}

function extractLatestTodoBlock(content: string): { markdownText: string; todoItems: ChatTodoItem[] } {
  const raw = String(content || '')
  if (!raw.trim()) return { markdownText: '', todoItems: [] }

  const marker = '\nTodo\n'
  const normalized = raw.startsWith('Todo\n') ? `\n${raw}` : raw
  const startIndex = normalized.lastIndexOf(marker)
  if (startIndex < 0) return { markdownText: raw.trim(), todoItems: [] }

  const todoText = normalized.slice(startIndex + 1).trim()
  const todoLines = todoText.split('\n')
  if (todoLines[0] !== 'Todo') return { markdownText: raw.trim(), todoItems: [] }

  const todoItems: ChatTodoItem[] = []
  for (const line of todoLines.slice(1)) {
    const trimmed = line.trim()
    if (!trimmed || /^\(\d+\/\d+\s+done\)$/i.test(trimmed) || /^note:/i.test(trimmed)) continue
    const match = trimmed.match(/^\[( |>|x)\]\s+(.+)$/i)
    if (!match) continue
    todoItems.push({
      status: match[1] === 'x' ? 'completed' : match[1] === '>' ? 'in_progress' : 'pending',
      content: match[2]!.trim(),
    })
  }

  if (!todoItems.length) return { markdownText: raw.trim(), todoItems: [] }

  const markdownText = normalized.slice(0, startIndex).trim()
  return { markdownText, todoItems }
}

function summarizeThinkingText(content: string): string {
  const raw = String(content || '').trim()
  if (!raw) return '正在处理你的请求'
  const { todoItems } = extractLatestTodoBlock(raw)
  if (todoItems.length > 0) {
    const completedCount = countCompletedTodoItems(todoItems)
    const activeItem = findInProgressTodoItem(todoItems)
    if (activeItem) return `正在执行：${activeItem.content}`
    return `正在整理任务清单（${completedCount}/${todoItems.length}）`
  }
  const firstLine = raw
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  return firstLine || '正在处理你的请求'
}

type ReloadCanvasFlowResult = {
  reloaded: boolean
  newNodeIds: string[]
}

function focusCanvasNodeAfterReload(nodeIds: string[]): void {
  const targetNodeId = pickPrimaryCreationNodeId(nodeIds)
  if (!targetNodeId || typeof window === 'undefined') return

  const focus = () => {
    const focusNode = (window as Window & { __tcFocusNode?: (id: string) => void }).__tcFocusNode
    focusNode?.(targetNodeId)
  }

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(focus)
  })
}

const BATCH_NODE_WIDTH = 420
const BATCH_NODE_GAP = 32
const BATCH_NODE_STRIDE = BATCH_NODE_WIDTH + BATCH_NODE_GAP

function reflowNewBatchNodesHorizontally(newNodeIds: readonly string[]): void {
  if (newNodeIds.length <= 1) return
  const store = useRFStore.getState()
  const newNodeSet = new Set(newNodeIds)
  const newNodes = store.nodes.filter((n) => newNodeSet.has(n.id) && !n.parentId)
  if (newNodes.length <= 1) return

  const byKind = new Map<string, Node[]>()
  for (const node of newNodes) {
    const kind = String((node.data as Record<string, unknown>)?.kind || node.type || '')
    const list = byKind.get(kind) ?? []
    list.push(node)
    byKind.set(kind, list)
  }

  const changes: { type: 'position'; id: string; position: { x: number; y: number } }[] = []
  for (const [, nodes] of byKind) {
    if (nodes.length <= 1) continue
    const sorted = [...nodes].sort((a, b) => (a.position?.x ?? 0) - (b.position?.x ?? 0))
    const anchorX = sorted[0]?.position?.x ?? 0
    const anchorY = Math.min(...sorted.map((n) => n.position?.y ?? 0))
    sorted.forEach((node, index) => {
      changes.push({ type: 'position', id: node.id, position: { x: anchorX + index * BATCH_NODE_STRIDE, y: anchorY } })
    })
  }
  if (changes.length > 0) {
    store.onNodesChange(changes as Parameters<typeof store.onNodesChange>[0])
  }
}

async function reloadCanvasFlowFromServer(input: {
  flowId: string
  expectedProjectId?: string
  expectedFlowId?: string
}): Promise<ReloadCanvasFlowResult> {
  const flowId = String(input.flowId || '').trim()
  if (!flowId) {
    return { reloaded: false, newNodeIds: [] }
  }

  const uiState = useUIStore.getState()
  const liveProjectId = String(uiState.currentProject?.id || '').trim()
  const liveFlowId = String(uiState.currentFlow?.id || '').trim()
  const expectedProjectId = String(input.expectedProjectId || '').trim()
  const expectedFlowId = String(input.expectedFlowId || '').trim()

  if (expectedProjectId && liveProjectId && liveProjectId !== expectedProjectId) {
    return { reloaded: false, newNodeIds: [] }
  }
  if (expectedFlowId && liveFlowId && liveFlowId !== expectedFlowId) {
    return { reloaded: false, newNodeIds: [] }
  }

  const localNodeIds = new Set(
    useRFStore.getState().nodes
      .map((node) => String(node.id || '').trim())
      .filter(Boolean),
  )
  const flow = await getServerFlow(flowId)
  const flowData = flow?.data || { nodes: [], edges: [] }
  const nextNodes = Array.isArray(flowData.nodes) ? flowData.nodes : []
  const newNodeIds = nextNodes
    .map((node) => String(node?.id || '').trim())
    .filter((nodeId) => Boolean(nodeId) && !localNodeIds.has(nodeId))
  useRFStore.getState().load({
    nodes: nextNodes,
    edges: Array.isArray(flowData.edges) ? flowData.edges : [],
  })
  // 重载的是当前 flow 的服务端最新图，落定归属避免后续自动保存被守卫误挡
  useRFStore.getState().setGraphProvenance(`flow:${flow.id}`)
  useUIStore.getState().setRestoreViewport(
    flowData.viewport && typeof flowData.viewport.zoom === 'number' ? flowData.viewport : null,
  )
  useUIStore.getState().setCurrentFlow({ id: flow.id, name: flow.name, source: 'server' })
  useUIStore.getState().setDirty(false)
  return { reloaded: true, newNodeIds }
}

function countCompletedTodoItems(items: ChatTodoItem[]): number {
  return items.filter((item) => item.status === 'completed').length
}

function findInProgressTodoItem(items: ChatTodoItem[]): ChatTodoItem | null {
  return items.find((item) => item.status === 'in_progress') ?? null
}

type FocusedNodeResourceContext = {
  nodeId: string
  label: string
  kind: string | null
  imageCandidates: string[]
}

type SelectedCanvasNodeContext = {
  nodeId: string
  label: string
  kind: string | null
  anchorBindings: PublicFlowAnchorBinding[]
  roleName: string | null
  roleCardId: string | null
  textPreview: string | null
  imageUrl: string | null
  sourceUrl: string | null
  bookId: string | null
  chapterId: string | null
  shotNo: number | null
  productionLayer: string | null
  creationStage: string | null
  approvalStatus: string | null
  authorityBaseFrameNodeId: string | null
  authorityBaseFrameStatus: 'planned' | 'confirmed' | null
  storyboardSelectionContext: StoryboardSelectionContext | null
  hasInlinePromptText: boolean
  hasUpstreamTextEvidence: boolean
  hasDownstreamComposeVideo: boolean
}

type AgentsChatSelectedReferencePayload = NonNullable<NonNullable<AgentsChatRequestDto['chatContext']>['selectedReference']>
type AgentsChatSelectedReferenceAnchorBinding =
  NonNullable<AgentsChatSelectedReferencePayload['anchorBindings']>[number]

function normalizeSelectedReferenceAnchorBindings(
  bindings: readonly PublicFlowAnchorBinding[],
): AgentsChatSelectedReferencePayload['anchorBindings'] {
  const normalizedBindings = normalizePublicFlowAnchorBindings(bindings)
  if (!normalizedBindings.length) return undefined
  return normalizedBindings.map((binding): AgentsChatSelectedReferenceAnchorBinding => ({
    kind: binding.kind,
    ...(readTrimmedString(binding.refId) ? { refId: readTrimmedString(binding.refId) } : {}),
    ...(readTrimmedString(binding.entityId) ? { entityId: readTrimmedString(binding.entityId) } : {}),
    ...(readTrimmedString(binding.label) ? { label: readTrimmedString(binding.label) } : {}),
    ...(readTrimmedString(binding.sourceBookId) ? { sourceBookId: readTrimmedString(binding.sourceBookId) } : {}),
    ...(readTrimmedString(binding.sourceNodeId) ? { sourceNodeId: readTrimmedString(binding.sourceNodeId) } : {}),
    ...(readTrimmedString(binding.assetId) ? { assetId: readTrimmedString(binding.assetId) } : {}),
    ...(readTrimmedString(binding.assetRefId) ? { assetRefId: readTrimmedString(binding.assetRefId) } : {}),
    ...(readTrimmedString(binding.imageUrl) ? { imageUrl: readTrimmedString(binding.imageUrl) } : {}),
    ...(binding.referenceView ? { referenceView: binding.referenceView } : {}),
    ...(readTrimmedString(binding.category) ? { category: readTrimmedString(binding.category) } : {}),
    ...(readTrimmedString(binding.note) ? { note: readTrimmedString(binding.note) } : {}),
  }))
}

type ImplicitChatRequest = {
  prompt: string
  displayText: string
}

const SELECTED_NODE_TEXT_PREVIEW_MAX_CHARS = 1200

function clipChatPreview(value: string, maxChars: number): string {
  const normalized = String(value || '').trim()
  if (!normalized) return ''
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 1) return normalized.slice(0, maxChars)
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function readTrimmedNodeStringField(node: Node, field: string): string | null {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const value = (data as Record<string, unknown>)[field]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function readFiniteNodeNumberField(node: Node, field: string): number | null {
  const data = node.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const value = (data as Record<string, unknown>)[field]
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.trunc(numeric)
}

function readLatestNodeTextResult(node: Node): string | null {
  const data = asRecord(node.data)
  if (!data) return null
  const textResults = Array.isArray(data.textResults) ? data.textResults : []
  const latest = textResults.length > 0 ? asRecord(textResults[textResults.length - 1]) : null
  if (!latest) return null
  const text = typeof latest.text === 'string' ? latest.text.trim() : ''
  return text || null
}

function extractSelectedNodeTextPreview(node: Node): string | null {
  const data = asRecord(node.data)
  if (!data) return null
  const kind = typeof data.kind === 'string' ? data.kind.trim().toLowerCase() : ''
  const lastResult = asRecord(data.lastResult)
  const selectedStoryboardContext = readStoryboardSelectionContextFromCanvasNode(node)
  const currentImageResult = readCurrentCanvasNodeImageResult(node)
  const orderedCandidates =
    kind === 'text' || kind === 'storyboardscript' || kind === 'scriptdoc'
      ? [
          typeof data.text === 'string' ? data.text : '',
          typeof data.content === 'string' ? data.content : '',
          readLatestNodeTextResult(node) || '',
          typeof data.prompt === 'string' ? data.prompt : '',
          typeof lastResult?.text === 'string' ? lastResult.text : '',
        ]
      : [
          selectedStoryboardContext?.shotPrompt || '',
          currentImageResult?.storyboardShotPrompt || '',
          currentImageResult?.storyboardScript || '',
          typeof data.prompt === 'string' ? data.prompt : '',
          typeof data.text === 'string' ? data.text : '',
          typeof data.content === 'string' ? data.content : '',
          readLatestNodeTextResult(node) || '',
          typeof lastResult?.text === 'string' ? lastResult.text : '',
        ]
  const firstNonEmpty = orderedCandidates
    .map((value) => String(value || '').trim())
    .find(Boolean)
  if (!firstNonEmpty) return null
  const clipped = clipChatPreview(firstNonEmpty, SELECTED_NODE_TEXT_PREVIEW_MAX_CHARS)
  return clipped || null
}

function extractFocusedNodeResourceContext(node: Node): FocusedNodeResourceContext | null {
  const data: any = node?.data || {}
  const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : String(node?.id || '').trim() || '节点'
  const kind = typeof data.kind === 'string' && data.kind.trim() ? data.kind.trim() : null

  const imageCandidates = (() => {
    // 视觉理解只允许读取当前选中节点的主图。imageResults/videoResults 是该节点的
    // 历史产物集合，不能作为本轮图片上下文，否则小T会把历史图片一起送进 vision tool。
    const primaryImageUrl = pickPrimaryImageUrlFromNode(node)
    return primaryImageUrl ? [primaryImageUrl] : []
  })()

  if (!imageCandidates.length) return null

  return {
    nodeId: String(node?.id || '').trim(),
    label,
    kind,
    imageCandidates,
  }
}

function extractSelectedCanvasNodeContext(node: Node): SelectedCanvasNodeContext | null {
  const normalizedNodeId = String(node?.id || '').trim()
  if (!normalizedNodeId) return null
  const data = (node?.data || {}) as { label?: unknown; kind?: unknown }
  const label =
    typeof data.label === 'string' && data.label.trim()
      ? data.label.trim()
      : normalizedNodeId
  const kind = typeof data.kind === 'string' && data.kind.trim() ? data.kind.trim() : null
  const productionMeta = getNodeProductionMeta(node)
  const storyboardSelectionContext = readStoryboardSelectionContextFromCanvasNode(node)
  const selectedImageResult = readCurrentCanvasNodeImageResult(node)
  const anchorBindings = resolveSemanticNodeAnchorBindings(data)
  const semanticRoleBinding = resolveSemanticNodeRoleBinding(data)
  return {
    nodeId: normalizedNodeId,
    label,
    kind,
    anchorBindings,
    roleName: readTrimmedNodeStringField(node, 'roleName') || semanticRoleBinding.roleName,
    roleCardId: readTrimmedNodeStringField(node, 'roleCardId') || semanticRoleBinding.roleCardId,
    textPreview: extractSelectedNodeTextPreview(node),
    imageUrl: readImageUrlFromCanvasNode(node) || storyboardSelectionContext?.imageUrl || null,
    sourceUrl: readTrimmedNodeStringField(node, 'sourceUrl'),
    bookId:
      readTrimmedNodeStringField(node, 'sourceBookId')
      || readTrimmedNodeStringField(node, 'bookId')
      || storyboardSelectionContext?.sourceBookId
      || null,
    chapterId:
      readTrimmedNodeStringField(node, 'chapterId')
      || (() => {
        const chapter = readFiniteNodeNumberField(node, 'materialChapter') ?? readFiniteNodeNumberField(node, 'chapter')
        return typeof chapter === 'number' ? String(chapter) : null
      })()
      || (typeof storyboardSelectionContext?.materialChapter === 'number' ? String(storyboardSelectionContext.materialChapter) : null),
    shotNo:
      readFiniteNodeNumberField(node, 'shotNo')
      ?? selectedImageResult?.shotNo
      ?? storyboardSelectionContext?.shotNo
      ?? null,
    productionLayer: productionMeta.productionLayer ?? null,
    creationStage: productionMeta.creationStage ?? null,
    approvalStatus: productionMeta.approvalStatus ?? null,
    authorityBaseFrameNodeId: null,
    authorityBaseFrameStatus: null,
    storyboardSelectionContext,
    hasInlinePromptText: Boolean(
      storyboardSelectionContext?.shotPrompt
      || selectedImageResult?.storyboardShotPrompt
      || selectedImageResult?.prompt
      || selectedImageResult?.storyboardScript
      ||
      readTrimmedNodeStringField(node, 'prompt')
      || readTrimmedNodeStringField(node, 'text')
      || readTrimmedNodeStringField(node, 'content'),
    ),
    hasUpstreamTextEvidence: false,
    hasDownstreamComposeVideo: false,
  }
}

function normalizeNodeKind(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function isTextEvidenceNodeKind(kind: string): boolean {
  return kind === 'text' || kind === 'storyboardscript' || kind === 'scriptdoc'
}

function isCanvasChapterNodeKind(kind: string | null | undefined): boolean {
  if (!kind) return false
  const k = kind.toLowerCase()
  return k === 'text' || k === 'noveldoc' || k === 'scriptdoc'
}

function isComposeVideoNodeKind(kind: string): boolean {
  return kind === 'composevideo' || kind === 'video' || kind === 'storyboard'
}

function extractSelectedCanvasNodeContextFromGraph(
  node: Node,
  nodes: Node[],
  edges: Array<{ source?: string | null; target?: string | null }>,
): SelectedCanvasNodeContext | null {
  const base = extractSelectedCanvasNodeContext(node)
  if (!base) return null
  const nodeId = String(node.id || '').trim()
  if (!nodeId) return base

  const nodeMap = new Map<string, Node>(
    nodes.map((item) => [String(item.id || '').trim(), item] as const).filter(([id]) => Boolean(id)),
  )

  const incomingSourceKinds = edges
    .filter((edge) => String(edge.target || '').trim() === nodeId)
    .map((edge) => nodeMap.get(String(edge.source || '').trim()))
    .filter((item): item is Node => Boolean(item))
    .map((item) => normalizeNodeKind((item.data as { kind?: unknown } | undefined)?.kind))
    .filter(Boolean)

  const outgoingTargetKinds = edges
    .filter((edge) => String(edge.source || '').trim() === nodeId)
    .map((edge) => nodeMap.get(String(edge.target || '').trim()))
    .filter((item): item is Node => Boolean(item))
    .map((item) => normalizeNodeKind((item.data as { kind?: unknown } | undefined)?.kind))
    .filter(Boolean)

  const chapterGroundedMetadata = resolveChapterGroundedProductionMetadataForNode({
    selectedNode: node as Node<Record<string, unknown>>,
    nodes: nodes as Array<Node<Record<string, unknown>>>,
    edges: edges as Array<import('@xyflow/react').Edge<Record<string, unknown>>>,
  })
  const nodeData = asRecord(node.data)
  const anchorBindings = resolveSemanticNodeAnchorBindings(nodeData)
  const semanticRoleBinding = resolveSemanticNodeRoleBinding(nodeData)

  return {
    ...base,
    anchorBindings,
    roleName: readTrimmedString(nodeData?.roleName) || semanticRoleBinding.roleName,
    roleCardId: readTrimmedString(nodeData?.roleCardId) || semanticRoleBinding.roleCardId,
    authorityBaseFrameNodeId: chapterGroundedMetadata?.metadata.authorityBaseFrame.nodeId ?? null,
    authorityBaseFrameStatus: chapterGroundedMetadata?.metadata.authorityBaseFrame.status ?? null,
    hasUpstreamTextEvidence: incomingSourceKinds.some(isTextEvidenceNodeKind),
    hasDownstreamComposeVideo: outgoingTargetKinds.some(isComposeVideoNodeKind),
  }
}

function shouldShowProjectTextMaterialHint(input: {
  currentProjectId: string
  projectTextMaterialState: ProjectTextMaterialState
  selectedCanvasNodeContext: SelectedCanvasNodeContext | null
}): boolean {
  if (!input.currentProjectId) return false
  if (input.projectTextMaterialState.status !== 'ready') return false
  if (input.projectTextMaterialState.count <= 1) return false
  const selected = input.selectedCanvasNodeContext
  if (!selected) return true
  if (selected.hasInlinePromptText) return false
  if (selected.hasUpstreamTextEvidence) return false
  if (selected.bookId || selected.chapterId) return false
  if (typeof selected.shotNo === 'number') return false
  return true
}

function buildImplicitChatRequest(input: {
  selectedCanvasNodeContext: SelectedCanvasNodeContext | null
  referenceImageCount: number
  hasTargetImage: boolean
  activeSkillName: string | null
}): ImplicitChatRequest | null {
  const contextLabels: string[] = []
  if (input.selectedCanvasNodeContext?.nodeId) contextLabels.push('当前选中节点')
  if (input.referenceImageCount > 0) contextLabels.push(`参考图 ${input.referenceImageCount} 张`)
  if (input.hasTargetImage) contextLabels.push('目标效果图')
  if (input.activeSkillName) contextLabels.push(`已启用能力 ${input.activeSkillName}`)
  if (contextLabels.length === 0) return null

  const displayText = input.selectedCanvasNodeContext?.label
    ? `基于「${clipChatPreview(input.selectedCanvasNodeContext.label, 24)}」继续`
    : input.referenceImageCount > 0 || input.hasTargetImage
      ? '基于当前参考继续'
      : input.activeSkillName
        ? `基于「${clipChatPreview(input.activeSkillName, 24)}」继续`
        : '基于当前上下文继续'

  const lines = [
    '用户本轮没有额外输入文本，但主动发送了当前上下文。',
    `当前可用上下文：${contextLabels.join('、')}。`,
    '请先基于本轮真实上下文做最小必要取证，然后：',
    '1. 简要说明你当前确认到的上下文事实；',
    '2. 明确指出你建议的下一步，或仍然缺少的关键信息；',
    '3. 若这是显式、确定性的画布改动且证据已经充分，可以直接执行；否则不要臆造用户意图。',
  ]

  return {
    prompt: lines.join('\n'),
    displayText,
  }
}

type AttachMenuTargetProps = React.ComponentPropsWithoutRef<typeof ActionIcon> & {
  tooltip: string
}

const AttachMenuTarget = React.forwardRef<HTMLButtonElement, AttachMenuTargetProps>(function AttachMenuTarget(
  { tooltip, ...props },
  ref,
): JSX.Element {
  return (
    <Tooltip className="tc-ai-chat__tooltip" label={tooltip} withArrow>
      <ActionIcon ref={ref} className="tc-ai-chat__attach" variant="subtle" aria-label="参考图" {...props}>
        <IconPaperclip className="tc-ai-chat__attach-icon" size={16} />
      </ActionIcon>
    </Tooltip>
  )
})

function ReferenceImagesStrip({
  urls,
  onClear,
  disabled,
  className,
}: {
  urls: string[]
  onClear: () => void
  disabled?: boolean
  className?: string
}): JSX.Element | null {
  if (!urls.length) return null

  const refsClassName = ['tc-ai-chat__refs', className].filter(Boolean).join(' ')

  return (
    <Group className={refsClassName} gap={8} mt={8} align="center" wrap="wrap">
      {urls.map((url, idx) => (
        <div key={url} className="tc-ai-chat__ref">
          <button
            type="button"
            className="tc-ai-chat__ref-button"
            aria-label={`参考图-${idx + 1}`}
            onClick={() => {
              try {
                window.open(url, '_blank', 'noopener,noreferrer')
              } catch {
                // ignore
              }
            }}
            disabled={disabled}
          >
            <ManagedImage className="tc-ai-chat__ref-thumb" src={url} alt={`参考图-${idx + 1}`} priority="visible" />
          </button>
        </div>
      ))}

      <ActionIcon
        className="tc-ai-chat__refs-clear"
        size={42}
        radius="xs"
        variant="subtle"
        aria-label={$('清空参考图')}
        onClick={onClear}
        disabled={disabled}
      >
        <IconTrash className="tc-ai-chat__refs-clear-icon" size={14} />
      </ActionIcon>
    </Group>
  )
}

const CREATIVE_QUICK_ACTIONS = [
  { key: 'continue', label: '继续写', prompt: '继续，接着刚才的情节往下写' },
  { key: 'switch', label: '换方向', prompt: '换一个发展方向，给出不同的走向' },
  { key: 'expand', label: '展开场景', prompt: '展开这个场景的环境描写和氛围细节' },
  { key: 'character', label: '加入角色', prompt: '在当前场景中自然引入一个新角色' },
  { key: 'next', label: '下一场', prompt: '跳到下一个场景，给一个清晰的转场' },
] as const

const CREATIVE_BRIEF_START = '---创作简报---'
const CREATIVE_BRIEF_END = '---简报结束---'

function parseBriefCard(content: string): string | null {
  const start = content.indexOf(CREATIVE_BRIEF_START)
  const end = start === -1
    ? -1
    : content.indexOf(CREATIVE_BRIEF_END, start + CREATIVE_BRIEF_START.length)
  if (start === -1 || end === -1 || end <= start) return null
  return content.slice(start + CREATIVE_BRIEF_START.length, end).trim()
}

// Seko 式任务清单：todo 为主干（✓/spinner/空心圆），工具调用作为子步骤挂在
// 其启动时 in_progress 的任务下，可折叠；没有 todo 时子步骤平铺成清单。
function ChatTaskPlan({
  messageId,
  todoItems,
  toolSteps,
  active,
  turnDurationMs,
}: {
  messageId: string
  todoItems: ChatTodoItem[]
  toolSteps: ChatToolStep[]
  active: boolean
  /** 本轮总耗时（毫秒）；仅终态传入，渲染在清单底部 */
  turnDurationMs?: number
}): JSX.Element | null {
  const [detailsExpanded, setDetailsExpanded] = React.useState(false)
  const [expandOverrides, setExpandOverrides] = React.useState<Record<number, boolean>>({})
  const hasTodos = todoItems.length > 0
  // 当前阶段或工具仍在执行时每秒滴答一次；即使两个工具调用之间存在模型思考间隙，
  // 阶段墙钟耗时也必须连续，不能因当前没有 running tool 而冻结。
  const hasRunningStep = toolSteps.some((step) => step.status === 'running')
  const hasRunningStage = active && (
    todoItems.some((item) => item.status === 'in_progress')
    || toolSteps.length > 0
  )
  const hasToolFailure = toolSteps.some((step) => (
    step.severity !== 'warning'
    && (step.status === 'failed' || step.status === 'denied' || step.status === 'blocked')
  ))
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!hasRunningStep && !hasRunningStage) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasRunningStage, hasRunningStep])
  React.useEffect(() => {
    if (hasToolFailure) setDetailsExpanded(true)
  }, [hasToolFailure])
  // 批量出图逐张进度（"已完成 3/8 张"）：后端经画布频道推送，按 toolCallId 关联到 running 步骤。
  const progressByCall = useToolProgressStore((s) => s.byCallId)
  // Knowledge tools are shown once in their own evidence strip; production/tool steps stay attached to todo rows.
  const knowledgeSteps = React.useMemo(
    () => toolSteps.filter((step) => isKnowledgeToolName(step.toolName)),
    [toolSteps],
  )
  const timelineToolSteps = React.useMemo(
    () => toolSteps.filter((step) => !isKnowledgeToolName(step.toolName)),
    [toolSteps],
  )
  const stepsByAnchor = React.useMemo(() => {
    const map = new Map<number, ChatToolStep[]>()
    for (const step of timelineToolSteps) {
      // 位置锚定在 todo 增删后必然漂移：越界/非法索引一律降级为 orphan 段，
      // 绝不 clamp 到末行（否则步骤会挂到错误的任务行下，造成「队列样式错乱」#14）。
      const anchor = hasTodos
        && Number.isInteger(step.anchorTodoIndex)
        && step.anchorTodoIndex >= 0
        && step.anchorTodoIndex < todoItems.length
        ? step.anchorTodoIndex
        : -1
      const list = map.get(anchor) ?? []
      list.push(step)
      map.set(anchor, list)
    }
    return map
  }, [timelineToolSteps, todoItems.length, hasTodos])
  // todo 列表增删后，旧的「按索引展开」状态会错位到别的任务行（#15）：列表内容
  // 变化时整体重置展开覆盖，避免展开态错误迁移。
  const todoSignature = React.useMemo(
    () => todoItems.map((item) => item.content).join('\u0001'),
    [todoItems],
  )
  const prevTodoSignatureRef = React.useRef(todoSignature)
  React.useEffect(() => {
    if (prevTodoSignatureRef.current === todoSignature) return
    prevTodoSignatureRef.current = todoSignature
    setExpandOverrides({})
  }, [todoSignature])
  if (!hasTodos && !toolSteps.length) return null

  const runningStep = [...toolSteps].reverse().find((step) => step.status === 'running') ?? null
  const failedStep = [...toolSteps].reverse().find((step) =>
    step.severity !== 'warning' &&
    (step.status === 'failed' || step.status === 'denied' || step.status === 'blocked'),
  ) ?? null
  const currentStep = runningStep ?? failedStep
  const failedCount = toolSteps.filter((step) =>
    step.severity !== 'warning' &&
    (step.status === 'failed' || step.status === 'denied' || step.status === 'blocked'),
  ).length
  const warningCount = toolSteps.filter((step) => step.severity === 'warning').length
  const completedTodoCount = todoItems.filter((item) => item.status === 'completed').length
  const executionStage = resolveChatExecutionStage({
    todoItems,
    toolSteps,
    active,
    observedAtMs: now,
  })
  // 失败优先于阶段摘要：折叠态直接给出失败工具名，错误色（对齐 DSH ToolRow 的
  // "error row 折叠摘要即失败首行" 设计），避免用户必须展开清单才能看到异常。
  const summary = executionStage && !failedStep
    ? `当前阶段 · ${executionStage.label}`
    : failedStep
      ? `执行异常 · ${failedStep.label}`
      : toolSteps.length > 0
      ? buildToolStepSummary({
          totalCount: toolSteps.length,
          currentToolLabel: currentStep?.label ?? null,
          failedCount,
          warningCount,
          active: active && runningStep !== null,
        })
      : `任务进度 · ${completedTodoCount}/${todoItems.length}`
  const summaryState = executionStage && !failedStep ? 'active' : failedStep ? 'failed' : 'completed'

  const renderSubsteps = (steps: ChatToolStep[], keyPrefix: string) => (
    <div className="tc-ai-plan__substeps">
      {steps.map((step) => {
        // running：显示客户端实时累计耗时（每秒滴答），让长任务可观测、不像卡死；
        // 终态：显示服务端下发的最终耗时。
        const duration =
          step.status === 'running'
            ? (typeof step.startedAt === 'number' ? formatDurationMs(Math.max(0, now - step.startedAt)) : null)
            : formatDurationMs(step.durationMs)
        // running 的批量出图：显示"已完成 3/8 张"实时计数（后端每张决议推送），避免一批 8 张看着像卡死。
        const batch = step.status === 'running' ? selectToolProgress(step.callId, { byCallId: progressByCall }) : undefined
        // 未命中中文映射时挂英文原名灰色小字，方便排查是哪个新工具高耗时。
        const rawName = isMappedTool(step.toolName) ? null : readPresentedToolName(step.toolName)
        return (
          <div key={`${keyPrefix}_${step.callId}`} className={`tc-ai-plan__substep tc-ai-plan__substep--${step.severity === 'warning' ? 'warning' : step.status}`} data-status={step.status}>
            <span className="tc-ai-plan__substep-mark" aria-hidden="true">
              {step.status === 'running' ? <span className="tc-ai-plan__spinner" /> : step.severity === 'warning' ? '⚠' : step.status === 'succeeded' ? '✓' : step.status === 'cancelled' ? '⊘' : '✕'}
            </span>
            <span className="tc-ai-plan__substep-label">
              {step.label}
              {rawName ? <span className="tc-ai-plan__substep-raw">{rawName}</span> : null}
            </span>
            {batch ? <span className="tc-ai-plan__progress">{formatBatchProgressLabel(batch)}</span> : null}
            {duration ? <span className="tc-ai-plan__duration">{duration}</span> : null}
          </div>
        )
      })}
    </div>
  )

  const orphanSteps = stepsByAnchor.get(-1) ?? []
  return (
    <div className={`tc-ai-plan${knowledgeSteps.length > 0 ? ' tc-ai-plan--knowledge' : ''}`} aria-label="task-plan">
      <button
        type="button"
        className="tc-ai-plan__summary"
        data-state={summaryState}
        aria-expanded={detailsExpanded}
        onClick={() => setDetailsExpanded((expanded) => !expanded)}
      >
        <span className={`tc-ai-plan__summary-mark tc-ai-plan__summary-mark--${summaryState}`} aria-hidden="true">
          {summaryState === 'active' ? <span className="tc-ai-plan__spinner" /> : summaryState === 'completed' ? '✓' : '!'}
        </span>
        <span className="tc-ai-plan__summary-label">{summary}</span>
        {failedCount > 0 ? (
          <span className="tc-ai-plan__summary-failed-count" aria-label={`${failedCount} 次异常`}>{failedCount}</span>
        ) : null}
        {executionStage && formatDurationMs(executionStage.elapsedMs) ? (
          <span className="tc-ai-plan__stage-duration">{formatDurationMs(executionStage.elapsedMs)}</span>
        ) : null}
        <span className={`tc-ai-plan__chevron${detailsExpanded ? ' tc-ai-plan__chevron--open' : ''}`} aria-hidden="true">
          <IconChevronDown size={13} />
        </span>
      </button>
      {detailsExpanded ? <KnowledgeTaskExternal steps={knowledgeSteps} now={now} /> : null}
      {detailsExpanded && orphanSteps.length > 0 ? renderSubsteps(orphanSteps, `${messageId}_orphan`) : null}
      {todoItems.map((item, index) => {
        const steps = stepsByAnchor.get(index) ?? []
        const expandable = steps.length > 0
        const defaultExpanded = steps.some((step) => (
          step.severity !== 'warning'
          && (step.status === 'failed' || step.status === 'denied' || step.status === 'blocked')
        ))
        const expanded = expandable && (expandOverrides[index] ?? (detailsExpanded || defaultExpanded))
        return (
          <div key={`${messageId}_plan_${index}`} className={`tc-ai-plan__item tc-ai-plan__item--${item.status}`} data-status={item.status}>
            <button
              type="button"
              className="tc-ai-plan__row"
              disabled={!expandable}
              onClick={() => setExpandOverrides((prev) => ({ ...prev, [index]: !expanded }))}
            >
              <span className={`tc-ai-plan__mark tc-ai-plan__mark--${item.status}`} aria-hidden="true">
                {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? <span className="tc-ai-plan__spinner" /> : ''}
              </span>
              <span className="tc-ai-plan__label">{item.content}</span>
              {item.status === 'in_progress' && typeof item.startedAt === 'number' && formatDurationMs(Math.max(0, now - item.startedAt)) ? (
                <span className="tc-ai-plan__duration">{formatDurationMs(Math.max(0, now - item.startedAt))}</span>
              ) : item.status === 'completed' && formatDurationMs(item.durationMs) ? (
                <span className="tc-ai-plan__duration">{formatDurationMs(item.durationMs)}</span>
              ) : null}
              {expandable ? (
                <span className={`tc-ai-plan__chevron${expanded ? ' tc-ai-plan__chevron--open' : ''}`} aria-hidden="true">
                  <IconChevronDown size={13} />
                </span>
              ) : null}
            </button>
            {expanded ? renderSubsteps(steps, `${messageId}_plan_${index}`) : null}
          </div>
        )
      })}
      {(todoItems.length > 0 || toolSteps.length > 0 || formatDurationMs(turnDurationMs)) ? (
        <div className="tc-ai-plan__stats" aria-label="turn-stats">
          {todoItems.length > 0 ? (
            <span className="tc-ai-plan__stats-group">
              <span className="tc-ai-plan__stats-label">任务</span>
              <span className="tc-ai-plan__stats-value">{completedTodoCount}/{todoItems.length}</span>
            </span>
          ) : null}
          {toolSteps.length > 0 ? (
            <span className="tc-ai-plan__stats-group">
              <span className="tc-ai-plan__stats-label">工具调用</span>
              <span className="tc-ai-plan__stats-value">{toolSteps.length}</span>
            </span>
          ) : null}
          {failedCount > 0 ? (
            <span className="tc-ai-plan__stats-group tc-ai-plan__stats-group--failed">
              <span className="tc-ai-plan__stats-label">异常</span>
              <span className="tc-ai-plan__stats-value">{failedCount}</span>
            </span>
          ) : null}
          {formatDurationMs(turnDurationMs) ? (
            <span className="tc-ai-plan__stats-group tc-ai-plan__stats-group--duration">
              <span className="tc-ai-plan__stats-label">本轮耗时</span>
              <span className="tc-ai-plan__stats-value">{formatDurationMs(turnDurationMs)}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ChatBubbleView({
  message,
  isCreativeMode,
  onConfirmBrief,
  confirmBriefPending,
  onChoiceSubmit,
}: {
  message: ChatMessage
  isCreativeMode?: boolean
  onConfirmBrief?: (briefContent: string) => void | Promise<void>
  confirmBriefPending?: boolean
  onChoiceSubmit?: (response: { requestId: string; answers: PendingUserInputAnswer[] }) => void
}): JSX.Element {
  const isUser = message.role === 'user'
  const isCodex = !isUser && message.source === 'codex'
  const visibleWorkingRoles = React.useMemo<ChatWorkingRole[]>(() => {
    const roles = Array.isArray(message.workingRoles) ? message.workingRoles : []
    if (message.kind === 'progress') return roles
    return roles.map((role) =>
      role.status === 'running' || role.status === 'queued'
        ? { ...role, status: 'failed' as const, progressSummary: role.progressSummary || '对话已收尾，但未收到该子代理的完成事件' }
        : role,
    )
  }, [message.kind, message.workingRoles])
  // 气泡头像/名字按本轮实际干活的角色自动渲染：有子角色在跑/已干活则取主角色，否则=小T（导演）。
  // 同时记录主角色的 agentId，下方工作角色 chip 列表据此剔除主角色，避免头部与 chip 重复展示同一角色。
  const { displayRole, primaryRoleAgentId } = React.useMemo<{ displayRole: TeamRole; primaryRoleAgentId: string | null }>(() => {
    if (isUser) return { displayRole: XIAOT_ROLE, primaryRoleAgentId: null }
    const roles = visibleWorkingRoles
    if (roles.length > 0) {
      const running = roles.find((r) => r.status === 'running')
      const primary = running ?? roles[roles.length - 1]
      return { displayRole: getTeamRole(primary.role) ?? XIAOT_ROLE, primaryRoleAgentId: primary.agentId }
    }
    return { displayRole: XIAOT_ROLE, primaryRoleAgentId: null }
  }, [isUser, visibleWorkingRoles])
  // 头部已展示主角色身份，chip 列表只渲染其余协作角色，避免重复。
  const secondaryWorkingRoles = React.useMemo(
    () => visibleWorkingRoles.filter((r) => r.agentId !== primaryRoleAgentId),
    [visibleWorkingRoles, primaryRoleAgentId],
  )

  const { markdownText, todoItems } = React.useMemo(
    () => extractLatestTodoBlock(message.content),
    [message.content],
  )
  const thinkingSummary = React.useMemo(() => summarizeThinkingText(message.content), [message.content])
  const planTodoItems = React.useMemo(
    () => {
      const items = selectAgentTodoItems({
        structuredTodoItems: message.todoSnapshot,
        inlineTodoItems: todoItems,
      })
      return message.kind === 'progress' ? items : terminalizeOpenTodos(items)
    },
    [message.kind, message.todoSnapshot, todoItems],
  )
  const taskPlanActive = message.kind === 'progress'
  const planToolSteps = React.useMemo(
    () => {
      const steps = Array.isArray(message.toolSteps) ? message.toolSteps : []
      if (message.kind === 'progress') return steps
      return steps.map((step) =>
        step.status === 'running' ? { ...step, status: 'failed' as const } : step,
      )
    },
    [message.kind, message.toolSteps],
  )
  // 只有清单已经进入具体阶段时，清单摘要才是唯一权威的运行指示器；
  // 清单刚建立但尚未进入阶段时，保留头部 spinner 作为兜底，避免没有任何进行中反馈。
  const hasActiveTaskPlan = taskPlanActive && (
    planTodoItems.some((item) => item.status === 'in_progress')
    || planToolSteps.length > 0
  )
  const verdictSummary = React.useMemo(
    () => formatTurnVerdictSummary(message.turnVerdict ?? null),
    [message.turnVerdict],
  )
  const diagnosticFlags = React.useMemo(
    () => Array.isArray(message.diagnosticFlags) ? message.diagnosticFlags : [],
    [message.diagnosticFlags],
  )
  const referenceDocuments = React.useMemo<ChatReferenceDocuments>(
    () => message.referenceDocuments ?? { skills: [], knowledge: [] },
    [message.referenceDocuments],
  )
  const briefCard = React.useMemo(
    () => (!isUser && isCreativeMode && message.phase !== 'thinking') ? parseBriefCard(markdownText) : null,
    [isUser, isCreativeMode, message.phase, markdownText],
  )
  const markdownTextWithoutBrief = React.useMemo(() => {
    if (!briefCard) return markdownText
    const start = markdownText.indexOf(CREATIVE_BRIEF_START)
    const end = start === -1
      ? -1
      : markdownText.indexOf(CREATIVE_BRIEF_END, start + CREATIVE_BRIEF_START.length)
    if (start === -1 || end === -1) return markdownText
    return (markdownText.slice(0, start) + markdownText.slice(end + CREATIVE_BRIEF_END.length)).trim()
  }, [markdownText, briefCard])
  // ```tc-card 围栏 → 内联富卡：从正文剥离，与服务端下发的 blocks 按 id 合并（兼容历史会话与 blocks 灰度关闭场景）。
  const { cleanedText: markdownTextSansCards, dataBlocks: inlineCardBlocks } = React.useMemo(
    () => extractTcCardBlocks(markdownTextWithoutBrief),
    [markdownTextWithoutBrief],
  )
  // ```choices 围栏 → 内联选项卡（仅 assistant 消息；用户粘贴的 JSON 不转卡）。
  // 历史恢复时 blocks 不落库，正文围栏经这里重新解析；id 哈希稳定，可与流式沉淀/服务端 blocks 去重。
  const { cleanedText: markdownTextSansChoices, dataBlocks: inlineChoicesBlocks } = React.useMemo(
    () => (isUser
      ? { cleanedText: markdownTextSansCards, dataBlocks: [] }
      : extractChoicesCardBlocks(markdownTextSansCards)),
    [isUser, markdownTextSansCards],
  )
  const mergedBlocks = React.useMemo(
    () => mergeInlineCardBlocks(message.blocks, [...inlineCardBlocks, ...inlineChoicesBlocks]),
    [message.blocks, inlineCardBlocks, inlineChoicesBlocks],
  )
  // 流式期间裁掉尾部未闭合的选项围栏/裸 JSON，根治选项 JSON 中间态闪现。
  const displayMarkdownText = React.useMemo(
    () => (!isUser && message.phase !== 'final' ? trimDanglingChoices(markdownTextSansChoices) : markdownTextSansChoices),
    [isUser, message.phase, markdownTextSansChoices],
  )
  const shouldRenderMarkdown = Boolean(String(displayMarkdownText || '').trim())
  const wrapClassName = [
    'tc-ai-chat-bubble',
    isUser ? 'tc-ai-chat-bubble--user' : 'tc-ai-chat-bubble--assistant',
    !isUser && isCreativeMode ? 'tc-ai-chat-bubble--creative' : '',
  ].filter(Boolean).join(' ')

  return (
    <Group className={wrapClassName} justify={isUser ? 'flex-end' : 'flex-start'} align="flex-start" gap={10} wrap="nowrap">
      <PanelCard className="tc-ai-chat-bubble__card" padding="compact">
        <Group className="tc-ai-chat-bubble__meta" justify="space-between" align="center" gap={10} mb={6} wrap="nowrap">
          <Group className="tc-ai-chat-bubble__meta-left" gap={6} align="center" wrap="nowrap">
            {!isUser && isCodex ? (
              <IconTerminal2
                className="tc-ai-chat-bubble__avatar tc-ai-chat-bubble__avatar--codex"
                size={18}
                aria-hidden="true"
              />
            ) : !isUser ? (
              <Tooltip
                label={`${displayRole.name} · ${displayRole.description}`}
                multiline
                w={240}
                withArrow
                position="top-start"
                openDelay={250}
                withinPortal
                zIndex={10050}
              >
                <img
                  className="tc-ai-chat-bubble__avatar"
                  src={displayRole.avatar}
                  alt={displayRole.name}
                />
              </Tooltip>
            ) : null}
            <Badge className="tc-ai-chat-bubble__role" size="xs" radius="sm" variant="light" color="gray">
              {isUser ? $('你') : isCodex ? 'Codex' : displayRole.name}
            </Badge>
            {!isUser && message.turnVerdict?.status === 'partial' ? (
              <Badge className="tc-ai-chat-bubble__verdict-badge" size="xs" radius="sm" variant="light" color="yellow">
                {$('部分完成')}
              </Badge>
            ) : null}
            {!isUser && message.turnVerdict?.status === 'failed' ? (
              <Badge className="tc-ai-chat-bubble__verdict-badge" size="xs" radius="sm" variant="light" color="red">
                {$('结构失败')}
              </Badge>
            ) : null}
          </Group>
          <Text className="tc-ai-chat-bubble__time" size="xs" c="dimmed">
            {message.ts}
          </Text>
        </Group>
        {!isUser && verdictSummary ? (
          <div className="tc-ai-chat-bubble__verdict">
            <Text className="tc-ai-chat-bubble__verdict-text" size="xs" c={message.turnVerdict?.status === 'failed' ? 'red' : 'yellow'}>
              {verdictSummary}
            </Text>
          </div>
        ) : null}
        {message.phase === 'thinking' && !isUser ? (
          <div className="tc-ai-chat-thinking" aria-label="ai-chat-thinking">
            <div className="tc-ai-chat-thinking__header">
              {!hasActiveTaskPlan ? <span className="tc-ai-plan__spinner" aria-hidden="true" /> : null}
              <Text className="tc-ai-chat-thinking__title">{thinkingSummary}</Text>
            </div>
            {secondaryWorkingRoles.length > 0 ? (
              <div className="tc-ai-chat-roles" aria-label="ai-chat-working-roles">
                {secondaryWorkingRoles.map((roleItem) => (
                  <span
                    key={roleItem.agentId}
                    className={`tc-ai-chat-role-chip tc-ai-chat-role-chip--${roleItem.status}`}
                    title={roleItem.progressSummary || roleItem.roleName}
                  >
                    <img className="tc-ai-chat-role-chip__avatar" src={teamRoleAvatar(roleItem.role)} alt="" aria-hidden="true" />
                    <span className="tc-ai-chat-role-chip__name">{teamRoleName(roleItem.role) || roleItem.roleName}</span>
                    {roleItem.status === 'running' ? (
                      <span className="tc-ai-plan__spinner tc-ai-chat-role-chip__spinner" aria-hidden="true" />
                    ) : roleItem.status === 'completed' || roleItem.status === 'idle' ? (
                      <span className="tc-ai-chat-role-chip__mark" aria-hidden="true">✓</span>
                    ) : roleItem.status === 'failed' ? (
                      <span className="tc-ai-chat-role-chip__mark" aria-hidden="true">✕</span>
                    ) : null}
                  </span>
                ))}
              </div>
            ) : null}
            <ChatTaskPlan messageId={message.id} todoItems={planTodoItems} toolSteps={planToolSteps} active={taskPlanActive} />
          </div>
        ) : (
          <>
          {!isUser && secondaryWorkingRoles.length > 0 ? (
            <div className="tc-ai-chat-roles tc-ai-chat-roles--final" aria-label="ai-chat-worked-roles">
              {secondaryWorkingRoles.map((roleItem) => (
                <span
                  key={roleItem.agentId}
                  className={`tc-ai-chat-role-chip tc-ai-chat-role-chip--${roleItem.status}`}
                  title={roleItem.progressSummary || roleItem.roleName}
                >
                  <img className="tc-ai-chat-role-chip__avatar" src={teamRoleAvatar(roleItem.role)} alt="" aria-hidden="true" />
                  <span className="tc-ai-chat-role-chip__name">{teamRoleName(roleItem.role) || roleItem.roleName}</span>
                </span>
              ))}
            </div>
          ) : null}
          {!isUser && (planTodoItems.length > 0 || planToolSteps.length > 0) ? (
            <ChatTaskPlan
              messageId={message.id}
              todoItems={planTodoItems}
              toolSteps={planToolSteps}
              active={taskPlanActive}
              turnDurationMs={message.turnDurationMs}
            />
          ) : null}
          <div className="tc-ai-chat-bubble__content tc-ai-chat-markdown">
            {shouldRenderMarkdown ? (
                    <ReactMarkdown
                      remarkPlugins={CHAT_REMARK_PLUGINS}
                      components={{
                        p: ({ node, ...props }) =>
                          // 段落含图片时用 <div>（合法 flow 容器），否则保持 <p>。
                          // 避免 ManagedImage(<div>) 落进 <p> 触发非法嵌套 → 死循环重渲染。
                          markdownNodeHasImage(node) ? (
                            <div className="tc-ai-chat-markdown__paragraph" {...(props as Record<string, unknown>)} />
                          ) : (
                            <p className="tc-ai-chat-markdown__paragraph" {...props} />
                          ),
                        a: ({ node: _node, ...props }) => <a className="tc-ai-chat-markdown__link" target="_blank" rel="noreferrer" {...props} />,
                        ul: ({ node: _node, ...props }) => <ul className="tc-ai-chat-markdown__list tc-ai-chat-markdown__list--unordered" {...props} />,
                        ol: ({ node: _node, ...props }) => <ol className="tc-ai-chat-markdown__list tc-ai-chat-markdown__list--ordered" {...props} />,
                        li: ({ node: _node, ...props }) => <li className="tc-ai-chat-markdown__list-item" {...props} />,
                        blockquote: ({ node: _node, ...props }) => <blockquote className="tc-ai-chat-markdown__blockquote" {...props} />,
                        img: ({ node: _node, src, alt, ...props }) => {
                          const url = String(src || '').trim()
                          if (url && isLikelyImageUrl(url)) {
                            return (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="tc-ai-chat-bubble__asset-link tc-ai-chat-markdown__image-link"
                              >
                                <ManagedImage className="tc-ai-chat-bubble__asset-image" src={url} alt={String(alt || 'image')} />
                              </a>
                            )
                          }
                          return <img className="tc-ai-chat-markdown__image" loading="lazy" referrerPolicy="no-referrer" src={src} alt={alt} {...props} />
                        },
                        h1: ({ node: _node, ...props }) => <h1 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h1" {...props} />,
                        h2: ({ node: _node, ...props }) => <h2 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h2" {...props} />,
                        h3: ({ node: _node, ...props }) => <h3 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h3" {...props} />,
                        h4: ({ node: _node, ...props }) => <h4 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h4" {...props} />,
                        code: ({ node: _node, className, children, ...props }) => {
                          const lang = String(className || '')
                          const isInline = !lang.includes('language-')
                          if (isInline) {
                            return <code className="tc-ai-chat-markdown__code tc-ai-chat-markdown__code--inline" {...props}>{children}</code>
                          }
                          return <code className={`tc-ai-chat-markdown__code tc-ai-chat-markdown__code--block ${className || ''}`.trim()} {...props}>{children}</code>
                        },
                        pre: ({ node: _node, ...props }) => <pre className="tc-ai-chat-markdown__pre" {...props} />,
                        hr: ({ node: _node, ...props }) => <hr className="tc-ai-chat-markdown__divider" {...props} />,
                        table: ({ node: _node, ...props }) => (
                          <div className="tc-ai-chat-markdown__table-scroll">
                            <table className="tc-ai-chat-markdown__table" {...props} />
                          </div>
                        ),
                        thead: ({ node: _node, ...props }) => <thead className="tc-ai-chat-markdown__table-head" {...props} />,
                        tbody: ({ node: _node, ...props }) => <tbody className="tc-ai-chat-markdown__table-body" {...props} />,
                        tr: ({ node: _node, ...props }) => <tr className="tc-ai-chat-markdown__table-row" {...props} />,
                        th: ({ node: _node, ...props }) => <th className="tc-ai-chat-markdown__table-cell tc-ai-chat-markdown__table-cell--head" {...props} />,
                        td: ({ node: _node, ...props }) => <td className="tc-ai-chat-markdown__table-cell tc-ai-chat-markdown__table-cell--body" {...props} />,
                      }}
                    >
                      {linkifyImageUrls(displayMarkdownText)}
                    </ReactMarkdown>
            ) : null}
            {briefCard ? (
              <div className="tc-ai-chat-bubble__brief-card">
                <Text className="tc-ai-chat-bubble__brief-card-title" size="xs" fw={700} mb={6}>
                  创作简报
                </Text>
                <div className="tc-ai-chat-markdown">
                  <ReactMarkdown
                    remarkPlugins={CHAT_REMARK_PLUGINS}
                    components={{
                      p: ({ node: _node, ...props }) => <p className="tc-ai-chat-markdown__paragraph" {...props} />,
                      strong: ({ node: _node, ...props }) => <strong className="tc-ai-chat-markdown__strong" {...props} />,
                      h2: ({ node: _node, ...props }) => <h2 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h2" {...props} />,
                      h3: ({ node: _node, ...props }) => <h3 className="tc-ai-chat-markdown__heading tc-ai-chat-markdown__heading--h3" {...props} />,
                      ul: ({ node: _node, ...props }) => <ul className="tc-ai-chat-markdown__list tc-ai-chat-markdown__list--unordered" {...props} />,
                      li: ({ node: _node, ...props }) => <li className="tc-ai-chat-markdown__list-item" {...props} />,
                    }}
                  >
                    {briefCard}
                  </ReactMarkdown>
                </div>
                {onConfirmBrief ? (
                  <Button
                    className="tc-ai-chat-bubble__brief-confirm-btn"
                    size="xs"
                    variant="filled"
                    color="gray"
                    mt={10}
                    loading={confirmBriefPending}
                    disabled={confirmBriefPending}
                    onClick={() => { void onConfirmBrief(briefCard) }}
                  >
                    ✓ 确认并继续
                  </Button>
                ) : null}
              </div>
            ) : null}
            {!isUser && message.pendingUserInput && message.phase === 'final' && onChoiceSubmit ? (
              <PendingUserInputChoices
                request={message.pendingUserInput}
                onSubmit={onChoiceSubmit}
              />
            ) : null}
            {!isUser && message.kind === 'progress' ? (
              <div className="tc-ai-chat-bubble__streaming-indicator" aria-hidden="true">
                <div className="tc-ai-chat-bubble__streaming-bar" />
              </div>
            ) : null}
          </div>
          </>
        )}
        {!isUser && diagnosticFlags.length > 0 ? (
          <div className="tc-ai-chat-bubble__diagnostics" aria-label="chat-diagnostics">
            <Stack className="tc-ai-chat-bubble__diagnostics-list" gap={6} mt={8}>
              {diagnosticFlags.map((flag, index) => (
                <div key={`${message.id}_diagnostic_${flag.code}_${index}`} className="tc-ai-chat-bubble__diagnostic-item">
                  <Group className="tc-ai-chat-bubble__diagnostic-header" gap={8} align="center" wrap="nowrap">
                    <Badge
                      className="tc-ai-chat-bubble__diagnostic-badge"
                      size="xs"
                      radius="sm"
                      variant="light"
                      color={flag.severity === 'high' ? 'red' : 'yellow'}
                    >
                      {flag.severity === 'high' ? $('高风险') : $('提示')}
                    </Badge>
                    <Text className="tc-ai-chat-bubble__diagnostic-title" size="xs" fw={700}>
                      {flag.title}
                    </Text>
                  </Group>
                  <Text className="tc-ai-chat-bubble__diagnostic-detail" size="xs" c="dimmed">
                    {flag.detail}
                  </Text>
                </div>
              ))}
            </Stack>
          </div>
        ) : null}
        {mergedBlocks.length > 0 ? (
          // 媒体块（图片/视频/音频）只在本轮收尾(final)后渲染：流式期间每个 block delta 都会
          // patch message.blocks，若此时就挂 ManagedImage，会随每次重渲染反复重挂载导致闪烁。
          // 等 phase==='final' 一次性渲染，根治流式图片闪烁。非 final 期间传 streaming 让 BlockList 跳过 media。
          <BlockList blocks={mergedBlocks} streaming={message.phase !== 'final'} />
        ) : null}
        {message.phase === 'final' && !blocksHaveMedia(message.blocks) && Array.isArray(message.assets) && message.assets.length > 0 ? (
          <Group className="tc-ai-chat-bubble__assets" gap={8} mt={8} align="flex-start" wrap="wrap">
            {message.assets.map((asset, idx) => (
              <MediaItemView
                key={`${message.id}_asset_${idx}`}
                item={{
                  kind: asset.mediaType,
                  url: asset.url,
                  title: asset.title,
                  ...(asset.thumbnailUrl ? { thumbnailUrl: asset.thumbnailUrl } : null),
                }}
                index={idx}
              />
            ))}
          </Group>
        ) : null}
        {!isUser && message.phase === 'final' && (referenceDocuments.skills.length > 0 || referenceDocuments.knowledge.length > 0) ? (
          <div className="tc-ai-chat-bubble__references" aria-label="本轮引用文档">
            <IconFileText
              className="tc-ai-chat-bubble__references-icon"
              size={13}
              stroke={1.8}
              aria-hidden="true"
            />
            <div className="tc-ai-chat-bubble__references-groups">
              {referenceDocuments.skills.length > 0 ? (
                <div className="tc-ai-chat-bubble__references-group">
                  <span className="tc-ai-chat-bubble__references-label">Skill</span>
                  <span className="tc-ai-chat-bubble__references-documents">
                    {referenceDocuments.skills.join(' · ')}
                  </span>
                </div>
              ) : null}
              {referenceDocuments.knowledge.length > 0 ? (
                <div className="tc-ai-chat-bubble__references-group">
                  <span className="tc-ai-chat-bubble__references-label">知识库</span>
                  <span className="tc-ai-chat-bubble__references-documents">
                    {referenceDocuments.knowledge.join(' · ')}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {/* 后续建议「选项卡」已迁到对话底部输入框上方统一渲染（见 tc-ai-chat__suggestions-bar），
            此处不再内联渲染，避免每条气泡各出一组、且贴不到输入区。 */}
      </PanelCard>
    </Group>
  )
}

const ChatBubble = React.memo(ChatBubbleView)

export default function AiChatDialog({ className }: { className?: string }): JSX.Element | null {
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const conversationIdRef = React.useRef<string>(crypto.randomUUID())
  const initialLayoutPreference = React.useMemo(() => readAiChatLayoutPreference(), [])
  const [mode, setMode] = React.useState<'compact' | 'expanded' | 'maximized'>(initialLayoutPreference.mode)
  const freshConversationBaseKeyRef = React.useRef<string | null>(null)
  const [bubbleVisualState, setBubbleVisualState] = React.useState<'bubble' | 'panel'>(() => resolveInitialBubbleVisualState(initialLayoutPreference))
  const modeBeforeMaximizeRef = React.useRef<'compact' | 'expanded'>(initialLayoutPreference.mode)
  const previousModeRef = React.useRef<'compact' | 'expanded' | 'maximized'>(initialLayoutPreference.mode)
  const bubbleTransitionTimerRef = React.useRef<number | null>(null)
  const dockRight = true
  const [manualReferenceImages, setManualReferenceImages] = React.useState<string[]>(() => [])
  const manualReferenceImagesRef = React.useRef<string[]>([])
  const [autoReferenceImages, setAutoReferenceImages] = React.useState<string[]>(() => [])
  const [hiddenAutoReferenceUrls, setHiddenAutoReferenceUrls] = React.useState<string[]>(() => [])
  const referenceImagesRef = React.useRef<string[]>([])
  const uploadedReferenceAssetMetaRef = React.useRef<Record<string, UploadedReferenceAssetMeta>>({})
  const autoReferenceResolveCacheRef = React.useRef<Map<string, string>>(new Map())
  const [refsLoading, setRefsLoading] = React.useState(false)
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  // 文本文件导入（txt/md/docx → 输入框）：解析中禁重复触发；拖拽高亮给落点反馈。
  const [importingText, setImportingText] = React.useState(false)
  const [dragOverInput, setDragOverInput] = React.useState(false)
  const textFileInputRef = React.useRef<HTMLInputElement | null>(null)
  const targetFileInputRef = React.useRef<HTMLInputElement | null>(null)
  const [replicateTargetImage, setReplicateTargetImage] = React.useState<string>('')
  const [replicatePickerOpened, setReplicatePickerOpened] = React.useState(false)

  const [draft, setDraft] = React.useState('')
  // 语音输入（火山流式 ASR，边说边出字回填 draft）；compact/expanded 两态共用同一实例。
  const voiceInput = useVoiceInput({
    getBaseText: () => draft,
    onText: setDraft,
    onError: (message) => toast(message, 'error'),
  })
  const {
    options: chatModelOptions,
    loading: chatModelsLoading,
    error: chatModelsError,
    retry: retryChatModels,
  } = useModelOptionsState('text')
  const [selectedChatModelValue, setSelectedChatModelValue] = React.useState<string | null>(readStoredChatModelValue)
  const selectChatModel = React.useCallback((value: string | null) => {
    const normalized = typeof value === 'string' ? value.trim() : ''
    setSelectedChatModelValue(normalized || null)
    persistChatModelValue(normalized || null)
  }, [])
  const selectedChatModelOption = React.useMemo(
    () => findModelOptionByIdentifier(chatModelOptions, selectedChatModelValue),
    [chatModelOptions, selectedChatModelValue],
  )
  const chatModelSelectData = React.useMemo(
    () => chatModelOptions.map((option) => ({
      value: option.value,
      label: option.label,
    })),
    [chatModelOptions],
  )
  React.useEffect(() => {
    if (chatModelOptions.length === 0) return
    if (selectedChatModelValue) return
    const firstValue = typeof chatModelOptions[0]?.value === 'string' ? chatModelOptions[0].value.trim() : ''
    if (firstValue) selectChatModel(firstValue)
  }, [chatModelOptions, selectChatModel, selectedChatModelValue])
  const selectedChatModelRequest = React.useMemo(
    () => resolveSelectedChatModelRequest(selectedChatModelOption),
    [selectedChatModelOption],
  )
  // 智能团手动指派：手动选中某个子 agent → 本轮/后续发送强制由该角色干活（覆盖小T自动委派）。
  // null = 自动（默认）。持久化到 localStorage，跨会话保留用户偏好。
  const [forcedAgentRole, setForcedAgentRole] = React.useState<string | null>(() => {
    try { return localStorage.getItem('tapcanvas-chat-forced-role') || null } catch { return null }
  })
  const [rosterOpened, setRosterOpened] = React.useState(false)
  const [genPrefsOpened, setGenPrefsOpened] = React.useState(false)
  // 预热全局生成偏好缓存；具体模型仍必须通过实时系统模型目录验证。
  React.useEffect(() => {
    void loadGenerationPrefs().catch((error: unknown) => {
      console.error('[generation-preferences] preload failed', error)
    })
  }, [])
  const selectForcedRole = React.useCallback((roleId: string | null) => {
    setForcedAgentRole(roleId)
    try {
      if (roleId) localStorage.setItem('tapcanvas-chat-forced-role', roleId)
      else localStorage.removeItem('tapcanvas-chat-forced-role')
    } catch { /* ignore */ }
  }, [])
  const [messages, setMessages] = React.useState<ChatMessage[]>(() => [])
  const pendingUserInputAnswerRef = React.useRef<{
    requestId: string
    answers: Array<{ id: string; value: string; optionLabel?: string; optionIndex?: number }>
  } | null>(null)
  const [sending, setSending] = React.useState(false)
  const [submissionPreparing, setSubmissionPreparing] = React.useState(false)
  const submissionPreparingRef = React.useRef(false)
  const [agentExecutionAccepted, setAgentExecutionAccepted] = React.useState(false)
  const [queueSubmitting, setQueueSubmitting] = React.useState(false)
  // Starting a new conversation invalidates the recovery snapshot for the
  // same chapter-scoped session key. Keep an explicit local handoff state so
  // the composer can submit the first message while the next request carries
  // resetSession=true; invalidate() alone intentionally clears the snapshot
  // and would otherwise leave the send button disabled forever.
  const [conversationResetPending, setConversationResetPending] = React.useState(false)
  const conversationResetPendingRef = React.useRef(false)

  const skillLibrary = useSkillLibraryData()
  const [activeSkill, setActiveSkill] = React.useState<ChatSkillReference | null>(null)
  const [skillLibraryOpen, setSkillLibraryOpen] = React.useState(false)
  const [creativePhase, setCreativePhase] = React.useState<'prep' | 'writing'>('prep')
  const [briefConfirmationPending, setBriefConfirmationPending] = React.useState(false)
  const [canvasedMessageIds, setCanvasedMessageIds] = React.useState<Set<string>>(new Set())
  // base 不再用全局单值初始化：进入作用域后由解析 effect 决定（本地槽位 → 服务端最近会话 → 默认会话）。
  const [chatSessionBaseKey, setChatSessionBaseKey] = React.useState<string>('')
  const [chatSessionLane, setChatSessionLane] = React.useState<ChatSessionLane>('general')
  const [sessionHistory, setSessionHistory] = React.useState<ChatSessionSummaryDto[]>([])
  const [historyLoading, setHistoryLoading] = React.useState(false)
  const [archiveLoading, setArchiveLoading] = React.useState(false)
  const [archivedConversation, setArchivedConversation] = React.useState<ArchivedConversationView | null>(null)
  const archiveLoadVersionRef = React.useRef(0)
  // 自动生成的会话标题（首轮问答后由轻量 LLM 概括），按会话 key 持久化到 localStorage。
  const [sessionTitle, setSessionTitle] = React.useState<string>('')
  const [titleHistoryReadyScope, setTitleHistoryReadyScope] = React.useState<string>('')
  const titleGenRef = React.useRef<ChatSessionTitleGenerationState>({ key: '', state: 'idle' })
  const activePanel = useUIStore((s) => s.activePanel)
  const currentProjectId = useUIStore((s) => (s.currentProject?.id ? String(s.currentProject.id).trim() : ''))
  const currentProjectName = useUIStore((s) => (s.currentProject?.name ? String(s.currentProject.name).trim() : ''))
  const currentFlowId = useUIStore((s) => (s.currentFlow?.id ? String(s.currentFlow.id).trim() : ''))
  // 章节画布权威上下文（ChapterCanvasPage 设置）。存在时聊天会话按 project+chapter 隔离，
  // 取代滞后的 currentProject/currentFlow，根治跨项目/章节对话与记忆串台。
  const currentChapter = useUIStore((s) => s.currentChapter)
  const currentChapterCreativeOverride = useUIStore((s) => s.currentChapterCreativeOverride)
  const sessionScopeProjectId =
    (currentChapter?.projectId ? String(currentChapter.projectId).trim() : '') || currentProjectId
  const sessionScopeChapterId = currentChapter?.chapterId ? String(currentChapter.chapterId).trim() : ''
  // 章节画布不落 flow 维度（章节会话以 chapterId 为准）。
  const sessionScopeFlowId = sessionScopeChapterId ? '' : currentFlowId
  const codexDispatch = useCodexDispatch({
    projectId: sessionScopeProjectId,
    fixedTarget: 'agents',
  })
  const codexTimeline = React.useMemo(
    () => buildCodexTimeline({
      tasks: codexDispatch.sessionTasks,
      messages: codexDispatch.taskMessages,
    }),
    [codexDispatch.sessionTasks, codexDispatch.taskMessages],
  )
  const displayMessages = React.useMemo<ChatMessage[]>(() => {
    if (archivedConversation) return archivedConversation.messages
    return [
      ...messages.filter((message) => message.source !== 'codex'),
      ...codexTimeline,
    ]
  }, [archivedConversation, codexTimeline, messages])
  // 会话作用域标识（project / project:flow / project:chapter），也是 base 槽位的 key。
  const conversationScopeKey = buildProjectScopedChatSessionBaseKey({
    projectId: sessionScopeProjectId,
    flowId: sessionScopeFlowId,
    chapterId: sessionScopeChapterId,
  })
  const conversationResolutionIdentity = conversationScopeKey || '__global_chat_scope__'
  const [resolvedConversationIdentity, setResolvedConversationIdentity] = React.useState('')

  React.useEffect(() => {
    archiveLoadVersionRef.current += 1
    setArchivedConversation(null)
    setArchiveLoading(false)
  }, [conversationResolutionIdentity])
  const pendingFreshConversation = useChatCommandStore(
    (state) => state.pending?.freshConversation === true,
  )
  const aiChatWatchAssetsEnabled = useUIStore((s) => s.aiChatWatchAssetsEnabled)
  const setAiChatWatchAssetsEnabled = useUIStore((s) => s.setAiChatWatchAssetsEnabled)
  const clearCreationSession = useUIStore((s) => s.clearCreationSession)
  const startLiveChatRun = useLiveChatRunStore((s) => s.startRun)
  const recordLiveChatRunEvent = useLiveChatRunStore((s) => s.recordEvent)
  const completeLiveChatRun = useLiveChatRunStore((s) => s.completeRun)
  const failLiveChatRun = useLiveChatRunStore((s) => s.failRun)
  const cancelLiveChatRun = useLiveChatRunStore((s) => s.cancelRun)
  const reconcileLiveChatTurnStatus = useLiveChatRunStore((s) => s.reconcileTurnStatus)
  const liveChatRunStatus = useLiveChatRunStore((s) => s.activeRun?.status ?? null)
  const liveChatRunId = useLiveChatRunStore((s) => s.activeRun?.runId ?? '')
  const liveChatRunScope = useLiveChatRunStore((s) => s.activeRun)
  const liveChatAsyncArtifacts = React.useMemo(
    () => liveChatRunScope
      && liveChatRunScope.projectId === sessionScopeProjectId
      && liveChatRunScope.flowId === sessionScopeFlowId
      ? liveChatRunScope.asyncArtifacts ?? []
      : [],
    [liveChatRunScope, sessionScopeFlowId, sessionScopeProjectId],
  )
  const reconcileLiveChatAsyncArtifacts = useLiveChatRunStore((s) => s.reconcileAsyncArtifacts)
  const videoRunsById = useVideoRunStore((s) => s.runsById)
  const videoRunSnapshotAppliedAt = useVideoRunStore((s) => s.snapshotAppliedAt)
  const scopedVideoRuns = React.useMemo(
    () => Object.values(videoRunsById).filter((run) => {
      if (sessionScopeChapterId) return run.chapterId === sessionScopeChapterId
      if (sessionScopeFlowId) return run.flowId === sessionScopeFlowId
      return true
    }),
    [sessionScopeChapterId, sessionScopeFlowId, videoRunsById],
  )
  const activeVideoRuns = React.useMemo(
    () => scopedVideoRuns.filter((run) => !isTerminalRunState(run.state)),
    [scopedVideoRuns],
  )
  const currentCanvasVideoRunActive = activeVideoRuns.length > 0
  const [cancellingVideoProduction, setCancellingVideoProduction] = React.useState(false)
  const [terminalProductionProgressDismissed, setTerminalProductionProgressDismissed] = React.useState(false)
  const cancelCurrentCanvasVideoProduction = React.useCallback(async (): Promise<void> => {
    const projectId = String(sessionScopeProjectId || '').trim()
    if (!projectId) return
    if (cancellingVideoProduction) return
    if (!currentCanvasVideoRunActive) return
    setCancellingVideoProduction(true)
    const scope = sessionScopeChapterId
      ? { chapterId: sessionScopeChapterId }
      : sessionScopeFlowId
        ? { flowId: sessionScopeFlowId }
        : undefined
    try {
      const stopped = await cancelProjectVideoRuns(projectId, scope)
      notifications.show({
        title: '已请求停止视频生产',
        message: stopped > 0 ? `已停止 ${stopped} 个视频任务；已提交的片段仍会保留` : '没有正在运行的视频任务',
        color: 'gray',
        autoClose: 4000,
      })
    } catch (error: unknown) {
      notifications.show({
        title: '停止失败',
        message: error instanceof Error ? error.message : '无法停止当前视频任务',
        color: 'red',
        autoClose: 5000,
      })
    } finally {
      setCancellingVideoProduction(false)
    }
  }, [cancellingVideoProduction, currentCanvasVideoRunActive, sessionScopeChapterId, sessionScopeFlowId, sessionScopeProjectId])
  const [observedAsyncChatRunId, setObservedAsyncChatRunId] = React.useState('')
  const [projectTextMaterialState, setProjectTextMaterialState] = React.useState<ProjectTextMaterialState>({
    status: 'idle',
    count: 0,
    error: '',
  })
  const refreshProjectTextMaterialState = React.useCallback(async (projectId: string) => {
    const normalizedProjectId = String(projectId || '').trim()
    if (!normalizedProjectId) {
      setProjectTextMaterialState({ status: 'ready', count: 0, error: '' })
      return
    }
    setProjectTextMaterialState((prev) => ({ ...prev, status: 'loading', error: '' }))
    try {
      const items = await listProjectMaterials(normalizedProjectId)
      setProjectTextMaterialState({
        status: 'ready',
        count: Array.isArray(items) ? items.length : 0,
        error: '',
      })
    } catch (error: unknown) {
      setProjectTextMaterialState({
        status: 'failed',
        count: 0,
        error: error instanceof Error ? error.message : '加载项目文本素材失败',
      })
    }
  }, [])
  React.useEffect(() => {
    void refreshProjectTextMaterialState(currentProjectId)
  }, [currentProjectId, refreshProjectTextMaterialState])

  const selectedCanvasImageSignature = useRFStore(
    React.useCallback((s) => {
      const selectedImages = s.nodes
        .filter((n) => n.selected && isImageKind(String((n.data as { kind?: string } | undefined)?.kind || '')))
        .map((n) => `${String(n.id || '').trim()}:${pickPrimaryImageUrlFromNode(n as Node)}`)
        .filter(Boolean)
      return selectedImages.join('|')
    }, []),
  )
  const canvasImageCandidates = useRFStore(
    React.useCallback((s) => {
      const out: Array<{ id: string; url: string; label: string }> = []
      const seen = new Set<string>()
      for (const node of s.nodes) {
        if (!isImageKind(String((node.data as { kind?: string } | undefined)?.kind || ''))) continue
        const url = pickPrimaryImageUrlFromNode(node as Node)
        const trimmed = String(url || '').trim()
        if (!trimmed || seen.has(trimmed)) continue
        seen.add(trimmed)
        const data = (node.data || {}) as { label?: unknown }
        const label = typeof data.label === 'string' && data.label.trim() ? data.label.trim() : `图片-${out.length + 1}`
        out.push({ id: String(node.id || '').trim(), url: trimmed, label })
        if (out.length >= 120) break
      }
      return out
    }, []),
  )
  const selectedCanvasNodeContext = useRFStore(
    React.useCallback((s) => {
      const selectedNodes = s.nodes.filter((node) => node.selected)
      if (!selectedNodes.length) return null
      const prioritized = selectedNodes.find((node) => String((node.data as { kind?: unknown } | undefined)?.kind || '').trim())
        || selectedNodes[0]
      return extractSelectedCanvasNodeContextFromGraph(prioritized as Node, s.nodes as Node[], s.edges)
    }, []),
  )
  const historyLoadVersionRef = React.useRef(0)
  const loadedSessionKeyRef = React.useRef('')
  const viewportRef = React.useRef<HTMLDivElement | null>(null)
  const messagesContentRef = React.useRef<HTMLDivElement | null>(null)
  const compactInputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const expandedInputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const activeStreamInterruptRef = React.useRef<null | (() => void)>(null)
  // 活流所属的会话作用域（2026-07-29 ch1244 根治）：freshConversation 入口（「本章做成视频」）
  // 会先旋转 base key 再发送，于是 effectiveChatSessionKey 的 scope 段随之变化 → 下方
  // scope-change effect 把它自己刚发起的那条流 abort 掉（控制台 reason=scope-change）。
  // 症状：请求已到服务端、小T 在跑（工具持续 succeeded），前端面板却回到欢迎态、零气泡。
  // 有了这个 ref，scope 变化时只掐「不属于新 scope」的流，自家新流不受影响。
  const activeStreamScopeRef = React.useRef<string>('')
  // freshConversation 会先旋转 key，再由异步 send 建立流。effect 可能在 activeStreamScopeRef
  // 写入前运行，因此先登记这次派发拥有的目标 scope，覆盖“旋转 key → 建流”的竞态窗口。
  const pendingOwnedConversationScopeRef = React.useRef<string>('')
  // 当前正在流式的 assistant 气泡 id。供「中断」按钮在点击瞬间直接收尾转圈子步/任务，
  // 不依赖那次 in-flight send() 的闭包（旧标签页/HMR 前发出的对话其 catch 仍是旧代码，
  // 收不了 spinner；而 interruptActiveChat 每次渲染都是最新闭包，能兜住）。
  const activePendingIdRef = React.useRef<string>('')
  // Project/flow/chapter conversations have one durable source. A reset is
  // sent with the first user turn after the user explicitly starts a new
  // conversation, so the server can replace both its public transcript and
  // agents checkpoint before the model sees the new request.
  const resetSessionOnNextSendRef = React.useRef(false)
  const typewriterRunIdRef = React.useRef(0)
  const shouldAutoScrollRef = React.useRef(true)

  const isCompact = mode === 'compact'
  const isMaximized = mode === 'maximized'
  const showDockedBubble = dockRight && bubbleVisualState === 'bubble'
  const canShowHistory = mode === 'expanded' || mode === 'maximized'
  const useScrollableHistory = canShowHistory
  const showProjectTextMaterialHint = shouldShowProjectTextMaterialHint({
    currentProjectId,
    projectTextMaterialState,
    selectedCanvasNodeContext,
  })
  const hasExplicitTargetImage = Boolean(String(replicateTargetImage || '').trim())
  // 导演台打开时（Modal 写入其 nodeId），强制切到 director lane → 会话与项目主对话隔离、按节点独立线程。
  // 用「派生」覆盖而非改 chatSessionLane state，避免与新对话/作用域切换的 setChatSessionLane('general') 打架。
  const directorChatScopeNodeId = useUIStore((s) => s.directorChatScopeNodeId)
  const effectiveChatSessionLane: ChatSessionLane = directorChatScopeNodeId
    ? (`director:${directorChatScopeNodeId}` as ChatSessionLane)
    : chatSessionLane
  const effectiveChatSessionKey = React.useMemo(() => {
    return buildEffectiveChatSessionKey({
      persistedBaseKey: chatSessionBaseKey,
      projectId: sessionScopeProjectId,
      flowId: sessionScopeFlowId,
      canvasId: sessionScopeFlowId,
      chapterId: sessionScopeChapterId,
      lane: effectiveChatSessionLane,
      skillId: activeSkill?.id ?? null,
    })
  }, [activeSkill?.id, chatSessionBaseKey, effectiveChatSessionLane, sessionScopeFlowId, sessionScopeProjectId, sessionScopeChapterId])
  const {
    snapshot: chatTurnSnapshot,
    checking: chatTurnChecking,
    error: chatTurnStatusError,
    refresh: refreshChatTurnStatus,
    invalidate: invalidateChatTurnRecovery,
  } = useChatTurnRecovery(effectiveChatSessionKey, {
    // Scope resolution temporarily passes through project/flow/default keys.
    // None of those transient identities owns recovery authority. A production
    // command that declares freshConversation also revokes the old identity
    // before its consuming effect rotates the base key.
    enabled:
      resolvedConversationIdentity === conversationResolutionIdentity
      && !pendingFreshConversation,
  })
  const [interruptingChatTurn, setInterruptingChatTurn] = React.useState(false)
  const [activePublicTurnId, setActivePublicTurnId] = React.useState('')
  const activePublicTurnIdRef = React.useRef('')
  React.useEffect(() => {
    activePublicTurnIdRef.current = activePublicTurnId
  }, [activePublicTurnId])
  // 实时镜像 ref：send() 是稳定回调（依赖数组不包含这些高频状态），等待身份解析
  // 期间必须读最新值，不能用创建闭包时的旧值（否则等了个寂寞）。
  const chatTurnSnapshotRef = React.useRef(chatTurnSnapshot)
  React.useEffect(() => {
    chatTurnSnapshotRef.current = chatTurnSnapshot
  }, [chatTurnSnapshot])
  const resolvedConversationIdentityRef = React.useRef(resolvedConversationIdentity)
  React.useEffect(() => {
    resolvedConversationIdentityRef.current = resolvedConversationIdentity
  }, [resolvedConversationIdentity])
  // 会话作用域目标（conversationResolutionIdentity）的实时镜像：send 是稳定回调
  // （deps 不含 conversationScopeKey/currentChapter 等派生量），首页挂起 prompt 经
  // setTimeout 触发时闭包里的目标可能已过期；等待/比较身份必须用实时目标，否则作用域
  // 推进后（进项目 flow 自动加载：project:<id> → project:<id>:flow:<id>）陈旧目标
  // 永不匹配，5s 后误报「会话身份确认超时」。
  const conversationResolutionIdentityRef = React.useRef(conversationResolutionIdentity)
  React.useEffect(() => {
    conversationResolutionIdentityRef.current = conversationResolutionIdentity
  }, [conversationResolutionIdentity])
  // chatSessionBaseKey 的实时镜像：身份解析 effect 与 resolvedConversationIdentity
  // 在同一批 setState 里写入；发送瞬间拼 key 用实时 base，避免闭包旧值（''）落进
  // 空 base 的临时 key。
  const chatSessionBaseKeyRef = React.useRef(chatSessionBaseKey)
  React.useEffect(() => {
    chatSessionBaseKeyRef.current = chatSessionBaseKey
  }, [chatSessionBaseKey])
  // 对话模型目录状态的实时镜像：send 是稳定回调，闭包里的 chatModelsLoading 可能还是
  // 目录加载完成前的旧值（首页挂起 prompt 经 setTimeout 触发），直接检查会误报
  // 「仍在加载」/「未选择模型」；程序化发送等待目录就绪后必须用实时值构建请求。
  const chatModelsLoadingRef = React.useRef(chatModelsLoading)
  React.useEffect(() => {
    chatModelsLoadingRef.current = chatModelsLoading
  }, [chatModelsLoading])
  const chatModelsErrorRef = React.useRef(chatModelsError)
  React.useEffect(() => {
    chatModelsErrorRef.current = chatModelsError
  }, [chatModelsError])
  const selectedChatModelOptionRef = React.useRef(selectedChatModelOption)
  React.useEffect(() => {
    selectedChatModelOptionRef.current = selectedChatModelOption
  }, [selectedChatModelOption])
  const selectedChatModelRequestRef = React.useRef(selectedChatModelRequest)
  React.useEffect(() => {
    selectedChatModelRequestRef.current = selectedChatModelRequest
  }, [selectedChatModelRequest])
  const selectedChatModelValueRef = React.useRef(selectedChatModelValue)
  React.useEffect(() => {
    selectedChatModelValueRef.current = selectedChatModelValue
  }, [selectedChatModelValue])
  // 回合恢复状态的实时镜像：send 是稳定回调，闭包里的 chatTurnChecking/
  // chatTurnStatusError 可能是恢复查询开始前的旧值；程序化发送等待状态查询落定后
  // 必须用实时值做 canStartVerifiedChatTurn 裁决。
  const chatTurnCheckingRef = React.useRef(chatTurnChecking)
  React.useEffect(() => {
    chatTurnCheckingRef.current = chatTurnChecking
  }, [chatTurnChecking])
  const chatTurnStatusErrorRef = React.useRef(chatTurnStatusError)
  React.useEffect(() => {
    chatTurnStatusErrorRef.current = chatTurnStatusError
  }, [chatTurnStatusError])
  const recoveredActiveTurn = chatTurnSnapshot?.turn && isContinuingChatTurn(chatTurnSnapshot)
    ? chatTurnSnapshot.turn
    : null
  const recoveredNeedsInputTurn = chatTurnSnapshot?.turn?.state === 'needs_input'
    ? chatTurnSnapshot.turn
    : null
  const confirmedActiveTurnId = recoveredActiveTurn?.turnId || activePublicTurnId
  const currentTurnActive = sending || interruptingChatTurn || Boolean(recoveredActiveTurn)

  // A durable turn can finish after the browser loses the terminal SSE frame.
  // Keep the local transport from becoming the sole owner of the UI lifecycle:
  // reconcile the exact accepted turn against the server status and settle the
  // existing assistant message without looking at prompt prose or model text.
  React.useEffect(() => {
    const turnId = String(activePublicTurnId || '').trim()
    if (!turnId || !sending) return
    let disposed = false
    let checking = false
    const reconcile = async () => {
      if (disposed || checking) return
      checking = true
      try {
        const snapshot = await refreshChatTurnStatus()
        if (
          disposed
          || activePublicTurnIdRef.current !== turnId
          || !shouldReconcileLocalTurnFromDurableStatus({ activeTurnId: turnId, snapshot })
          || !snapshot?.turn
        ) return
        const turn = snapshot.turn
        const messageIds = buildRecoveredChatMessageIds(turnId)
        const terminalText = resolveRecoveredChatTurnTerminalText(turn) || '当前回合已结束'
        activeStreamInterruptRef.current = null
        activePublicTurnIdRef.current = ''
        setActivePublicTurnId('')
        setSending(false)
        setAgentExecutionAccepted(false)
        reconcileLiveChatTurnStatus(snapshot)
        setMessages((current) => patchChatMessageById(current, messageIds.assistantMessageId, (message) => ({
          ...message,
          content: terminalText,
          ts: formatNowTime(),
          phase: 'final',
          kind: terminalChatMessageKind(turn.logicalTaskState.status),
          logicalTaskStatus: turn.logicalTaskState.status,
        })))
      } finally {
        checking = false
      }
    }
    void reconcile()
    const timer = window.setInterval(() => void reconcile(), 2_500)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [activePublicTurnId, reconcileLiveChatTurnStatus, refreshChatTurnStatus, sending, setMessages])
  // 自动续跑失败与状态传输失败都保留为可见诊断，但都不拥有新请求的否决权。
  // 真正的并发裁决由服务端普通 POST 原子完成；确认存在在飞回合时再持久化续做消息。
  const chatTurnStatusDiagnostic = isChatTurnResumeError(chatTurnStatusError) ? null : chatTurnStatusError
  const chatTurnReadyForNewRequest = canStartVerifiedChatTurn({
    snapshot: chatTurnSnapshot,
    checking: chatTurnChecking,
    error: chatTurnStatusDiagnostic,
  }) || conversationResetPending
  const chatTurnStateUncertain = isChatTurnStateUncertain(chatTurnSnapshot)
  const previousRecoveredActiveTurnRef = React.useRef<NonNullable<typeof recoveredActiveTurn> | null>(null)

  React.useEffect(() => {
    setActivePublicTurnId('')
    activePublicTurnIdRef.current = ''
    previousRecoveredActiveTurnRef.current = null
  }, [effectiveChatSessionKey])

  React.useEffect(() => {
    if (chatTurnSnapshot) reconcileLiveChatTurnStatus(chatTurnSnapshot)
  }, [chatTurnSnapshot, reconcileLiveChatTurnStatus])

  // Hard-cutover cleanup for a turn accepted by the previous browser bundle:
  // the persisted live-run scope still owns its provisional assistant id and
  // exact root request id. Bind those structural identities once, retaining
  // the richer tool/todo card and removing a racing recovery projection. No
  // response-text comparison participates in this merge.
  React.useEffect(() => {
    const turnId = String(chatTurnSnapshot?.turn?.turnId || '').trim()
    const runId = String(liveChatRunScope?.runId || '').trim()
    const provisionalAssistantMessageId = runId
    if (
      !turnId
      || !provisionalAssistantMessageId
      || liveChatRunScope?.sessionKey !== effectiveChatSessionKey
      || liveChatRunScope?.requestId !== turnId
    ) return
    setMessages((current) => bindAcceptedTurnMessageIds(current, {
      turnId,
      provisionalUserMessageId: '',
      provisionalAssistantMessageId,
    }).messages)
    // deps 只取标量：liveChatRunScope 对象引用每次 SSE 事件都换新，整对象入 deps
    // 会让本 effect 每个事件重跑、bindAcceptedTurnMessageIds 恒返回新数组 → 无意义
    // setMessages（#20）。runId/requestId/sessionKey 不变时 effect 不重跑。
  }, [chatTurnSnapshot?.turn?.turnId, effectiveChatSessionKey, liveChatRunScope?.requestId, liveChatRunScope?.runId, liveChatRunScope?.sessionKey, setMessages])

  React.useEffect(() => {
    const turn = chatTurnSnapshot?.turn
    if (
      !turn
      || (turn.logicalTaskState.status !== 'active'
        && turn.logicalTaskState.status !== 'waiting_external')
    ) return
    // deps 含 messages：历史快照可能在恢复投影之后才到达（merge 把 m_history_ 尾部
    // assistant 追加到恢复对之后 → 同一回合两条气泡），messages 变化时重跑裁剪（#9）。
    // 无消息被裁时该函数返回原数组，不引入额外重渲染。
    setMessages((current) => removeTrailingHistoryAssistantMessagesForNonterminalTurn(current))
  }, [chatTurnSnapshot, messages])

  // 浏览器刷新只会断开本地 SSE；服务端回合继续执行。用 durable checkpoint 重建一对稳定气泡，
  // 让用户看到原请求和最后一条已确认事实，并继续使用纠偏/续做/中断操作。
  React.useEffect(() => {
    // interruptingChatTurn 期间由中断路径独占写回：这里再投影会把「中断请求已发送…」
    // 覆盖回 thinking/progress、让已发中断的气泡重新转圈（#3）。
    if (sending || interruptingChatTurn || !recoveredActiveTurn) return
    const messageIds = buildRecoveredChatMessageIds(recoveredActiveTurn.turnId)
    const persistedRun = liveChatRunScope
      && liveChatRunScope.sessionKey === effectiveChatSessionKey
      && liveChatRunScope.requestId === recoveredActiveTurn.turnId
      ? liveChatRunScope
      : null
    const requestText = persistedRun?.displayText
      || persistedRun?.requestText
      || recoveredActiveTurn.requestText
    const recoveryError = isChatTurnResumeError(chatTurnStatusError) ? chatTurnStatusError : null
    const recoveryFailed = recoveryError !== null
    const confirmedSummary = recoveryError
      ? `当前任务自动续跑失败：${recoveryError.message}`
      : formatRecoveredChatTurnSummary(
          persistedRun?.assistantPreview || recoveredActiveTurn.lastConfirmedSummary,
          recoveredActiveTurn.pendingQueueCount,
        )
    const recoveredStartedAt = formatMessageTime(recoveredActiveTurn.startedAt)
    activePendingIdRef.current = recoveryFailed ? '' : messageIds.assistantMessageId
    setMessages((current) => {
      const reconciled = reconcileRecoveredProgressMessages(current, messageIds.assistantMessageId)
      const existingIds = new Set(reconciled.map((message) => message.id))
      const next = reconciled.map((message) => message.id === messageIds.assistantMessageId
        ? isLocallySettledTurnMessage(message)
          ? message
          : {
              ...message,
              content: confirmedSummary,
              phase: recoveryFailed ? 'final' as const : 'thinking' as const,
              kind: recoveryFailed ? 'error' as const : 'progress' as const,
            }
        : message)
      if (requestText && !existingIds.has(messageIds.userMessageId)) {
        const matchingUserIndex = reconciled.findIndex(
          (message) => message.role === 'user' && String(message.content || '').trim() === String(requestText || '').trim(),
        )
        if (matchingUserIndex >= 0) {
          // 已存在同文案的本地用户消息（例如 onOpen 重绑前恢复投影先跑）：把它重绑到
          // 稳定 turn id，而不是留着 m_user_* 临时 id —— 否则历史快照到达时按 id 去重
          // 失败，同一请求出现两条用户气泡（「两条你好」bug 的根因之一）。
          if (next[matchingUserIndex] && next[matchingUserIndex].id !== messageIds.userMessageId) {
            next[matchingUserIndex] = {
              ...next[matchingUserIndex],
              id: messageIds.userMessageId,
            }
          }
        } else {
          next.push({
            id: messageIds.userMessageId,
            role: 'user',
            ts: recoveredStartedAt,
            content: requestText,
          })
        }
      }
      if (!existingIds.has(messageIds.assistantMessageId)) {
        next.push({
          id: messageIds.assistantMessageId,
          role: 'assistant',
          ts: recoveredStartedAt,
          content: confirmedSummary,
          phase: recoveryFailed ? 'final' : 'thinking',
          kind: recoveryFailed ? 'error' : 'progress',
        })
      }
      return next
    })
  }, [chatTurnStatusError, effectiveChatSessionKey, interruptingChatTurn, liveChatRunScope, recoveredActiveTurn, sending])

  React.useEffect(() => {
    if (sending || !recoveredNeedsInputTurn?.pendingUserInput) return
    const messageIds = buildRecoveredChatMessageIds(recoveredNeedsInputTurn.turnId)
    const requestText = recoveredNeedsInputTurn.requestText
    const recoveredStartedAt = formatMessageTime(recoveredNeedsInputTurn.startedAt)
    setMessages((current) => {
      const existingIds = new Set(current.map((message) => message.id))
      if (existingIds.has(messageIds.assistantMessageId)) {
        return current.map((message) => message.id === messageIds.assistantMessageId
          ? {
              ...message,
              phase: 'final' as const,
              kind: 'result' as const,
              pendingUserInput: recoveredNeedsInputTurn.pendingUserInput ?? undefined,
            }
          : message)
      }
      let next = !requestText || existingIds.has(messageIds.userMessageId)
        ? [...current]
        : [...current]
      if (requestText && !existingIds.has(messageIds.userMessageId)) {
        // 同 3210 恢复投影：已存在同文案本地用户消息时重绑到稳定 id，避免历史按 id 去重失败出双气泡。
        const matchingUserIndex = next.findIndex(
          (message) => message.role === 'user' && String(message.content || '').trim() === String(requestText || '').trim(),
        )
        if (matchingUserIndex >= 0) {
          next[matchingUserIndex] = {
            ...next[matchingUserIndex],
            id: messageIds.userMessageId,
          }
        } else {
          next.push({
            id: messageIds.userMessageId,
            role: 'user' as const,
            ts: recoveredStartedAt,
            content: requestText,
          })
        }
      }
      next.push({
        id: messageIds.assistantMessageId,
        role: 'assistant',
        ts: recoveredStartedAt,
        content: '',
        phase: 'final',
        kind: 'result',
        pendingUserInput: recoveredNeedsInputTurn.pendingUserInput ?? undefined,
      })
      return next
    })
  }, [recoveredNeedsInputTurn, sending])

  // A refresh can first discover a turn only after the durable runtime has
  // already failed it. There is then no prior local progress card for the
  // transition effect below to patch, so materialize the complete server
  // summary directly from the terminal snapshot.
  React.useEffect(() => {
    const terminalTurn = chatTurnSnapshot?.turn
    if (
      sending
      || chatTurnSnapshot?.activeTurn !== false
      || terminalTurn?.state !== 'failed'
    ) return
    activePendingIdRef.current = ''
    setMessages((current) => projectRecoveredFailedTurnMessage(current, {
      turnId: terminalTurn.turnId,
      summary: resolveRecoveredChatTurnTerminalText(terminalTurn),
      startedAt: formatMessageTime(terminalTurn.startedAt),
    }))
  }, [chatTurnSnapshot, sending])

  React.useEffect(() => {
    if (recoveredActiveTurn) {
      previousRecoveredActiveTurnRef.current = recoveredActiveTurn
      return
    }
    const previousActiveTurn = previousRecoveredActiveTurnRef.current
    if (!previousActiveTurn) return
    previousRecoveredActiveTurnRef.current = null
    if (chatTurnSnapshot?.turn?.state === 'unknown') {
      const unknownTurn = chatTurnSnapshot.turn
      const terminalSummary = unknownTurn.lastConfirmedSummary
        || '上次任务未正常收尾，当前已无执行进程'
      const ids = buildRecoveredChatMessageIds(previousActiveTurn.turnId)
      setMessages((current) => patchChatMessageById(current, ids.assistantMessageId, (message) => ({
        ...message,
        content: terminalSummary,
        phase: 'final',
        kind: 'error',
        // 本地 settle 标记：防止 3210 恢复投影在后续 poll 里把它改回 thinking/progress（#8）。
        logicalTaskStatus: 'failed',
        ...(Array.isArray(message.todoSnapshot)
          ? { todoSnapshot: terminalizeInterruptedTodos(message.todoSnapshot) }
          : null),
        ...(Array.isArray(message.toolSteps) && message.toolSteps.length
          ? {
              toolSteps: message.toolSteps.map((step) =>
                step.status === 'running' ? { ...step, status: 'cancelled' as const } : step,
              ),
            }
          : null),
      })))
      return
    }
    const terminalTurn = chatTurnSnapshot?.turn?.turnId === previousActiveTurn.turnId
      ? chatTurnSnapshot.turn
      : previousActiveTurn
    const terminalSummary = terminalTurn === previousActiveTurn
      ? resolveRecoveredChatTurnTerminalText(terminalTurn) || '当前回合已结束'
      : resolveRecoveredChatTurnTerminalText(terminalTurn)
    const ids = buildRecoveredChatMessageIds(previousActiveTurn.turnId)
    setMessages((current) => patchChatMessageById(current, ids.assistantMessageId, (message) => ({
        ...message,
        content: terminalSummary,
        phase: 'final',
        kind: terminalChatMessageKind(terminalTurn.logicalTaskState.status),
        // 本地 settle 标记（同 unknown 分支）：终态回合不再被恢复投影改回进行中（#8）。
        logicalTaskStatus: terminalTurn.logicalTaskState.status,
      })))
  }, [chatTurnSnapshot, recoveredActiveTurn])

  // 解析当前作用域的会话 base。项目/flow/章节采用覆盖式唯一源，永远使用
  // 无 conversation 段的规范 key；不能再从服务端“最近一条会话”恢复旧随机会话。
  // 首页等无项目作用域仍保留全局临时会话 base。
  const baseKeyResolveVersionRef = React.useRef(0)
  React.useEffect(() => {
    const version = baseKeyResolveVersionRef.current + 1
    baseKeyResolveVersionRef.current = version
    setResolvedConversationIdentity('')
    if (!conversationScopeKey) {
      // 无项目作用域（如首页气泡）：沿用全局遗留单值行为
      setChatSessionBaseKey(readOrCreateChatSessionBaseKey())
      setResolvedConversationIdentity(conversationResolutionIdentity)
      return
    }
    // 只保留一个规范源。清掉旧版本写入的 scoped base，避免它再次参与
    // 生成 :conversation:<random> 会话；历史旧会话仍可审计，但不再是运行时输入。
    persistScopedChatSessionBaseKey(conversationScopeKey, '')
    setChatSessionBaseKey('')
    if (baseKeyResolveVersionRef.current === version) {
      setResolvedConversationIdentity(conversationResolutionIdentity)
    }
    // sessionScope* 均由 conversationScopeKey 派生，作用域变化即触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationResolutionIdentity, conversationScopeKey])

  React.useEffect(() => {
    if (mode === 'maximized') return
    writeAiChatLayoutPreference({ dockRight: true, mode })
  }, [mode])

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    const rootStyle = document.documentElement.style
    const reservedWidth =
      mode === 'maximized'
        ? AI_CHAT_LAYOUT_RESERVED_WIDTH_NONE
        : mode === 'compact'
          ? AI_CHAT_LAYOUT_RESERVED_WIDTH_NONE
          : AI_CHAT_LAYOUT_RESERVED_WIDTH_EXPANDED
    rootStyle.setProperty('--tc-ai-chat-reserved-width', reservedWidth)
    return () => {
      rootStyle.setProperty('--tc-ai-chat-reserved-width', AI_CHAT_LAYOUT_RESERVED_WIDTH_NONE)
    }
  }, [mode])

  React.useEffect(() => {
    const sessionKey = String(effectiveChatSessionKey || '').trim()
    shouldAutoScrollRef.current = true
    const requestVersion = historyLoadVersionRef.current + 1
    historyLoadVersionRef.current = requestVersion
    const prevSessionKey = loadedSessionKeyRef.current
    // Only the conversation identity (project/flow/chapter/conversation) marks a
    // genuine session switch. The lane/skill suffix can churn mid-conversation (a
    // skill auto-resolves for one send) — treating that as a switch wipes the just
    // finished turn, which is why history "only appeared after a refresh". Keep the
    // wipe (and stream interrupt) scoped to real conversation changes; suffix churn
    // preserves local messages and lets the async reload merge them.
    const scopeChanged = !isSameChatConversationScope(prevSessionKey, sessionKey)
    loadedSessionKeyRef.current = sessionKey
    // 活流属于「即将生效的新 scope」时，这次 scope 变化不是真的会话切换，而是
    // freshConversation 入口自己旋转 base key 造成的（2026-07-29 ch1244 根治）：
    // 它先转 key 再发送，本 effect 随后才观察到变化——那条流正是新 scope 的。
    // 既不能掐它（服务端照跑、前端零气泡回欢迎态），也不能清空 messages
    // （否则气泡"闪现一秒就空了"——用户实测症状）。
    const ownedScopeTransition = shouldPreserveOwnedChatScopeTransition({
      previousSessionKey: prevSessionKey,
      nextSessionKey: sessionKey,
      pendingOwnedScope: pendingOwnedConversationScopeRef.current,
      activeStreamScope: activeStreamScopeRef.current,
      hasActiveStream: Boolean(activeStreamInterruptRef.current),
    })
    if (ownedScopeTransition) {
      pendingOwnedConversationScopeRef.current = ''
    }
    if (scopeChanged) {
      setTitleHistoryReadyScope('')
    }
    if (scopeChanged && !ownedScopeTransition) {
      typewriterRunIdRef.current += 1
      // 诊断：会话作用域中途变化会掐断正在跑的流（表现为「已中断本次对话」）。
      // 只在确有活流被掐时记录，附新旧 key 以便排查长 run 自中断真因。
      if (activeStreamInterruptRef.current) {
        console.warn('[ai-chat][stream-abort] reason=scope-change', {
          prevSessionKey,
          nextSessionKey: sessionKey,
          streamScope: activeStreamScopeRef.current,
        })
      }
      activeStreamInterruptRef.current?.()
      activeStreamInterruptRef.current = null
    }
    if (!sessionKey) {
      setMessages([])
      return
    }
    if (scopeChanged && !ownedScopeTransition) {
      setMessages([])
    }
    // project 已设但 flow 尚未加载时（中间态），跳过 fetch，等 flow 就位后 key 会再次变化
    const isProjectScopeWithoutFlow = isProjectOnlyChatSessionScope({
      sessionKey,
      projectId: sessionScopeProjectId,
      flowId: sessionScopeFlowId,
      chapterId: sessionScopeChapterId,
    })
    if (isProjectScopeWithoutFlow) {
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const response = await getMemoryContext({
          sessionKey,
          recentConversationLimit: 20,
          limitPerScope: 4,
        })
        if (cancelled || historyLoadVersionRef.current !== requestVersion) return
        const recentConversation = Array.isArray(response.context.recentConversation)
          ? response.context.recentConversation
          : []
        const history = recentConversation
          .map((item, index) => mapMemoryConversationItemToChatMessage(item, index))
          .filter((item): item is ChatMessage => Boolean(item))
        // Stable history supplies the canonical durable rows, while local-only
        // messages remain visible until those rows are actually present. This
        // matters after a stream/recovery race: replacing the whole array with
        // an incomplete snapshot can erase the user's request while retaining
        // only the assistant projection.
        setMessages((prev) => mergeLoadedHistoryWithLocalMessages(history, prev))
        setTitleHistoryReadyScope(getChatSessionConversationScope(sessionKey))
      } catch (error: unknown) {
        if (cancelled || historyLoadVersionRef.current !== requestVersion) return
        console.warn('[ai-chat] load conversation history failed', error)
        toast(
          `加载对话历史失败：${error instanceof Error ? error.message : '未知错误'}`,
          'error',
        )
        setTitleHistoryReadyScope(getChatSessionConversationScope(sessionKey))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currentTurnActive, effectiveChatSessionKey])

  // SSE 实时推入的 agent 对话消息（来自 API key 调用 / 辅助创作模式）
  React.useEffect(() => {
    const applyDrained = () => {
      const incoming = useSseChatStore.getState().drain(effectiveChatSessionKey)
      if (!incoming.length) return
      setMessages((prev) => {
        const toAdd = selectNewBroadcastChatMessages(prev, incoming)
          .map((m) => ({ ...m, source: 'agents' as const, phase: 'final' as const, kind: 'result' as const }))
        return toAdd.length ? [...prev, ...toAdd] : prev
      })
    }
    // 挂载即 drain：补齐面板「打开之前」就已排队的辅助创作对话，
    // 否则订阅只接收挂载之后的新推送，先干活后开面板会丢失前面的对话记录。
    applyDrained()
    const unsub = useSseChatStore.subscribe((state) => {
      if (!state.queue.some((item) => item.sessionKey === effectiveChatSessionKey)) return
      applyDrained()
    })
    return unsub
  }, [effectiveChatSessionKey])

  // 会话 key 变化：切换会话/新建/恢复历史时，先回显已持久化的标题（没有则清空），并复位生成状态。
  React.useEffect(() => {
    const key = String(effectiveChatSessionKey || '').trim()
    const previousKey = titleGenRef.current.key
    titleGenRef.current = reconcileChatSessionTitleGenerationState(titleGenRef.current, key)
    if (!isSameChatConversationScope(previousKey, key)) {
      setSessionTitle(key ? readChatSessionTitle(key) : '')
    }
  }, [effectiveChatSessionKey])

  // 首轮问答完成后自动生成会话标题：取首个用户消息 + 首个 assistant 终稿，交给轻量 LLM 概括。
  // 标题继承首轮主对话实际提交的精确模型键；缺失或调用失败都显式停下，不改模、不造启发式标题。
  React.useEffect(() => {
    const key = String(effectiveChatSessionKey || '').trim()
    if (!key) return
    if (titleHistoryReadyScope !== getChatSessionConversationScope(key)) return
    if (sessionTitle) return
    if (titleGenRef.current.state !== 'idle') return
    const firstUser = messages.find((m) => m.role === 'user' && String(m.content || '').trim())
    const firstAssistant = messages.find(isSessionTitleEligibleAssistantMessage)
    if (!firstUser || !firstAssistant) return
    const userText = String(firstUser.content || '').trim()
    const assistantText = String(firstAssistant.content || '').trim()
    const languageModel =
      String(firstUser.languageModel || '').trim() || readChatSessionLanguageModel(key)
    if (!languageModel) {
      titleGenRef.current = { key, state: 'unavailable' }
      console.warn('[ai-chat] session title unavailable', {
        sessionKey: key,
        model: null,
        reason: 'first_turn_language_model_not_recorded',
        message: '该历史会话未记录首轮语言模型，无法补生成标题；主对话未中断',
      })
      return
    }
    titleGenRef.current = { key, state: 'generating' }
    void (async () => {
      try {
        const raw = await llmAuxiliaryChat(buildSessionTitleLlmRequest({
          model: languageModel,
          userText,
          assistantText,
        }))
        const resolved = sanitizeSessionTitle(raw)
        if (!resolved) throw new Error('模型返回了空标题')
        // 期间可能已切换会话，仅当仍是当前会话时落地。
        if (titleGenRef.current.key !== key) return
        titleGenRef.current = { key, state: 'succeeded' }
        setSessionTitle(resolved)
        writeChatSessionTitle(key, resolved)
      } catch (error: unknown) {
        if (titleGenRef.current.key !== key) return
        titleGenRef.current = { key, state: 'failed' }
        const message = error instanceof Error ? error.message : '未知错误'
        console.error('[ai-chat] session title generation failed', {
          sessionKey: key,
          model: languageModel,
          message,
        })
        // Automatic titles are non-critical metadata. Keep the failure observable
        // without interrupting the conversation with a user-facing notification.
      }
    })()
  }, [effectiveChatSessionKey, messages, sessionTitle, titleHistoryReadyScope])

  const scrollToBottom = React.useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    try {
      el.scrollTop = el.scrollHeight
      shouldAutoScrollRef.current = true
    } catch {
      // ignore
    }
  }, [])

  const syncAutoScrollPreference = React.useCallback(() => {
    const el = viewportRef.current
    if (!el) return
    shouldAutoScrollRef.current = isViewportNearBottom(el)
  }, [])

  const lastDisplayMessage = displayMessages[displayMessages.length - 1]
  const messageScrollKey = lastDisplayMessage
    ? `${displayMessages.length}:${lastDisplayMessage.id}:${lastDisplayMessage.content.length}:${lastDisplayMessage.blocks?.length || 0}:${lastDisplayMessage.assets?.length || 0}`
    : 'empty'

  React.useLayoutEffect(() => {
    if (!canShowHistory) return
    const raf = window.requestAnimationFrame(() => {
      if (!shouldAutoScrollRef.current) return
      scrollToBottom()
    })
    return () => window.cancelAnimationFrame(raf)
  }, [canShowHistory, messageScrollKey, scrollToBottom])

  React.useEffect(() => {
    if (!canShowHistory) return
    const contentEl = messagesContentRef.current
    if (!contentEl || typeof ResizeObserver === 'undefined') return

    const resizeObserver = new ResizeObserver(() => {
      if (!shouldAutoScrollRef.current) return
      scrollToBottom()
    })

    resizeObserver.observe(contentEl)
    return () => {
      resizeObserver.disconnect()
    }
  }, [canShowHistory, scrollToBottom])

  React.useEffect(() => {
    if (!canShowHistory) return
    const viewportEl = viewportRef.current
    if (!viewportEl) return

    const handleScroll = () => {
      syncAutoScrollPreference()
    }

    viewportEl.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      viewportEl.removeEventListener('scroll', handleScroll)
    }
  }, [canShowHistory, messageScrollKey, syncAutoScrollPreference])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (!canShowHistory) return
    if (displayMessages.length === 0) return
    shouldAutoScrollRef.current = true
    let rafId = 0
    let timeoutId = 0
    rafId = window.requestAnimationFrame(() => {
      scrollToBottom()
      timeoutId = window.setTimeout(() => {
        scrollToBottom()
      }, 40)
    })
    return () => {
      window.cancelAnimationFrame(rafId)
      window.clearTimeout(timeoutId)
    }
  }, [canShowHistory, displayMessages.length, mode, scrollToBottom])

  const agentSkills = React.useMemo<ChatSkillReference[]>(() => [
    ...skillLibrary.officialSkills.map(toSystemChatSkillReference),
    ...skillLibrary.personalSkills.map(toExternalChatSkillReference),
  ], [skillLibrary.officialSkills, skillLibrary.personalSkills])
  const reloadAgentSkill = skillLibrary.load

  React.useEffect(() => {
    void reloadAgentSkill()
  }, [reloadAgentSkill])

  React.useEffect(() => {
    setActiveSkill((current) => {
      if (!current) return null
      return agentSkills.find((skill) => skill.id === current.id) ?? null
    })
  }, [agentSkills])

  React.useEffect(() => {
    manualReferenceImagesRef.current = manualReferenceImages
  }, [manualReferenceImages])

  const referenceImages = React.useMemo(() => {
    const merged: string[] = []
    const seen = new Set<string>()
    const push = (url: string) => {
      const trimmed = String(url || '').trim()
      if (!trimmed || seen.has(trimmed)) return
      seen.add(trimmed)
      merged.push(trimmed)
    }

    // 用户拍板（2026-07-08）：选中的画布图片节点【不再自动当 vision 参考图】发给模型。
    // 节点图只作规划用的文字上下文（kind/label + 图 URL 经画布上下文/flow_get 进模型），不强制
    // 下载喂 vision——否则会把节点图当"待分析图片"下载（触发 file 图床下载 EOF 报错，也白付 vision
    // 成本）。vision 参考图只保留用户【显式添加】的（手动拖入/从画布选图入参考条）。改图/图生图走
    // 独立的 replicateTargetImage 路径，不受此影响。
    manualReferenceImages.forEach(push)
    return merged
  }, [manualReferenceImages])

  React.useEffect(() => {
    referenceImagesRef.current = referenceImages
  }, [referenceImages])

  React.useEffect(() => {
    const autoSet = new Set(autoReferenceImages)
    setHiddenAutoReferenceUrls((prev) => {
      const next = prev.filter((url) => autoSet.has(url))
      return next.length === prev.length ? prev : next
    })
  }, [autoReferenceImages])

  React.useEffect(() => {
    let cancelled = false

    const loadAutoReferenceImages = async () => {
      const { nodes } = useRFStore.getState()
      const selectedImages = nodes
        .filter((n) => n.selected && isImageKind(String((n.data as { kind?: string } | undefined)?.kind || '')))

      const out: string[] = []
      const seen = new Set<string>()
      for (const node of selectedImages) {
        const raw = pickPrimaryImageUrlFromNode(node as Node)
        if (!raw) continue
        const cached = autoReferenceResolveCacheRef.current.get(raw)
        const resolved = cached || (await resolveReferenceImageUrl(raw))
        if (!resolved || seen.has(resolved)) continue
        autoReferenceResolveCacheRef.current.set(raw, resolved)
        seen.add(resolved)
        out.push(resolved)
      }

      if (!cancelled) {
        setAutoReferenceImages(out)
      }
    }

    void loadAutoReferenceImages()
    return () => {
      cancelled = true
    }
  }, [selectedCanvasImageSignature])

  const addReferenceImagesSafe = React.useCallback((urls: string[], opts?: { source?: string }) => {
    const raw = Array.isArray(urls) ? urls : []
    const incoming = raw.map((u) => String(u || '').trim()).filter(Boolean)
    if (!incoming.length) return

    const prevManual = Array.isArray(manualReferenceImagesRef.current) ? manualReferenceImagesRef.current : []
    const nextManual = [...prevManual]
    const mergedCurrent = Array.isArray(referenceImagesRef.current) ? referenceImagesRef.current : []
    const seen = new Set(mergedCurrent)
    let added = 0

    for (const url of incoming) {
      if (seen.has(url)) continue
      seen.add(url)
      nextManual.push(url)
      added += 1
    }

    manualReferenceImagesRef.current = nextManual
    setManualReferenceImages(nextManual)

    if (added > 0) {
      const sourceLabel = String(opts?.source || '').trim()
      toast(sourceLabel ? `已添加 ${added} 张参考图（${sourceLabel}）` : `已添加 ${added} 张参考图`, 'success')
    }
  }, [])

  const clearReferenceImages = React.useCallback(() => {
    const autoNow = Array.isArray(autoReferenceImages) ? autoReferenceImages : []
    manualReferenceImagesRef.current = []
    uploadedReferenceAssetMetaRef.current = {}
    setManualReferenceImages([])
    setHiddenAutoReferenceUrls(autoNow)
  }, [autoReferenceImages])

  const openReplicateTargetPicker = React.useCallback(() => {
    if (!canvasImageCandidates.length) {
      toast('画布里没有可选图片，请先上传或生成图片', 'error')
      return
    }
    setReplicatePickerOpened(true)
  }, [canvasImageCandidates.length])

  const chooseReplicateTargetFromCanvas = React.useCallback(async (raw: string) => {
    const source = String(raw || '').trim()
    if (!source) return
    if (!raw) {
      toast('选中的目标效果图无效', 'error')
      return
    }
    const resolved = await resolveReferenceImageUrl(source)
    if (!resolved) {
      toast('目标效果图解析失败，请重试或重新上传', 'error')
      return
    }
    const matchedNode = useRFStore.getState().nodes.find((node) => {
      const primary = pickPrimaryImageUrlFromNode(node as Node)
      return primary === source
    })
    if (matchedNode) {
      const candidate = buildSelectedImageAssetCandidate(matchedNode as Node, resolved)
      uploadedReferenceAssetMetaRef.current[resolved] = {
        nodeId: candidate.nodeId,
        ...(candidate.assetId ? { assetId: candidate.assetId } : {}),
        ...(candidate.assetRefId ? { assetRefId: candidate.assetRefId } : {}),
        ...(candidate.name ? { name: candidate.name } : {}),
      }
    }
    setReplicateTargetImage(resolved)
    setReplicatePickerOpened(false)
    toast('已设置目标效果图', 'success')
  }, [])

  const onUploadReplicateTargetFile = React.useCallback(async (files: FileList | null) => {
    const file = files && files[0] ? files[0] : null
    if (!file) return
    try {
      const name = typeof file?.name === 'string' && file.name.trim() ? file.name.trim() : `target-${Date.now()}`
      const hosted = await uploadServerAssetFile(file, name, { taskKind: 'image_edit' })
      const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
      const abs = hostedUrl ? toAbsoluteApiUrl(hostedUrl) : null
      if (!abs) {
        toast('上传目标效果图失败：未获得可用 URL', 'error')
        return
      }
      uploadedReferenceAssetMetaRef.current[abs] = {
        ...(hosted.id ? { assetId: hosted.id } : {}),
        ...(name ? { name } : {}),
      }
      setReplicateTargetImage(abs)
      toast('目标效果图上传成功', 'success')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '上传目标效果图失败'
      toast(message, 'error')
    } finally {
      if (targetFileInputRef.current) targetFileInputRef.current.value = ''
    }
  }, [])

  const addSelectedCanvasImagesAsReferences = React.useCallback(async () => {
    if (refsLoading) return
    setRefsLoading(true)
    try {
      const { nodes } = useRFStore.getState()
      const selected = nodes.filter((n) => n.selected)
      const selectedImages = selected.filter((n) => isImageKind(String((n.data as { kind?: unknown } | undefined)?.kind || '')))
      if (!selectedImages.length) {
        toast('请先在画布中选中 1 张图片节点', 'error')
        return
      }

      const resolvedUrls: string[] = []
      for (const node of selectedImages) {
        const primary = pickPrimaryImageUrlFromNode(node as Node)
        if (!primary) continue
        const resolved = await resolveReferenceImageUrl(primary)
        if (!resolved) continue
        const candidate = buildSelectedImageAssetCandidate(node as Node, resolved)
        uploadedReferenceAssetMetaRef.current[resolved] = {
          nodeId: candidate.nodeId,
          ...(candidate.assetId ? { assetId: candidate.assetId } : {}),
          ...(candidate.assetRefId ? { assetRefId: candidate.assetRefId } : {}),
          ...(candidate.name ? { name: candidate.name } : {}),
        }
        resolvedUrls.push(resolved)
      }

      if (!resolvedUrls.length) {
        toast('选中的图片节点没有可用的图片 URL（请先上传/生成）', 'error')
        return
      }

      addReferenceImagesSafe(resolvedUrls, { source: '画布' })
    } finally {
      setRefsLoading(false)
    }
  }, [addReferenceImagesSafe, refsLoading])

  const onUploadReferenceFiles = React.useCallback(async (files: FileList | null) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return

    if (refsLoading) return
    setRefsLoading(true)
    try {
      const urls: string[] = []
      for (const file of list) {
        const name = typeof file?.name === 'string' && file.name.trim() ? file.name.trim() : `upload-${Date.now()}`
        const hosted = await uploadServerAssetFile(file, name, { taskKind: 'image_edit' })
        const hostedUrl = typeof hosted?.data?.url === 'string' ? hosted.data.url.trim() : ''
        const abs = hostedUrl ? toAbsoluteApiUrl(hostedUrl) : null
        if (abs) {
          urls.push(abs)
          uploadedReferenceAssetMetaRef.current[abs] = {
            ...(hosted.id ? { assetId: hosted.id } : null),
            ...(name ? { name } : null),
          }
        }
      }

      if (!urls.length) {
        toast('上传失败：未获得图片 URL', 'error')
        return
      }

      addReferenceImagesSafe(urls, { source: '上传' })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '上传参考图失败'
      toast(message, 'error')
    } finally {
      setRefsLoading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }, [addReferenceImagesSafe, refsLoading])

  // Collect image files from a clipboard/drag event and route them through the
  // existing reference-image upload pipeline.
  const extractImageFiles = React.useCallback((fileList: FileList | null | undefined): File[] => {
    const list = fileList ? Array.from(fileList) : []
    return list.filter((file) => typeof file?.type === 'string' && file.type.startsWith('image/'))
  }, [])

  // 【文本文件导入】txt/md/docx 拖进/粘贴进/选进对话框 → 解析成纯文本填进输入框（与图片分流：
  // 图片走参考图管线，文本走 draft）。编码嗅探(UTF-8→GBK)在 textFileImport 里做，根治剧本乱码。
  const importTextFiles = React.useCallback(
    async (files: File[]) => {
      if (!files.length) return
      setImportingText(true)
      try {
        for (const file of files) {
          try {
            const text = await extractTextFromFile(file)
            if (!text) {
              toast(`${file.name} 没读到文字内容`, 'warning')
              continue
            }
            setDraft((prev) => buildImportedTextBlock(prev, file.name, text))
            // 整章小说几万字是常态（不截断·禁丢信息点），只提示体量让用户心里有数。
            toast(`已导入 ${file.name}（${text.length.toLocaleString()} 字）`, 'success')
          } catch (err) {
            console.error('[chat] 文本文件导入失败', file.name, err)
            toast(`${file.name} 解析失败：${err instanceof Error ? err.message : '格式不支持'}`, 'error')
          }
        }
      } finally {
        setImportingText(false)
      }
    },
    [setDraft],
  )

  const onPasteIntoInput = React.useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const images = extractImageFiles(event.clipboardData?.files)
      const texts = extractTextFiles(event.clipboardData?.files)
      if (!images.length && !texts.length) return
      event.preventDefault()
      if (images.length) {
        const transfer = new DataTransfer()
        images.forEach((file) => transfer.items.add(file))
        void onUploadReferenceFiles(transfer.files)
      }
      if (texts.length) void importTextFiles(texts)
    },
    [extractImageFiles, importTextFiles, onUploadReferenceFiles],
  )

  const onDropIntoInput = React.useCallback(
    (event: React.DragEvent<HTMLTextAreaElement>) => {
      const images = extractImageFiles(event.dataTransfer?.files)
      const texts = extractTextFiles(event.dataTransfer?.files)
      if (!images.length && !texts.length) return
      event.preventDefault()
      setDragOverInput(false)
      if (images.length) {
        const transfer = new DataTransfer()
        images.forEach((file) => transfer.items.add(file))
        void onUploadReferenceFiles(transfer.files)
      }
      if (texts.length) void importTextFiles(texts)
    },
    [extractImageFiles, importTextFiles, onUploadReferenceFiles],
  )

  const onDragOverInput = React.useCallback((event: React.DragEvent<HTMLTextAreaElement>) => {
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault()
      setDragOverInput(true)
    }
  }, [])

  // dragleave 必须复位，否则拖出去后高亮永久卡住。
  const onDragLeaveInput = React.useCallback(() => setDragOverInput(false), [])

  const onPickTextFiles = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = extractTextFiles(event.currentTarget.files)
      event.currentTarget.value = '' // 允许连续选同一个文件
      if (files.length) void importTextFiles(files)
    },
    [importTextFiles],
  )

  const setAiChatOpen = useUIStore((s) => s.setAiChatOpen)

  const expandChat = React.useCallback(() => {
    setMode((currentMode) => (currentMode === 'compact' ? 'expanded' : currentMode))
    setAiChatOpen(true)
  }, [setAiChatOpen])

  // 暴露对话开关给导演小T等同级入口；原右下浮标保持隐藏，避免重复入口。
  const toggleChat = React.useCallback(() => {
    const nextMode = mode === 'compact' ? 'expanded' : 'compact'
    setMode(nextMode)
    setAiChatOpen(nextMode !== 'compact')
  }, [mode, setAiChatOpen])
  React.useEffect(() => {
    const w = window as unknown as { __tcToggleChat?: () => void; __tcExpandChat?: () => void }
    w.__tcToggleChat = toggleChat
    w.__tcExpandChat = expandChat
    return () => {
      if (w.__tcToggleChat === toggleChat) delete w.__tcToggleChat
      if (w.__tcExpandChat === expandChat) delete w.__tcExpandChat
    }
  }, [toggleChat, expandChat])

  // 同步开合状态到 uiStore，供导演小T切换为贴在对话左侧的窥屏姿态。
  React.useEffect(() => {
    setAiChatOpen(mode !== 'compact')
  }, [mode, setAiChatOpen])

  const collapseChat = React.useCallback(() => {
    setMode('compact')
    setAiChatOpen(false)
  }, [setAiChatOpen])

  const toggleMaximized = React.useCallback(() => {
    setMode((m) => {
      if (m === 'maximized') return modeBeforeMaximizeRef.current
      modeBeforeMaximizeRef.current = m === 'expanded' ? 'expanded' : 'compact'
      return 'maximized'
    })
  }, [])

  React.useEffect(() => {
    const previousMode = previousModeRef.current
    previousModeRef.current = mode

    if (typeof window === 'undefined') {
      setBubbleVisualState(mode === 'compact' ? 'bubble' : 'panel')
      return
    }

    if (bubbleTransitionTimerRef.current !== null) {
      window.clearTimeout(bubbleTransitionTimerRef.current)
      bubbleTransitionTimerRef.current = null
    }

    if (mode === 'compact') {
      if (previousMode === 'expanded' || previousMode === 'maximized') {
        setBubbleVisualState('panel')
        bubbleTransitionTimerRef.current = window.setTimeout(() => {
          setBubbleVisualState('bubble')
          bubbleTransitionTimerRef.current = null
        }, AI_CHAT_MODE_TRANSITION_MS)
        return
      }
      setBubbleVisualState('bubble')
      return
    }

    setBubbleVisualState('panel')
  }, [mode])

  React.useEffect(() => {
    return () => {
      if (bubbleTransitionTimerRef.current === null || typeof window === 'undefined') return
      window.clearTimeout(bubbleTransitionTimerRef.current)
    }
  }, [])

  React.useEffect(() => {
    if (typeof window === 'undefined') return
    if (mode !== 'expanded' && mode !== 'maximized') return
    const rafId = window.requestAnimationFrame(() => {
      expandedInputRef.current?.focus({ preventScroll: true })
    })
    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [clearCreationSession, mode])

  React.useEffect(() => {
    return () => {
      typewriterRunIdRef.current += 1
      // 诊断：面板/章节页在 run 中途卸载重挂也会掐断活流。只在确有活流被掐时记录。
      if (activeStreamInterruptRef.current) {
        console.warn('[ai-chat][stream-abort] reason=unmount')
      }
      activeStreamInterruptRef.current?.()
      activeStreamInterruptRef.current = null
    }
  }, [])

  const animateAssistantReply = React.useCallback(async (messageId: string, text: string) => {
    const normalized = String(text || '').trim()
    if (!normalized) return
    const runId = typewriterRunIdRef.current + 1
    typewriterRunIdRef.current = runId

    let visibleLength = 0
    while (visibleLength < normalized.length) {
      if (typewriterRunIdRef.current !== runId) return
      const remaining = normalized.length - visibleLength
      const nextStep = remaining > 160 ? 20 : remaining > 80 ? 10 : remaining > 32 ? 6 : 3
      visibleLength = Math.min(normalized.length, visibleLength + nextStep)
      const partial = normalized.slice(0, visibleLength)
      setMessages((prev) =>
        patchChatMessageById(prev, messageId, (message) => ({
          ...message,
          content: partial,
        })),
      )
      if (visibleLength < normalized.length) {
        await sleepMs(16)
      }
    }
  }, [])

  const interruptActiveChat = React.useCallback(() => {
    const sessionKeyForInterrupt = String(effectiveChatSessionKey || '').trim()
    const turnId = String(confirmedActiveTurnId || '').trim()
    if (!sessionKeyForInterrupt) {
      toast('当前对话缺少稳定 sessionKey，无法精确中断。', 'error')
      return
    }
    if (!turnId) {
      toast('任务正在建立，请等待执行器确认开始后再中断。', 'error')
      void refreshChatTurnStatus()
      return
    }
    // 诊断：用户点「中断」按钮主动停止。用于和 scope-change / unmount 自动 abort 区分。
    if (activeStreamInterruptRef.current) {
      console.warn('[ai-chat][stream-abort] reason=user-stop')
    }
    activeStreamInterruptRef.current?.()
    // 关键修复：中断 / HMR / 断流时，那次 send() 的 finally 可能跑不到（见下方旧闭包注释），
    // sending 会卡在 true → 之后选项卡点击、输入发送都被 send() 顶部的 `if (sending) return` 静默吞掉
    //（症状：「中断后点啥都没反应」「选项卡点不动」）。这里幂等地复位 sending、清掉中断引用，确保中断后聊天立刻可用。
    activeStreamInterruptRef.current = null
    setSending(false)
    setInterruptingChatTurn(true)
    activePublicTurnIdRef.current = ''
    // 点击瞬间就把当前流式气泡里仍在转圈的工具子步/任务收尾，不等异步 send() 的 catch。
    // 关键：正在跑的那次 send() 闭包可能是 HMR/旧标签页加载前的旧代码，它的 catch 收不了
    // spinner（这正是「已中断却还转圈」的根因之一）；而本回调每次渲染都是最新闭包，能兜底。
    // 与 catch 里的收尾幂等：running→cancelled、in_progress→pending，重复执行无副作用。
    const pendingIdForTerminate = activePendingIdRef.current
    if (pendingIdForTerminate) {
      setMessages((prev) =>
        patchChatMessageById(prev, pendingIdForTerminate, (message) => ({
          ...message,
          content: '中断请求已发送，等待执行器确认…',
          phase: 'thinking',
          kind: 'progress',
          ...(Array.isArray(message.todoSnapshot)
            ? { todoSnapshot: terminalizeInterruptedTodos(message.todoSnapshot) }
            : null),
          ...(Array.isArray(message.toolSteps) && message.toolSteps.length
            ? {
                toolSteps: message.toolSteps.map((step) =>
                  step.status === 'running' ? { ...step, status: 'cancelled' as const } : step,
                ),
              }
            : null),
        })),
      )
    }
    // 用户显式停止的是当前逻辑任务：服务端会沿本轮持久归属取消对应工作流、Agent 节点和续跑。
    // 会话切换/HMR 的传输清理由下方 physical_only 路径承担，二者不得混用。
    void interruptAgentsChatTurn({
      sessionKey: sessionKeyForInterrupt,
      turnId,
      cancellationScope: 'logical_task',
    })
      .then((receipt) => {
        const presentation = resolveChatInterruptPresentation(receipt)
        if (receipt.status) reconcileLiveChatTurnStatus(receipt.status)
        if (presentation.liveRunAction === 'cancel') {
          cancelLiveChatRun(CHAT_ABORTED_MESSAGE, turnId)
        } else if (presentation.liveRunAction === 'mark_inactive') {
          failLiveChatRun('当前任务已不在运行', turnId)
        } else if (!receipt.status && pendingIdForTerminate) {
          setMessages((prev) =>
            patchChatMessageById(prev, pendingIdForTerminate, (message) => ({
              ...message,
              content: presentation.message,
              phase: 'thinking',
              kind: 'progress',
            })),
          )
        }
        notifications.show({
          message: presentation.message,
          color: presentation.color,
        })
      })
      .catch((error: unknown) => {
        console.warn('[ai-chat][interrupt] server-side turn interrupt failed', error)
        toast(error instanceof Error ? `中断失败：${error.message}` : '中断失败：未知错误', 'error')
      })
      .finally(() => {
        void refreshChatTurnStatus().finally(() => setInterruptingChatTurn(false))
      })
  }, [cancelLiveChatRun, confirmedActiveTurnId, effectiveChatSessionKey, failLiveChatRun, reconcileLiveChatTurnStatus, refreshChatTurnStatus, setMessages])

  // Rotating a conversation is also a server-side lifecycle boundary. Stop the
  // exact old physical agents turn before clearing its projection. The server
  // deliberately preserves dependency continuations that already own accepted
  // asynchronous effects, so those authorized tasks can still reconcile their
  // final evidence without keeping the old model transport alive.
  const revokeCurrentTurnForConversationReset = React.useCallback(() => {
    const sessionKey = String(effectiveChatSessionKey || '').trim()
    const turnId = isRevokableChatTurn(chatTurnSnapshot)
      ? String(chatTurnSnapshot?.turn?.turnId || '').trim()
      : String(confirmedActiveTurnId || '').trim()
    activeStreamInterruptRef.current?.()
    activeStreamInterruptRef.current = null
    activeStreamScopeRef.current = ''
    activePendingIdRef.current = ''
    setSending(false)
    setActivePublicTurnId('')
    activePublicTurnIdRef.current = ''
    setAgentExecutionAccepted(false)
    if (!sessionKey || !turnId) return
    void interruptAgentsChatTurn({ sessionKey, turnId }).catch((error: unknown) => {
      console.warn('[ai-chat][conversation-reset] old turn revoke failed', error)
    })
  }, [chatTurnSnapshot, confirmedActiveTurnId, effectiveChatSessionKey])

  const normalizedDraft = React.useMemo(() => String(draft || '').trim(), [draft])
  const activeSkillContextName = React.useMemo(() => {
    const name = String(activeSkill?.name || activeSkill?.key || '').trim()
    return name || null
  }, [activeSkill?.key, activeSkill?.name])
  const implicitSendRequest = React.useMemo<ImplicitChatRequest | null>(() => {
    if (normalizedDraft) return null
    return buildImplicitChatRequest({
      selectedCanvasNodeContext,
      referenceImageCount: referenceImages.length,
      hasTargetImage: hasExplicitTargetImage,
      activeSkillName: activeSkillContextName,
    })
  }, [activeSkillContextName, hasExplicitTargetImage, normalizedDraft, referenceImages.length, selectedCanvasNodeContext])
  const canSendMessage = Boolean(normalizedDraft || implicitSendRequest)
  const canSubmitToSelectedTarget =
    codexDispatch.target === 'codex'
      ? Boolean(normalizedDraft && codexDispatch.canDispatch && sessionScopeProjectId)
      : canSubmitChatComposer({
          hasMessage: canSendMessage,
          turnReady: chatTurnReadyForNewRequest,
          modelLoading: chatModelsLoading,
          modelError: chatModelsError,
          hasSelectedModel: Boolean(selectedChatModelOption && selectedChatModelRequest),
          preparing: submissionPreparing,
        })
  const selectedTargetSendLabel =
    codexDispatch.target === 'codex' ? '发送给本地 Codex' : $('发送')

  const enqueueRunningMessage = React.useCallback(async (
    queueMode: 'steering' | 'follow_up',
    options?: SendOptions,
  ): Promise<boolean> => {
    const text = String(options?.text ?? draft ?? '').trim()
    const sessionKey = String(effectiveChatSessionKey || '').trim()
    if (!text) return false
    if (!sessionKey) {
      toast('当前对话缺少稳定 sessionKey，无法持久化运行中消息。', 'error')
      return false
    }
    if (!selectedChatModelRequest) {
      toast('当前没有可用的对话模型，消息未进入运行队列。', 'error')
      return false
    }
    const displayText = String(options?.displayText ?? text).trim()
    if (queueSubmitting) return false
    setQueueSubmitting(true)
    try {
      const receipt = await enqueueAgentsChatMessage({
        prompt: text,
        sessionKey,
        queueMode,
        ...toAgentsChatModelPayload(selectedChatModelRequest),
        ...(options?.generationProposal ? { chatContext: { generationProposal: options.generationProposal } } : {}),
      })
      setMessages((prev) => [...prev, {
        id: `m_user_queued_${receipt.queueId}`,
        role: 'user',
        ts: formatNowTime(),
        content: displayText,
        queuedMode: queueMode,
      }])
      if (!options?.text) {
        setDraft((current) => String(current || '').trim() === text ? '' : current)
      }
      notifications.show({
        message: queueMode === 'steering'
          ? '已持久化纠偏，将在当前任务的下一个思考边界生效'
          : '已持久化续做任务，将在当前任务完成后执行',
        color: 'blue',
      })
      return true
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '运行中消息投递失败', 'error')
      return false
    } finally {
      setQueueSubmitting(false)
    }
  }, [draft, effectiveChatSessionKey, queueSubmitting, selectedChatModelRequest])

  const send = React.useCallback(async (options?: SendOptions) => {
    const startsFreshConversation = options?.freshConversation === true
    const submissionOrigin = options?.origin ?? 'programmatic'
    const shouldAwaitReadiness = shouldAwaitChatSubmissionReadiness(submissionOrigin)
    // 会话身份（base key）解析完成前 snapshot 必为 null：此时直接发送会落到
    // 「空 base 临时 key」上，身份解析完成后 effectiveChatSessionKey 变化 →
    // 历史 effect 清空消息并掐断活流（恢复竞态 #1）。按钮路径已由
    // canStartVerifiedChatTurn 的 snapshot===null 守卫禁用；程序化发送（首页挂起
    // prompt、SBA 事件、选项卡回答等）在这里等待身份就绪（上限 5s），而不是失败丢消息。
    // 目标与已解析身份都取实时 ref：send 是稳定回调，闭包里的
    // conversationResolutionIdentity 可能已过期（首页挂起 prompt 经 setTimeout
    // 触发时，进项目后 flow 自动加载/创建会把 project:<id> 推进为
    // project:<id>:flow:<id>），陈旧目标会让等待永不收敛 → 5s 后误报超时。
    const waitChatIdentityConverged = async (deadline: number): Promise<boolean> => {
      while (
        resolvedConversationIdentityRef.current !== conversationResolutionIdentityRef.current
        && Date.now() < deadline
      ) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 80))
      }
      return resolvedConversationIdentityRef.current === conversationResolutionIdentityRef.current
    }
    if (!startsFreshConversation && shouldAwaitReadiness) {
      const identityWaitDeadline = Date.now() + 5_000
      const identityReady = await waitChatIdentityConverged(identityWaitDeadline)
      if (!identityReady) {
        toast('会话身份确认超时，请稍候再发送。', 'error')
        return
      }
    }
    // 回合恢复状态等待（与身份等待同一模式）：身份收敛后 useChatTurnRecovery 才启用
    // 并异步查询回合状态；send 是稳定回调，闭包里的 checking/snapshot 可能是查询
    // 开始前的旧值。程序化发送在这里等待状态查询落定（上限 5s），避免把「正在确认
    // 当前会话是否仍有任务运行」误判为失败而丢弃首页挂起 prompt。
    // 新对话（显式旋转 base）不等待——恢复本就被 pendingFreshConversation 禁用。
    if (!startsFreshConversation && shouldAwaitReadiness) {
      const recoverySettleDeadline = Date.now() + 5_000
      while (
        chatTurnSnapshotRef.current === null
        && chatTurnStatusErrorRef.current === null
        && Date.now() < recoverySettleDeadline
      ) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 80))
      }
    }
    // 守卫通过即身份已收敛（未通过已 return），恢复快照实时 ref 已落定。
    let useAuthoritativeAdmission = false
    let verifiedTurnSnapshot = startsFreshConversation
      ? null
      : submissionOrigin === 'composer'
        ? chatTurnSnapshot
        : chatTurnSnapshotRef.current
    if (!startsFreshConversation && currentTurnActive) {
      const queuedText = String(options?.text ?? '').trim()
      // 恢复快照可能刚好跨过容器重启/进程退出边界。发送前以 durable status 再验一次：
      // 旧物理回合已不存在时，本次点击必须直接创建新回合，不能把消息排进无人消费的死队列。
      if (!sending && recoveredActiveTurn) {
        const freshSnapshot = await refreshChatTurnStatus()
        if (!freshSnapshot) {
          // The status transport is diagnostic only. Fall through to the
          // normal POST so the server can atomically start a new turn or
          // return an exact in-flight conflict. Keeping the stale active
          // snapshot here would recreate the browser-side deadlock.
          useAuthoritativeAdmission = true
          verifiedTurnSnapshot = null
        } else {
          verifiedTurnSnapshot = freshSnapshot
        }
        if (freshSnapshot && shouldQueueIntoRecoveredTurn(freshSnapshot)) {
          if (queuedText) {
            await enqueueRunningMessage('follow_up', { ...options, text: queuedText })
          }
          return
        }
      } else {
        // 本浏览器确实正在发送的回合继续使用 durable follow-up，不顶替当前执行。
        if (queuedText) {
          await enqueueRunningMessage('follow_up', { ...options, text: queuedText })
        }
        return
      }
    }
    // 程序化发送与按钮共用同一守卫（真实 checking/error），避免程序化入口绕过
    // 状态确认与恢复查询并发（#5）。resume 失败同按钮侧：不阻断新回合（#4）。
    const verifiedReadyForNewRequest = useAuthoritativeAdmission
      || startsFreshConversation
      || conversationResetPendingRef.current
      || canStartVerifiedChatTurn({
        snapshot: verifiedTurnSnapshot,
        checking: submissionOrigin === 'composer'
          ? chatTurnChecking
          : chatTurnCheckingRef.current,
        error: (() => {
          const currentError = submissionOrigin === 'composer'
            ? chatTurnStatusError
            : chatTurnStatusErrorRef.current
          return isChatTurnResumeError(currentError) ? null : currentError
        })(),
      })
    if (!verifiedReadyForNewRequest) {
      const checkingNow = submissionOrigin === 'composer'
        ? chatTurnChecking
        : chatTurnCheckingRef.current
      const statusErrorNow = submissionOrigin === 'composer'
        ? chatTurnStatusError
        : chatTurnStatusErrorRef.current
      if (checkingNow) {
        toast('正在确认当前会话是否仍有任务运行，请稍候。', 'error')
      } else if (statusErrorNow) {
        toast(`无法确认当前任务状态：${statusErrorNow.message}`, 'error')
      } else {
        toast('上一次执行状态不确定，请先刷新状态或中断指定回合。', 'error')
      }
      return
    }
    const explicitText = String(options?.text ?? draft ?? '').trim()
    const requestText = explicitText || implicitSendRequest?.prompt || ''
    const explicitDisplayText = String(options?.displayText ?? '').trim()
    const displayText = explicitDisplayText || explicitText || implicitSendRequest?.displayText || ''
    if (!requestText) return
    // 对话模型目录就绪等待（与身份等待同一模式）：send 是稳定回调，闭包里的
    // chatModelsLoading 可能还是目录加载完成前的旧值（首页挂起 prompt 经
    // setTimeout 触发），直接检查会误报「仍在加载」；程序化发送在这里等待目录
    // 就绪（上限 5s），而不是失败丢消息。目录加载失败仍如实报错，不兜底。
    if (shouldAwaitReadiness) {
      const modelCatalogDeadline = Date.now() + 5_000
      while (chatModelsLoadingRef.current && Date.now() < modelCatalogDeadline) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 80))
      }
    }
    const sendChatModelsError = submissionOrigin === 'composer'
      ? chatModelsError
      : chatModelsErrorRef.current
    const sendChatModelsLoading = submissionOrigin === 'composer'
      ? chatModelsLoading
      : chatModelsLoadingRef.current
    if (sendChatModelsError) {
      toast(`对话模型目录加载失败：${sendChatModelsError.message}`, 'error')
      return
    }
    if (sendChatModelsLoading) {
      toast('对话模型目录仍在加载，请等待加载完成后重试。', 'error')
      return
    }
    const sendChatModelOption = submissionOrigin === 'composer'
      ? selectedChatModelOption
      : selectedChatModelOptionRef.current
    const sendChatModelRequest = submissionOrigin === 'composer'
      ? selectedChatModelRequest
      : selectedChatModelRequestRef.current
    if (!sendChatModelOption || !sendChatModelRequest) {
      const unavailableModel = String(
        submissionOrigin === 'composer'
          ? selectedChatModelValue
          : selectedChatModelValueRef.current,
      ).trim()
      toast(
        unavailableModel
          ? `对话模型 ${unavailableModel} 当前不可用，请从系统模型目录重新选择。`
          : '未选择可用对话模型，请先从系统模型目录选择。',
        'error',
      )
      return
    }
    if (currentProjectId) {
      void (async () => {
        try {
          const materials = await listProjectMaterials(currentProjectId)
          setProjectTextMaterialState({
            status: 'ready',
            count: materials.length,
            error: '',
          })
        } catch (error: unknown) {
          console.warn('[ai-chat] pre-send listProjectMaterials failed, continue sending', error)
          setProjectTextMaterialState((prev) => ({
            status: 'failed',
            count: prev.count,
            error: error instanceof Error ? error.message : '加载项目文本素材失败',
          }))
        }
      })()
    } else {
      setProjectTextMaterialState({ status: 'ready', count: 0, error: '' })
    }
    const effectiveSkill = options?.skill === undefined ? activeSkill : options.skill
    const explicitAttachCanvasContext = options?.attachCanvasContext === true
    const targetEffectUrl = String(replicateTargetImage || '').trim()
    const selectedReplicateMode = Boolean(targetEffectUrl)
    const hasCanvasScope =
      Boolean(currentProjectId) ||
      Boolean(currentFlowId) ||
      Boolean(selectedCanvasNodeContext?.nodeId)
    const shouldAttachCanvasContext =
      explicitAttachCanvasContext ||
      (!explicitText && Boolean(implicitSendRequest)) ||
      selectedReplicateMode ||
      hasCanvasScope
    // Keep chat send path deterministic: project text material hints should not block
    // or alter reference collection unless an explicit isolation rule is introduced.
    const shouldUseProjectTextIsolation = false
    // 导演台打开时（uiStore 写入其 nodeId）：本轮会话走 director:<nodeId> lane（与项目主对话隔离、按节点独立线程）。
    // 发送瞬间现读最终会话作用域与导演台锚点（实时，不用渲染闭包值）：首页挂起
    // prompt 经 setTimeout 触发时，闭包里的 sessionScope* 可能还停在 project:<id>，
    // 而 flow 已加载推进为 project:<id>:flow:<id>；按最终作用域拼 key，消息才会落进
    // 用户当前看到的会话（否则 history 按新作用域加载时看不到刚发的消息）。
    // 若身份因作用域推进而重新解析（''），再等一轮收敛，保证 key 建立在已确认身份上。
    const liveSendScope = resolveLiveChatSessionScope(useUIStore.getState())
    if (resolvedConversationIdentityRef.current !== conversationResolutionIdentityRef.current) {
      if (!shouldAwaitReadiness) {
        toast('当前会话作用域刚刚发生变化，消息尚未提交，请再次发送。', 'error')
        return
      }
      const identityReady = await waitChatIdentityConverged(Date.now() + 5_000)
      if (!identityReady) {
        toast('会话身份确认超时，请稍候再发送。', 'error')
        return
      }
    }
    const directorScopeActive = Boolean(liveSendScope.directorNodeId)
    const nextSessionLane: ChatSessionLane = directorScopeActive
      ? (`director:${liveSendScope.directorNodeId}` as ChatSessionLane)
      : resolveChatSessionLane({ hasReplicateTarget: selectedReplicateMode })
    const requestSessionKey = buildEffectiveChatSessionKey({
      persistedBaseKey: freshConversationBaseKeyRef.current ?? chatSessionBaseKeyRef.current,
      projectId: liveSendScope.projectId,
      flowId: liveSendScope.flowId,
      canvasId: liveSendScope.flowId,
      chapterId: liveSendScope.chapterId,
      lane: nextSessionLane,
      skillId: effectiveSkill?.id ?? null,
    })
    const resetSession = Boolean(requestSessionKey && resetSessionOnNextSendRef.current)
    // 画布绑定（projectId/flowId）在发送瞬间现读 store，不用渲染闭包值：首页 pending prompt
    // 经 setTimeout 触发、排队消息跨回合重发时，闭包里可能还是 SPA 导航前上一个画布的 flowId
    // （currentProject 已切新项目、currentFlow 未重置），带上它服务端按 project 归属校验
    // 必拒 flow_not_found（首条消息报错、第二条才好）。详见 canvasBinding.ts。
    const { projectId: requestProjectId, flowId: requestFlowId } =
      resolveLiveCanvasBinding(useUIStore.getState())
    if (chatSessionLane !== nextSessionLane) {
      setChatSessionLane(nextSessionLane)
    }
    const explicitCanvasNodeId = String(options?.canvasNodeId || '').trim()
    const requestSelectedCanvasNodeContext = directorScopeActive || explicitCanvasNodeId
      ? null // 导演台模式不带「选中节点」的 asset 引用，避免误导；节点锚定改走下面 requestCanvasNodeId
      : (shouldAttachCanvasContext ? selectedCanvasNodeContext : null)
    // 导演台模式：强制把 canvasNodeId 锚到「你打开的那个导演台节点」，不依赖画布选中态（支持一画布多导演台）。
    // 小T 据此（+ tapcanvas-director-console 技能）用它当 capture_director_scene 的 id，操作这一个、不新建。
    const requestCanvasNodeId = explicitCanvasNodeId || (directorScopeActive
      ? (liveSendScope.directorNodeId as string)
      : (requestSelectedCanvasNodeContext?.nodeId || ''))
    const requestSelectedNodeKind = directorScopeActive
      ? 'directorConsole'
      : (requestSelectedCanvasNodeContext?.kind || null)

    let pendingId = ''
    let userMessageId = ''
    let acceptedTransportTurnId = ''
    let executionWasAccepted = false
    // 本轮起点：用于在收尾时算「本轮耗时」（你发出到小T最终回复）。
    const turnStartedAt = Date.now()
    setActivePublicTurnId('')
    activePublicTurnIdRef.current = ''
    setSending(true)
    setAgentExecutionAccepted(false)
    typewriterRunIdRef.current += 1
    historyLoadVersionRef.current += 1
    // 提到 try 外：报错/中断收尾也要靠它判定哪些中途 choices 卡已被小T推进跳过（残影标过期）。
    let streamedReply = ''
    const deferredToolFailures: DeferredChatToolStep<ChatToolStep>[] = []
    try {
      // 结构化块沉淀（外层声明：流式期间 block 事件/正文围栏解析写入，final 收尾时与 resp.blocks 合并，
      // 防止「收尾用最后一轮文本覆盖正文」把早轮吐出的 choices/tc-card 卡冲掉）
      let blockState = emptyBlockState
      // 本轮工具调用的结构化步骤（外层声明：final 收尾时也要带走快照）
        const liveToolSteps: ChatToolStep[] = []
        // 中间失败是 agents 同链自愈的内部证据。先暂存，只有权威终态失败时才投影到聊天。
      // 任务行墙钟计时：key=todo 文案，记录首次进入 in_progress 的时刻与完成耗时。
      // 服务端 trace 的 todoEvents 是「快照」粒度不是「单项」粒度，故在前端按 in_progress→completed 测量。
      const todoTimings = new Map<string, { startedAt: number; durationMs?: number }>()
      const attachTodoDurations = (items: ChatTodoItem[]): ChatTodoItem[] =>
        items.map((item) => {
          const timing = todoTimings.get(item.content)
          if (!timing) return item
          return {
            ...item,
            startedAt: timing.startedAt,
            ...(timing.durationMs != null ? { durationMs: timing.durationMs } : null),
          }
        })
      // 收尾：把仍在 in_progress 的任务计时落账（完成事件可能晚于 result 被截断），再贴耗时。
      const finalizeTodoDurations = (items: ChatTodoItem[]): ChatTodoItem[] => {
        const closeMs = Date.now()
        for (const item of items) {
          if (item.status !== 'completed') continue
          const timing = todoTimings.get(item.content)
          if (timing && timing.durationMs == null) {
            timing.durationMs = Math.max(0, closeMs - timing.startedAt)
          }
        }
        return attachTodoDurations(items)
      }
      // 自动聚焦新节点：节点在对话中经 canvas-events SSE 实时落画布，回合末 reload 的
      // diff 会看不到「新增」，所以以发送时刻的节点集合为基准判定新增并聚焦（每轮只聚焦一次）。
      const preExistingCanvasNodeIds = new Set(
        useRFStore.getState().nodes.map((node) => String(node.id || '').trim()).filter(Boolean),
      )
      let autoFocusedFreshNodes = false
      const tryFocusFreshCanvasNodes = () => {
        if (autoFocusedFreshNodes) return
        const freshNodeIds = useRFStore.getState().nodes
          .map((node) => String(node.id || '').trim())
          .filter((nodeId) => Boolean(nodeId) && !preExistingCanvasNodeIds.has(nodeId))
        if (!freshNodeIds.length) return
        autoFocusedFreshNodes = true
        focusCanvasNodeAfterReload(freshNodeIds)
      }
      const manualReferenceImagesPayload = Array.isArray(referenceImages)
        ? referenceImages.map((u) => String(u || '').trim()).filter(Boolean)
        : []
      // 显式节点入口（例如“本章做成视频”）的事实作用域只属于该入口节点。
      // 画布上残留的选中图片不是用户在本轮声明的参考资产，不能混入请求并
      // 覆盖章节主角/场景。普通自由对话仍可读取显式选中节点。
      const attachSelectedCanvasAssets = shouldAttachSelectedCanvasAssets({
        projectTextIsolation: shouldUseProjectTextIsolation,
        explicitCanvasNodeId,
      })
      const focusedNodeContext = !attachSelectedCanvasAssets ? null : (() => {
        try {
          const { nodes } = useRFStore.getState()
          const selected = nodes.filter((n) => n.selected)
          if (selected.length !== 1) return null
          return extractFocusedNodeResourceContext(selected[0] as Node<Record<string, unknown>>)
        } catch {
          return null
        }
      })()

      const referenceImagesPayloadRaw = await (async (): Promise<string[]> => {
        const merged: string[] = []
        const seen = new Set<string>()
        const push = (url: string) => {
          const trimmed = String(url || '').trim()
          if (!trimmed || seen.has(trimmed)) return
          seen.add(trimmed)
          merged.push(trimmed)
        }

        manualReferenceImagesPayload.forEach(push)
        const rawCandidates = focusedNodeContext?.imageCandidates || []
        if (!rawCandidates.length) return merged
        for (const raw of rawCandidates) {
          const resolved = await resolveReferenceImageUrl(raw)
          if (!resolved) continue
          push(resolved)
        }

        return merged
      })()
      const referenceImagesPayload = selectedReplicateMode && targetEffectUrl
        ? referenceImagesPayloadRaw.filter((u) => u !== targetEffectUrl)
        : referenceImagesPayloadRaw
      const selectedAssetInputs: ChatAssetInput[] = !attachSelectedCanvasAssets ? [] : await (async (): Promise<ChatAssetInput[]> => {
        const { nodes } = useRFStore.getState()
        const selectedImages = nodes
          .filter((n) => n.selected && isImageKind(String((n.data as { kind?: string } | undefined)?.kind || '')))

        const candidates: Array<{
          nodeId: string
          assetId?: string
          assetRefId?: string
          url: string
          role?: ChatAssetInputRole
          note?: string
          name?: string
        }> = []
        for (let i = 0; i < selectedImages.length; i += 1) {
          const node = selectedImages[i]
          const primary = pickPrimaryImageUrlFromNode(node as Node)
          if (!primary) continue
          const resolved = await resolveReferenceImageUrl(primary)
          if (!resolved) continue
          candidates.push(buildSelectedImageAssetCandidate(node as Node, resolved))
        }
        return buildSelectedImageAssetInputs(candidates)
      })()
      const assetInputsPayload = (() => {
        const merged: ChatAssetInput[] = []
        const seenUrl = new Set<string>()
        const push = (item: ChatAssetInput) => {
          const role = String(item?.role || 'reference').trim() as ChatAssetInputRole
          const url = String(item?.url || '').trim()
          if (!url) return
          if (seenUrl.has(url)) return
          seenUrl.add(url)
          merged.push(item)
        }
        selectedAssetInputs.forEach(push)
        referenceImagesPayload.forEach((url) => {
          const uploadedMeta = uploadedReferenceAssetMetaRef.current[url] || null
          push({
            url,
            role: 'reference',
            ...(uploadedMeta?.nodeId ? { nodeId: uploadedMeta.nodeId } : {}),
            ...(uploadedMeta?.assetId ? { assetId: uploadedMeta.assetId } : {}),
            ...(uploadedMeta?.assetRefId ? { assetRefId: uploadedMeta.assetRefId } : {}),
            ...(uploadedMeta?.name ? { name: uploadedMeta.name } : {}),
          })
        })
        if (selectedReplicateMode && targetEffectUrl) {
          const targetMeta = uploadedReferenceAssetMetaRef.current[targetEffectUrl] || null
          merged.unshift({
            url: targetEffectUrl,
            role: 'target',
            note: '目标效果图：保持版式与模块布局',
            ...(targetMeta?.nodeId ? { nodeId: targetMeta.nodeId } : {}),
            ...(targetMeta?.assetId ? { assetId: targetMeta.assetId } : {}),
            ...(targetMeta?.assetRefId ? { assetRefId: targetMeta.assetRefId } : {}),
            ...(targetMeta?.name ? { name: targetMeta.name } : {}),
          })
        }
        return merged
      })()
      if (shouldBindChatSessionLanguageModel(messages)) {
        bindChatSessionLanguageModel(requestSessionKey, sendChatModelRequest.model)
      }
      const now = formatNowTime()
      const userMsg: ChatMessage = {
        id: `m_user_${Date.now()}`,
        localKey: `m_user_${Date.now()}`,
        role: 'user',
        ts: now,
        content: displayText || requestText,
        languageModel: sendChatModelRequest.model,
      }
      userMessageId = userMsg.id
      pendingId = `m_ai_pending_${Date.now() + 1}`
      activePendingIdRef.current = pendingId
      const pendingMsg: ChatMessage = {
        id: pendingId,
        localKey: pendingId,
        role: 'assistant',
        ts: now,
        // 事实文案：此刻请求尚未被执行器受理，不能谎称「处理中」。
        // onOpen（服务端受理）后才会翻转为真实的处理摘要。
        content: '等待执行器受理…',
        phase: 'thinking',
        kind: 'progress',
        ...(options?.workflowKey ? { workflowKey: options.workflowKey } : null),
      }

      setMessages((prev) => [...prev, userMsg, pendingMsg])

      setDraft('')
      if (mode === 'compact') setMode('expanded')

      const promptPayload = requestText
      const requestExecution = resolveChatRequestExecution()
      const selectedReferenceAnchorBindings = requestSelectedCanvasNodeContext
        ? normalizeSelectedReferenceAnchorBindings(requestSelectedCanvasNodeContext.anchorBindings)
        : undefined
      const currentChapterWindow = typeof window !== 'undefined'
        ? (window as Window & {
            __TAPCANVAS_CURRENT_CHAPTER__?: {
              projectId?: string
              bookId?: string
              chapterId?: string
            }
          }).__TAPCANVAS_CURRENT_CHAPTER__
        : undefined
      const roleSkillAssignments = sessionScopeProjectId
        ? await (async () => {
            const roleSkillStore = useProjectRoleSkillConfigStore.getState()
            await roleSkillStore.ensureLoaded(sessionScopeProjectId)
            return getProjectRoleSkillAssignments(sessionScopeProjectId)
          })()
        : []
      const chapterStyleOverride = chapterOverrideToChatContext(currentChapterCreativeOverride)
      // 普通对话只发送有版本的画布引用和摘要。节点事实按需通过 flow_get 读取；
      // 不再把节点索引复制进每一轮 prompt。冻结 Workflow 使用自己的不可变端口快照。
      const hasCurrentCanvasScope = Boolean(
        requestProjectId && (requestFlowId || currentChapterWindow?.chapterId),
      )
      const chapterCanvasReference = hasCurrentCanvasScope
        ? (() => {
            const canvasState = useRFStore.getState()
            const rfNodes = canvasState.nodes
            const scopeKey = canvasState.graphProvenanceKey
              || (currentChapterWindow?.chapterId
                ? `chapter:${currentChapterWindow.chapterId}`
                : `flow:${requestFlowId}`)
            return {
              version: 1 as const,
              scopeKey,
              nodeCount: rfNodes.length,
              edgeCount: canvasState.edges.length,
              ...(requestSelectedCanvasNodeContext?.nodeId
                ? { selectedNodeId: requestSelectedCanvasNodeContext.nodeId }
                : {}),
            }
          })()
        : undefined
      const canvasSummary = !directorScopeActive && currentFlowId
        ? (() => {
            const rfNodes = useRFStore.getState().nodes.filter((n) => n.type !== 'groupNode')
            if (rfNodes.length === 0) return undefined
            const counts: Record<string, number> = {}
            for (const n of rfNodes) {
              const kind = String((n.data as { kind?: unknown } | undefined)?.kind || '')
              const k = kind || n.type || 'unknown'
              counts[k] = (counts[k] || 0) + 1
            }
            const parts = Object.entries(counts).map(([k, c]) => `${k}×${c}`)
            return `${parts.join(', ')}, 共${rfNodes.length}节点`
          })()
        : undefined
      const workflowForcedAgentRole = String(options?.forcedAgentRole || '').trim()
      const uiForcedAgentRole = forcedAgentRole && getTeamRole(forcedAgentRole)?.assignable
        ? forcedAgentRole
        : ''
      const requestPayload: AgentsChatRequestDto = {
        vendor: 'agents',
        prompt: promptPayload,
        clientPendingId: pendingId,
        ...toAgentsChatModelPayload(sendChatModelRequest),
        ...(displayText && displayText !== requestText ? { displayPrompt: displayText } : {}),
        ...(requestSessionKey ? { sessionKey: requestSessionKey } : {}),
        ...(resetSession ? { resetSession: true } : {}),
        // 章节画布用权威 project（currentChapter.projectId）；非章节回退 currentProject。
        // 用发送瞬间现读的 requestProjectId/requestFlowId（见上），不用渲染闭包的 sessionScope 值。
        ...(requestProjectId ? { canvasProjectId: requestProjectId } : {}),
        ...(requestFlowId ? { canvasFlowId: requestFlowId } : {}),
        ...(requestCanvasNodeId ? { canvasNodeId: requestCanvasNodeId } : {}),
        ...(currentChapterWindow?.bookId ? { bookId: currentChapterWindow.bookId } : {}),
        ...(currentChapterWindow?.chapterId ? { chapterId: currentChapterWindow.chapterId } : {}),
		...(options?.executionToolPolicy
			? {
				executionToolPolicy: {
					mode: options.executionToolPolicy.mode,
					allowedTools: [...options.executionToolPolicy.allowedTools],
				},
			}
			: {}),
        chatContext: {
          chatMode: 'creative' as const,
          creativePhase: options?.creativePhaseOverride ?? creativePhase,
          ...(options?.requestedWorkflowExecutionVariant
            ? { requestedWorkflowExecutionVariant: options.requestedWorkflowExecutionVariant }
            : {}),
          ...(options?.generationProposal ? { generationProposal: options.generationProposal } : {}),
          ...(chapterCanvasReference ? { chapterCanvasReference } : {}),
          ...(canvasSummary ? { canvasSummary } : {}),
          // 普通对话只发送本轮用户选择的 Skill 引用；导演台的内部工作流要求在下方
          // requiredSkills 中声明，避免把内部强制技能伪装成用户在选择器里点选的条目。
          ...(!directorScopeActive && effectiveSkill
              ? {
                  skill: {
                    id: effectiveSkill.id,
                    source: effectiveSkill.source,
                  },
                }
              : {}),
          ...(requestSelectedNodeKind ? { selectedNodeKind: requestSelectedNodeKind } : {}),
          ...(currentChapterCreativeOverride?.directorPersona
            ? { chapterDirectorPersona: currentChapterCreativeOverride.directorPersona }
            : {}),
          ...(chapterStyleOverride ? { chapterStyleOverride } : {}),
          ...(roleSkillAssignments.length ? { roleSkillAssignments } : {}),
          ...(requestSelectedCanvasNodeContext
            ? {
                selectedReference: {
                  nodeId: requestSelectedCanvasNodeContext.nodeId,
                  label: requestSelectedCanvasNodeContext.label,
                  ...(requestSelectedCanvasNodeContext.kind ? { kind: requestSelectedCanvasNodeContext.kind } : {}),
                  ...(selectedReferenceAnchorBindings?.length
                    ? { anchorBindings: selectedReferenceAnchorBindings }
                    : {}),
                  ...(requestSelectedCanvasNodeContext.roleName ? { roleName: requestSelectedCanvasNodeContext.roleName } : {}),
                  ...(requestSelectedCanvasNodeContext.roleCardId ? { roleCardId: requestSelectedCanvasNodeContext.roleCardId } : {}),
                  ...(requestSelectedCanvasNodeContext.imageUrl ? { imageUrl: requestSelectedCanvasNodeContext.imageUrl } : {}),
                  ...(requestSelectedCanvasNodeContext.sourceUrl ? { sourceUrl: requestSelectedCanvasNodeContext.sourceUrl } : {}),
                  ...(requestSelectedCanvasNodeContext.bookId ? { bookId: requestSelectedCanvasNodeContext.bookId } : {}),
                  ...(requestSelectedCanvasNodeContext.chapterId ? { chapterId: requestSelectedCanvasNodeContext.chapterId } : {}),
                  ...(typeof requestSelectedCanvasNodeContext.shotNo === 'number' ? { shotNo: requestSelectedCanvasNodeContext.shotNo } : {}),
                  ...(requestSelectedCanvasNodeContext.productionLayer ? { productionLayer: requestSelectedCanvasNodeContext.productionLayer } : {}),
                  ...(requestSelectedCanvasNodeContext.creationStage ? { creationStage: requestSelectedCanvasNodeContext.creationStage } : {}),
                  ...(requestSelectedCanvasNodeContext.approvalStatus ? { approvalStatus: requestSelectedCanvasNodeContext.approvalStatus } : {}),
                  ...(requestSelectedCanvasNodeContext.authorityBaseFrameNodeId
                    ? { authorityBaseFrameNodeId: requestSelectedCanvasNodeContext.authorityBaseFrameNodeId }
                    : {}),
                  ...(requestSelectedCanvasNodeContext.authorityBaseFrameStatus
                    ? { authorityBaseFrameStatus: requestSelectedCanvasNodeContext.authorityBaseFrameStatus }
                    : {}),
                  ...(requestSelectedCanvasNodeContext.hasUpstreamTextEvidence ? { hasUpstreamTextEvidence: true } : {}),
                  ...(requestSelectedCanvasNodeContext.hasDownstreamComposeVideo ? { hasDownstreamComposeVideo: true } : {}),
                  ...(requestSelectedCanvasNodeContext.storyboardSelectionContext
                    ? { storyboardSelectionContext: requestSelectedCanvasNodeContext.storyboardSelectionContext }
                    : {}),
                },
              }
            : {}),
        },
        mode: requestExecution.mode,
        ...((workflowForcedAgentRole || uiForcedAgentRole)
          ? { forcedAgentRole: workflowForcedAgentRole || uiForcedAgentRole }
          : {}),
        ...(options?.allowedSubagentTypes?.length
          ? { allowedSubagentTypes: [...options.allowedSubagentTypes] }
          : {}),
        ...(options?.requireAgentsTeamExecution === true
          ? { requireAgentsTeamExecution: true }
          : {}),
        temperature: 0.7,
        ...((() => {
          const DIRECTOR_SKILL = 'tapcanvas-director-console'
          let skills = options?.requiredSkills ?? []
          // 导演台打开时强制内联导演台技能（编辑优先 + 禁 Seedance 8 段收尾自检），不靠模型自匹配。
          if (directorScopeActive && !skills.includes(DIRECTOR_SKILL)) skills = [DIRECTOR_SKILL, ...skills]
          return skills.length ? { requiredSkills: skills } : {}
        })()),
        ...(referenceImagesPayload.length ? { referenceImages: referenceImagesPayload } : {}),
        ...(assetInputsPayload.length ? { assetInputs: assetInputsPayload } : {}),
        ...(pendingUserInputAnswerRef.current ? { requestUserInputResponse: pendingUserInputAnswerRef.current } : {}),
      }
      pendingUserInputAnswerRef.current = null
      const resp = await new Promise<AgentsChatResponseDto>((resolve, reject) => {
        let stopStream: (() => void) | null = null
        let settled = false
        let resultReceived = false
        let lastStreamError: (Error & { code?: string; details?: unknown }) | null = null
        let latestThinkingSummary = '正在处理你的请求'
        const completedToolOutcomes = new Map<string, PresentedToolStatus>()
        // 工具子步骤挂载锚点：最近一次 todo_list 里 in_progress 项的序号
        let latestActiveTodoIndex = -1
        const patchPendingToolSteps = () => {
          const snapshot = liveToolSteps.map((step) => ({ ...step }))
          setMessages((prev) =>
            patchChatMessageById(prev, pendingId, (message) => ({
              ...message,
              toolSteps: snapshot,
            })),
          )
        }
        const updatePendingSummary = (summary: string) => {
          const nextSummary = summarizeThinkingText(summary)
          if (!nextSummary || nextSummary === latestThinkingSummary) return
          latestThinkingSummary = nextSummary
          setMessages((prev) =>
            patchChatMessageById(prev, pendingId, (message) => ({
              ...message,
              content: nextSummary,
            })),
          )
        }

        const flushStreamedReply = () => {
          const orderedBlocks = toOrderedBlocks(blockState)
          setMessages((prev) =>
            patchChatMessageById(prev, pendingId, (message) => ({
              ...message,
              phase: undefined,
              content: streamedReply,
              ...(orderedBlocks.length ? { blocks: orderedBlocks } : null),
            })),
          )
        }
        const streamedTextBuffer = createStreamingTextBuffer({
          flushIntervalMs: 80,
          maxBufferedChars: 384,
          onFlush: flushStreamedReply,
        })

        const finalize = (resolver: () => void) => {
          if (settled) return
          settled = true
          streamedTextBuffer.flush()
          streamedTextBuffer.dispose()
          activeStreamInterruptRef.current = null
          if (stopStream) stopStream()
          clearChatStreamTimeouts()
          resolver()
        }

        // 受理前保留 30s 连接超时；受理后没有新业务事件不等于任务失败。
        // SSE heartbeat 也会通过 onTransportActivity 续租此本地观察窗口；即使超过
        // 180s，也只更新为“继续同步”事实状态，不能终结已持久受理的服务端任务。
        let connectionTimerId: number | null = null
        let idleTimerId: number | null = null
        const clearChatStreamTimeouts = () => {
          if (connectionTimerId !== null) {
            window.clearTimeout(connectionTimerId)
            connectionTimerId = null
          }
          if (idleTimerId !== null) {
            window.clearTimeout(idleTimerId)
            idleTimerId = null
          }
        }
        const armChatStreamIdle = () => {
          if (idleTimerId !== null) window.clearTimeout(idleTimerId)
          idleTimerId = window.setTimeout(() => {
            if (settled) return
            if (executionWasAccepted) {
              updatePendingSummary('暂未收到新事件，正在按已受理任务继续同步状态')
              armChatStreamIdle()
            }
          }, 180_000)
        }
        connectionTimerId = window.setTimeout(() => {
          if (settled) return
          finalize(() => reject(new Error('等待执行器受理超时（30 秒）。服务连接可能不可用，请重试。')))
        }, 30_000)

        activeStreamInterruptRef.current = () => {
          finalize(() => reject(new Error(CHAT_STREAM_ABORT_ERROR)))
        }
        // 记下本条流所属的会话作用域：scope-change 时据此判断该不该掐它（见 activeStreamScopeRef）。
        activeStreamScopeRef.current = getChatSessionConversationScope(requestSessionKey)

        void agentsChatStream(requestPayload, {
          onOpen: ({ turnId }) => {
            if (resetSession) {
              resetSessionOnNextSendRef.current = false
              conversationResetPendingRef.current = false
              setConversationResetPending(false)
            }
            // 服务端已受理：连接超时解除，切换为空闲超时监护。
            if (connectionTimerId !== null) {
              window.clearTimeout(connectionTimerId)
              connectionTimerId = null
            }
            armChatStreamIdle()
            acceptedTransportTurnId = turnId
            executionWasAccepted = true
            // onOpen 即服务端受理（durable 回合已建立）：执行状态必须立即置位，
            // 否则长思考回合（无任何事件）hint 一直误显示「尚未开始运行」。
            setAgentExecutionAccepted(true)
            setActivePublicTurnId(turnId)
            activePublicTurnIdRef.current = turnId
            const provisionalUserMessageId = userMessageId
            const provisionalAssistantMessageId = pendingId
            const stableIds = buildRecoveredChatMessageIds(turnId)
            userMessageId = stableIds.userMessageId
            pendingId = stableIds.assistantMessageId
            activePendingIdRef.current = pendingId
            // 服务端已受理：pending 气泡从「等待执行器受理…」翻转为真实的处理状态。
            // 注意先按旧 pendingId patch 再重绑 id，避免 patch 落在已重绑的新 id 上。
            setMessages((current) => patchChatMessageById(current, provisionalAssistantMessageId, (message) => ({
              ...message,
              content: message.content === '等待执行器受理…' ? '正在处理你的请求' : message.content,
            })))
            setMessages((current) => bindAcceptedTurnMessageIds(current, {
              turnId,
              provisionalUserMessageId,
              provisionalAssistantMessageId,
            }).messages)
            startLiveChatRun({
              runId: pendingId,
              requestId: turnId,
              requestText,
              displayText,
              projectId: currentProjectId,
              projectName: currentProjectName,
              flowId: currentFlowId,
              sessionKey: requestSessionKey,
              skillName: effectiveSkill?.name || effectiveSkill?.key || '',
              ...(options?.workflowKey ? { workflowKey: options.workflowKey } : {}),
            })
          },
          onEvent: (event) => {
            if (settled) return
            armChatStreamIdle()
            recordLiveChatRunEvent(event)
            if (
              event.event === 'thread.started' ||
              event.event === 'turn.started' ||
              event.event === 'tool' ||
              event.event === 'skill' ||
              event.event === 'todo_list' ||
              event.event === 'agent_role' ||
              event.event === 'status-update' ||
              event.event === 'artifact-update' ||
              event.event === 'content'
            ) {
              executionWasAccepted = true
              setAgentExecutionAccepted(true)
            }
            if (event.event === 'skill') {
              const skillIdentity = String(event.data.key || event.data.id || '').trim()
              const referencedSkill = agentSkills.find(
                (skill) => skill.key === skillIdentity || skill.id === skillIdentity,
              )
              const skillName = String(
                referencedSkill?.name || event.data.name || event.data.key || '',
              ).trim()
              if (!streamedReply && skillName) {
                const summary = event.data.phase !== 'completed'
                  ? `正在加载「${skillName}」`
                  : event.data.status === 'succeeded'
                    ? `已加载「${skillName}」`
                    : `加载「${skillName}」失败`
                updatePendingSummary(
                  summary,
                )
              }
              // The structural tool trace intentionally hashes arbitrary
              // string arguments, so the paired generic `tool` event cannot
              // reliably expose args.skill. The first-class skill event is
              // the authoritative, non-secret identity channel: use it to
              // replace the generic “加载技能” step with the real name.
              if (skillName) {
                const callId = String(event.data.toolCallId || '').trim()
                const step = liveToolSteps.find((item) => item.callId === callId)
                if (step) {
                  step.label = `加载 ${skillName}`
                  if (event.data.phase === 'completed') {
                    const status = String(event.data.status || '').trim().toLowerCase()
                    step.status = status === 'failed'
                      ? 'failed'
                      : status === 'denied'
                        ? 'denied'
                        : status === 'blocked'
                          ? 'blocked'
                          : 'succeeded'
                    if (typeof event.data.durationMs === 'number' && Number.isFinite(event.data.durationMs)) {
                      step.durationMs = Math.max(0, event.data.durationMs)
                    }
                  }
                  patchPendingToolSteps()
                }
              }
              return
            }
            if (event.event === 'thinking') {
              const line = String(event.data.text || '').trim()
              if (!line) return
              if (streamedReply) return
              updatePendingSummary(line)
              return
            }
            if (event.event === 'status-update') {
              if (event.data.phase === 'agent_continuation' && !streamedReply) {
                const afterToolCallId = String(event.data.afterToolCallId || '').trim()
                updatePendingSummary(buildAgentContinuationSummary(
                  afterToolCallId ? completedToolOutcomes.get(afterToolCallId) : undefined,
                ))
              }
              return
            }
            if (event.event === 'tool') {
              const presentedToolName = resolvePresentedToolName(event.data.toolName, event.data.input)
              const presentedToolLabel = describeToolStep(
                presentedToolName,
                event.data.input,
                agentSkills,
              )
              const completedStatus = String(event.data.status || '').trim().toLowerCase()
              const completedIsDeferred = event.data.phase === 'completed' && isDeferredChatToolStep({
                status: completedStatus,
                severity: event.data.severity,
              })
              if (!streamedReply && !completedIsDeferred) {
                updatePendingSummary(buildToolProgressSummary({
                  label: presentedToolLabel,
                  phase: event.data.phase,
                  status: event.data.status,
                  severity: event.data.severity,
                }))
              }
              if (event.data.phase === 'completed' && event.data.status) {
                const completedCallId = String(event.data.toolCallId || '').trim()
                if (completedCallId) completedToolOutcomes.set(completedCallId, event.data.status)
              }
              if (!shouldHideToolStep(presentedToolName)) {
                const callId = String(event.data.toolCallId || '').trim() || `${presentedToolName}_${liveToolSteps.length}`
                if (event.data.phase === 'started') {
                  if (!liveToolSteps.some((step) => step.callId === callId)) {
                    liveToolSteps.push({
                      callId,
                      toolName: presentedToolName,
                      label: presentedToolLabel,
                      status: 'running',
                      anchorTodoIndex: latestActiveTodoIndex,
                      startedAt: Date.now(),
                    })
                  }
                } else {
                  const status = String(event.data.status || '').trim().toLowerCase()
                  const resolved: ChatToolStep['status'] =
                    status === 'failed' ? 'failed' : status === 'denied' ? 'denied' : status === 'blocked' ? 'blocked' : 'succeeded'
                  // 工具耗时：优先服务端 durationMs，缺失时按 finishedAt-startedAt 兜底。
                  const durationMs = resolveToolDurationMs(event.data)
                  const nextStep: ChatToolStep = {
                    callId,
                    toolName: presentedToolName,
                    label: presentedToolLabel,
                    status: resolved,
                    severity: event.data.severity,
                    anchorTodoIndex: latestActiveTodoIndex,
                    ...(durationMs != null ? { durationMs } : null),
                  }
                  const step = liveToolSteps.find((item) => item.callId === callId)
                  if (step) {
                    nextStep.startedAt = step.startedAt
                  }
                  if (isDeferredChatToolStep({ status, severity: event.data.severity })) {
                    const replaced = replaceDeferredToolStep({
                      visible: liveToolSteps,
                      deferred: deferredToolFailures,
                      step: nextStep,
                    })
                    liveToolSteps.splice(0, liveToolSteps.length, ...replaced.visible)
                    deferredToolFailures.splice(0, deferredToolFailures.length, ...replaced.deferred)
                  } else if (step) {
                    step.toolName = nextStep.toolName
                    step.label = nextStep.label
                    step.status = nextStep.status
                    step.severity = nextStep.severity
                    if (nextStep.durationMs != null) step.durationMs = nextStep.durationMs
                  } else {
                    liveToolSteps.push({
                      ...nextStep,
                    })
                  }
                  // 工具结束 → 清理批量出图进度计数（TTL 兜底外的确定性清理）。
                  useToolProgressStore.getState().clearToolProgress(callId)
                }
                patchPendingToolSteps()
              }
              // 工具完成 → 服务端可能刚写了画布；稍候 SSE 补丁落地后尝试聚焦新节点
              if (event.data.phase === 'completed' && !autoFocusedFreshNodes) {
                window.setTimeout(tryFocusFreshCanvasNodes, 700)
              }
              return
            }
            if (event.event === 'todo_list') {
              const todoItems = normalizeChatTodoItems(event.data.items)
              if (!todoItems.length) return
              // 任务行墙钟计时：首次见到（in_progress 或已 completed）记起点；首次见到 completed 落耗时。
              const nowMs = Date.now()
              for (const item of todoItems) {
                const existing = todoTimings.get(item.content)
                if (item.status === 'in_progress' && !existing) {
                  todoTimings.set(item.content, { startedAt: nowMs })
                } else if (item.status === 'completed') {
                  if (!existing) {
                    todoTimings.set(item.content, { startedAt: nowMs, durationMs: 0 })
                  } else if (existing.durationMs == null) {
                    existing.durationMs = Math.max(0, nowMs - existing.startedAt)
                  }
                }
              }
              const timedTodoItems = attachTodoDurations(todoItems)
              const inProgressIndex = timedTodoItems.findIndex((item) => item.status === 'in_progress')
              latestActiveTodoIndex = inProgressIndex >= 0
                ? inProgressIndex
                : Math.min(countCompletedTodoItems(timedTodoItems), timedTodoItems.length - 1)
              const activeItem = findInProgressTodoItem(timedTodoItems)
              const summary = activeItem
                ? `正在执行：${activeItem.content}`
                : `正在整理任务清单（${countCompletedTodoItems(timedTodoItems)}/${timedTodoItems.length}）`
              setMessages((prev) =>
                patchChatMessageById(prev, pendingId, (message) => ({
                  ...message,
                  todoSnapshot: timedTodoItems,
                })),
              )
              if (!streamedReply) {
                updatePendingSummary(summary)
              }
              return
            }
            if (event.event === 'agent_role') {
              // 流水线角色子 agent 活动：upsert 到本轮消息的 workingRoles，
              // running 时把「分镜师正在工作…」顶进 thinking 摘要。
              const roleData = event.data
              const agentId = String(roleData?.agentId || '')
              if (!agentId) return
              const entry: ChatWorkingRole = {
                agentId,
                role: String(roleData.role || ''),
                roleName: String(roleData.roleName || roleData.role || '协作角色'),
                status: (roleData.status as ChatWorkingRole['status']) || 'running',
                ...(roleData.progressSummary ? { progressSummary: String(roleData.progressSummary) } : {}),
                ...(roleData.at ? { at: String(roleData.at) } : {}),
              }
              setMessages((prev) =>
                patchChatMessageById(prev, pendingId, (message) => {
                  const prevRoles = Array.isArray(message.workingRoles) ? message.workingRoles : []
                  const nextRoles = prevRoles.filter((item) => item.agentId !== agentId)
                  nextRoles.push(entry)
                  return { ...message, workingRoles: nextRoles.slice(-8) }
                }),
              )
              if (!streamedReply && entry.status === 'running') {
                updatePendingSummary(
                  entry.progressSummary
                    ? `${entry.roleName}：${entry.progressSummary}`
                    : `${entry.roleName} 正在工作…`,
                )
              }
              return
            }
            if (event.event === 'content') {
              const delta = String(event.data.delta || '')
              if (!delta) return
              streamedReply += delta
              // 正文里每闭合一个 ```choices 围栏/裸 JSON，就解析沉淀进 blockState（id 哈希稳定，
              // op:set 幂等）。这样收尾覆盖 content 后选项卡仍在 message.blocks 里，不会消失。
              if (streamedReply.includes('```choices') || streamedReply.includes('{"question"')) {
                const { dataBlocks } = extractChoicesCardBlocks(streamedReply)
                for (const block of dataBlocks) {
                  blockState = reconcileBlocks(blockState, { op: 'set', block })
                }
              }
              streamedTextBuffer.append(delta)
              return
            }
            if (event.event === 'block') {
              blockState = reconcileBlocks(blockState, event.data)
              const ordered = toOrderedBlocks(blockState)
              setMessages((prev) =>
                patchChatMessageById(prev, pendingId, (message) => ({
                  ...message,
                  blocks: ordered,
                })),
              )
              return
            }
            if (event.event === 'suggestions') {
              const items = Array.isArray(event.data?.items)
                ? event.data.items.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
                : []
              if (items.length) {
                setMessages((prev) =>
                  patchChatMessageById(prev, pendingId, (message) => ({
                    ...message,
                    suggestions: items,
                  })),
                )
              }
              return
            }
            if (event.event === 'result') {
              resultReceived = true
              finalize(() => resolve(event.data.response))
              return
            }
            if (event.event === 'error') {
              const streamError = Object.assign(
                new Error(formatAgentsStreamErrorMessage(event.data)),
                {
                  code: typeof event.data.code === 'string' ? event.data.code : undefined,
                  details: event.data.details,
                },
              )
              lastStreamError = streamError
              if (!shouldTerminateChatTurnForStreamError(event.data)) {
                if (!streamedReply) {
                  updatePendingSummary(formatAgentsStreamErrorMessage(event.data))
                }
                return
              }
              finalize(() => reject(streamError))
              return
            }
            if (event.event === 'done') {
              if (resultReceived) return
              const reason = String(event.data.reason || '').trim()
              if (reason === 'error' && lastStreamError) {
                const terminalStreamError = lastStreamError
                finalize(() => reject(terminalStreamError))
                return
              }
              const message =
                reason === 'error'
                  ? '对话流异常结束'
                  : reason === 'interrupted'
                    ? '本轮执行已中断'
                    : `对话流缺少 ${reason} 对应的结果事件`
              finalize(() => reject(new Error(message)))
            }
          },
          onTransportActivity: () => {
            if (!settled && executionWasAccepted) armChatStreamIdle()
          },
          onError: (error) => {
            finalize(() => reject(error))
          },
        }, conversationIdRef.current)
          .then((abort) => {
            if (settled) {
              abort()
              return
            }
            stopStream = abort
          })
          .catch((error) => {
            finalize(() => reject(error instanceof Error ? error : new Error('对话流失败')))
          })
      })
      const rawReply = typeof resp?.text === 'string' ? resp.text.trim() : ''
      const { displayText: parsedReply, plan: canvasPlan } = parseCanvasPlanFromReply(rawReply)
      const hasWrongCanvasPlanTag = /<tcanvas_canvas_plan>/i.test(rawReply) || /tcanvas_canvas_plan/i.test(rawReply)
      const turnVerdict = readChatTurnVerdict(resp)
      const turnVerdictSummary = formatChatTurnVerdictSummary(resp)
      const failedTurn = isFailedChatTurn(resp)
      const failedTurnMessage = turnVerdictSummary || '结构失败：本轮没有形成有效结果'
      const missingCanvasPlan = shouldShowMissingCanvasPlanError({
        hasCanvasPlan: Boolean(canvasPlan),
        hasWrongCanvasPlanTag,
        response: resp,
      })
      const rawDisplayReply = parsedReply || rawReply
      const terminalReply = resolveTerminalReply({
        response: resp,
        originalReply: rawDisplayReply,
        verdictSummary: turnVerdictSummary,
      })
      const reply = resolveAssistantReplyText({
        response: resp,
        reply: terminalReply.text,
      })
      const parsedAutoImages = extractTapCanvasAutoGeneratedImages(reply)
      const assistantAssetsRaw = normalizeAssistantAssets(resp.assets)
      const assistantAssets = mergeAssistantAssets(assistantAssetsRaw, parsedAutoImages)
      const referenceDocuments = buildChatReferenceDocuments(resp.trace?.executionProvenance)
      const visualAssistantAssets = assistantAssets.filter((asset) => asset.mediaType !== 'audio')
      let canvasPlanExecuted = false
      let failedTurnHandled = false
      const backendWroteCanvas =
        resp.trace?.deliveryEvidence?.wroteCanvas === true
      if (canvasPlan) {
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: '正在应用节点方案',
          })),
        )
        try {
          const executed = await executeCanvasPlan(canvasPlan)
          canvasPlanExecuted = executed.createdNodeIds.length > 0
          if (!failedTurn && executed.createdNodeIds.length > 0) {
            autoRunAiChatCanvasNodes(executed.createdNodeIds)
          }
          const executedPrimaryNodeId = pickPrimaryCreationNodeId(
            executed.createdNodeIds.length > 0 ? executed.createdNodeIds : executed.resolvedNodeIds,
          )
          if (typeof window !== 'undefined' && typeof (window as unknown as { silentSaveProject?: () => void }).silentSaveProject === 'function') {
            ;(window as unknown as { silentSaveProject: () => void }).silentSaveProject()
          }
        } catch (error: unknown) {
          void error
        }
      } else if (missingCanvasPlan) {
        failedTurnHandled = true
      }
      if (failedTurn && !failedTurnHandled) failedTurnHandled = true
      if (!canvasPlanExecuted && backendWroteCanvas && requestFlowId) {
        try {
          const reloaded = await reloadCanvasFlowFromServer({
            flowId: requestFlowId,
            expectedProjectId: requestProjectId,
            expectedFlowId: requestFlowId,
          })
          if (reloaded.newNodeIds.length > 1) {
            reflowNewBatchNodesHorizontally(reloaded.newNodeIds)
          }
          const reloadAutoRunPlan = resolveAiChatReloadAutoRunPlan({
            newNodeIds: reloaded.newNodeIds,
            traceCanvasMutation: resp.trace?.canvasMutation,
            failedTurn,
          })
          if (reloaded.reloaded) {
            if (reloadAutoRunPlan.focusNodeIds.length > 0) {
              autoFocusedFreshNodes = true
              focusCanvasNodeAfterReload(reloadAutoRunPlan.focusNodeIds)
            }
            if (reloadAutoRunPlan.autoRunNewNodeIds.length > 0) {
              autoRunAiChatCanvasNodes(reloadAutoRunPlan.autoRunNewNodeIds)
            }
            if (reloadAutoRunPlan.autoRunPatchedNodeIds.length > 0) {
              autoRunAiChatPatchedCanvasNodes(reloadAutoRunPlan.autoRunPatchedNodeIds)
            }
          }
        } catch (error: unknown) {
          console.warn('[ai-chat] reload flow after backend canvas write failed', error)
        }
      }
      // 兜底聚焦：节点若已在对话中经 SSE 实时落画布，上面 reload 的 diff 会是空集而不触发聚焦，
      // 这里以发送时刻快照为基准再判一次（每轮最多聚焦一次，已聚焦则跳过）。
      tryFocusFreshCanvasNodes()
      const shouldWatchAssets = shouldAutoAddAssistantAssetsToCanvas({
        canvasPlanExecuted,
        aiChatWatchAssetsEnabled,
        assistantAssetCount: visualAssistantAssets.length,
        response: resp,
      })
      if (shouldWatchAssets) {
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: '正在整理最终结果',
          })),
        )
        addAssistantAssetsToCanvas(visualAssistantAssets)
      }
      if (!streamedReply && reply) {
        await animateAssistantReply(pendingId, reply)
      }
      const projectedTerminalStatus = resolveChatTerminalProjection(resp).status
      const projectedToolSteps = resolveDeferredToolSteps({
        visible: liveToolSteps,
        deferred: deferredToolFailures,
        terminalStatus: projectedTerminalStatus,
      })
      const responseStillContinuing = projectedTerminalStatus === 'active' || projectedTerminalStatus === 'waiting_external'
      setMessages((prev) => {
        const patched = patchChatMessageById(prev, pendingId, (message) => ({
          ...message,
          content: reply,
          assets: assistantAssets,
          ts: formatNowTime(),
          phase: responseStillContinuing ? 'thinking' : 'final',
          kind: responseStillContinuing ? 'progress' : projectedTerminalStatus === 'failed' ? 'error' : 'result',
          logicalTaskStatus: projectedTerminalStatus,
          ...(referenceDocuments.skills.length > 0 || referenceDocuments.knowledge.length > 0
            ? { referenceDocuments }
            : null),
          // 本轮耗时：你发出到小T最终回复完成的总墙钟。
          turnDurationMs: Math.max(0, Date.now() - turnStartedAt),
          ...(Array.isArray(resp.trace?.todoList?.items)
            ? { todoSnapshot: responseStillContinuing
              ? normalizeChatTodoItems(resp.trace.todoList.items)
              : terminalizeOpenTodos(finalizeTodoDurations(normalizeChatTodoItems(resp.trace.todoList.items))) }
            : Array.isArray(message.todoSnapshot)
              ? { todoSnapshot: responseStillContinuing
                ? message.todoSnapshot
                : terminalizeOpenTodos(finalizeTodoDurations(message.todoSnapshot)) }
              : null),
          // 流已收尾但工具仍 running，说明缺少事实性的 completed 事件。失败就是失败：
          // 不能把“没收到终态”乐观改成 succeeded，否则会把超时/断流伪装成已完成。
          ...(projectedToolSteps.length
            ? {
                toolSteps: projectedToolSteps.map((step) => ({
                  ...step,
                  status: step.status === 'running' && projectedTerminalStatus === 'failed'
                    ? ('failed' as const)
                    : step.status,
                })),
              }
            : null),
          ...(!responseStillContinuing &&
          Array.isArray(message.workingRoles) && message.workingRoles.length
            ? {
                workingRoles: message.workingRoles.map((role) =>
                  role.status === 'running' || role.status === 'queued'
                    ? { ...role, status: 'failed' as const, progressSummary: '对话已收尾，但未收到该子代理的完成事件' }
                    : role,
                ),
              }
            : null),
          ...(turnVerdict ? { turnVerdict } : null),
          ...(Array.isArray(resp.trace?.diagnosticFlags) ? { diagnosticFlags: resp.trace?.diagnosticFlags } : null),
          ...(resp.pendingUserInput ? { pendingUserInput: resp.pendingUserInput } : null),
          // blocks：服务端 canonical（最后一轮）与流式沉淀（含早轮 choices/tc-card）按 id 合并，
          // 收尾覆盖 content 不再冲掉早轮选项卡。
          ...((): { blocks: ContentBlock[] } | null => {
            const merged = mergeInlineCardBlocks(
              Array.isArray(resp.blocks) && resp.blocks.length ? resp.blocks : undefined,
              toOrderedBlocks(blockState),
            )
            return merged.length ? { blocks: merged } : null
          })(),
          ...((): { suggestions: string[] } | null => {
            // 入口处把 suggestions 统一 coerce 成非空字符串数组（服务端偶发下发 {text} 对象），
            // 与 SSE 'suggestions' 分支保持一致，避免脏对象落进 message.suggestions。
            const items = Array.isArray(resp.suggestions)
              ? resp.suggestions.map((s) => coerceChoiceText(s)).filter((s) => s.length > 0)
              : []
            return items.length ? { suggestions: items } : null
          })(),
        }))
        const requestId = resp.pendingUserInput?.requestId
        if (!requestId) return patched
        // If the canvas status projection arrived before the chat response,
        // remove its transport-only copy now that the canonical response owns
        // the same request_user_input card.
        return patched.filter((message) =>
          message.id === pendingId || message.pendingUserInput?.requestId !== requestId,
        )
      })
      if (options?.onFinalReply && projectedTerminalStatus === 'succeeded') {
        try {
          await options.onFinalReply(reply)
        } catch (error: unknown) {
          toast(
            `对话已完成，但保存项目简报失败：${error instanceof Error ? error.message : '未知错误'}`,
            'error',
          )
        }
      }
      completeLiveChatRun(resp, reply)
      reconcileLiveChatAsyncArtifacts(useRFStore.getState().nodes)
    } catch (err: unknown) {
      activeStreamInterruptRef.current = null
      const msg = err instanceof Error ? err.message : '对话失败'
      if (shouldQueueAfterAuthoritativeAdmission(err)) {
        // Keep the original user bubble visible until the durable queue write
        // succeeds. If enqueue fails, removing it first would silently erase
        // the user's request and leave only the draft fallback.
        setMessages((prev) => prev.filter((message) => message.id !== pendingId))
        activePendingIdRef.current = ''
        // The server has now provided the authoritative active-turn fact.
        // Preserve the user's action by durably appending it to that logical
        // task instead of bouncing the user back to a disabled/error state.
        const queued = await enqueueRunningMessage('follow_up', {
          ...options,
          text: requestText,
          displayText,
        })
        if (!queued) {
          setDraft((current) => String(current || '').trim() ? current : (displayText || requestText))
        } else {
          // The queued projection now replaces the provisional user bubble;
          // remove the old copy only after the server returned a queue receipt.
          setMessages((prev) => prev.filter((message) => message.id !== userMessageId))
        }
        await refreshChatTurnStatus()
        return
      }
      if (isChatAbortError(err)) {
        cancelLiveChatRun(CHAT_ABORTED_MESSAGE)
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: CHAT_ABORTED_MESSAGE,
            phase: 'final',
            kind: 'error',
            // 中断收尾：把仍转圈的 in_progress 任务降级为 pending，否则任务清单会永远转圈
            // 让“已中断”和“清单仍在跑”状态不自洽。
            ...(Array.isArray(message.todoSnapshot)
              ? { todoSnapshot: terminalizeInterruptedTodos(message.todoSnapshot) }
              : null),
            // 同理收尾工具子步：中断=前端 fetch abort 直接断流，后端不再补发该 tool_call 的
            // completed 事件 → 仍 running 的子步（如「生成图片到画布」）会永远转 spinner，与
            // 「已中断/已出建议回复」三态打架。降级为 cancelled（渲染 ⊘）。对齐成功路径的 running 收尾。
            ...(Array.isArray(message.toolSteps) && message.toolSteps.length
              ? {
                  toolSteps: message.toolSteps.map((step) =>
                    step.status === 'running' ? { ...step, status: 'cancelled' as const } : step,
                  ),
                }
              : null),
            // 同理收尾中途提问卡：小T 没等回答就继续推进过的 choices 卡（围栏后面还有正文）
            // 标过期灰态，避免中断收尾后残影被误读成「小T停在这里等你选」。
            ...(Array.isArray(message.blocks) && message.blocks.length
              ? { blocks: supersedeStaleChoices(message.blocks, streamedReply) }
              : null),
          })),
        )
        return
      }
      if (executionWasAccepted && acceptedTransportTurnId) {
        const recovered = await recoverAcceptedChatTurnAfterTransportLoss({
          turnId: acceptedTransportTurnId,
          refresh: refreshChatTurnStatus,
        })
        const recoveredTurn = recovered?.turn ?? null
        if (recovered && recoveredTurn?.turnId === acceptedTransportTurnId) {
          reconcileLiveChatTurnStatus(recovered)
          if (recovered.activeTurn) {
            // The durable run survived but this browser's SSE did not. Remove
            // only the transport-local assistant bubble; the original user
            // message must remain visible after recovery reaches a terminal state.
            setMessages((current) => current.filter((message) => message.id !== pendingId))
            return
          }
          const terminalText = resolveRecoveredChatTurnTerminalText(recoveredTurn)
          const recoveredStillContinuing = recoveredTurn.logicalTaskState.status === 'active'
            || recoveredTurn.logicalTaskState.status === 'waiting_external'
          setMessages((current) => patchChatMessageById(current, pendingId, (message) => ({
            ...message,
            content: terminalText,
            ts: formatNowTime(),
            phase: recoveredStillContinuing ? 'thinking' : 'final',
            kind: recoveredStillContinuing
              ? 'progress'
              : terminalChatMessageKind(recoveredTurn.logicalTaskState.status),
            ...(Array.isArray(message.todoSnapshot)
              ? {
                  todoSnapshot: recoveredStillContinuing
                    ? message.todoSnapshot
                    : terminalizeOpenTodos(message.todoSnapshot),
                }
              : null),
            ...(Array.isArray(message.toolSteps) && message.toolSteps.length
              ? {
                  toolSteps: message.toolSteps.map((step) =>
                    step.status === 'running' && (
                      recoveredTurn.logicalTaskState.status === 'succeeded'
                      || recoveredTurn.logicalTaskState.status === 'failed'
                      || recoveredTurn.logicalTaskState.status === 'cancelled'
                    )
                      ? {
                          ...step,
                          status: recoveredTurn.logicalTaskState.status === 'succeeded'
                            ? 'succeeded' as const
                            : 'failed' as const,
                        }
                      : step,
                  ),
                }
              : null),
          })))
          return
        }
      }
      failLiveChatRun(msg)
      if (pendingId) {
        setMessages((prev) =>
          patchChatMessageById(prev, pendingId, (message) => ({
            ...message,
            content: `（错误）${msg}`,
            ts: formatNowTime(),
            phase: 'final',
            kind: 'error',
            // 同上：报错收尾也要把 in_progress 任务降级，避免清单永远转圈。
            ...(Array.isArray(message.todoSnapshot)
              ? { todoSnapshot: terminalizeInterruptedTodos(message.todoSnapshot) }
              : null),
            // 同上收尾仍 running 的工具子步，避免报错后 spinner 永转。
            ...(Array.isArray(message.toolSteps) && (message.toolSteps.length > 0 || deferredToolFailures.length > 0)
              ? {
                  toolSteps: [
                    ...message.toolSteps.map((step) =>
                    step.status === 'running' ? { ...step, status: 'cancelled' as const } : step,
                    ),
                    ...deferredToolFailures.map((item) => item.step),
                  ],
              }
              : null),
            // 残影根治：错误收尾把 content 换成报错行后，流式沉淀的中途 choices 卡仍留在
            // blocks 里渲染在气泡末尾，看起来像小T停下来在等选择。凡围栏后面还有正文的
            // （= 小T 已继续推进）标过期灰态；真正停在提问上的（围栏在全文末尾）保持可点。
            ...(Array.isArray(message.blocks) && message.blocks.length
              ? { blocks: supersedeStaleChoices(message.blocks, streamedReply) }
              : null),
          })),
        )
      }
    } finally {
      const settledTransportTurnId = String(acceptedTransportTurnId || '').trim()
      const settledAssistantMessageId = settledTransportTurnId
        ? buildRecoveredChatMessageIds(settledTransportTurnId).assistantMessageId
        : pendingId
      const ownsCurrentTurn = !acceptedTransportTurnId
        || !activePublicTurnIdRef.current
        || activePublicTurnIdRef.current === acceptedTransportTurnId
      if (ownsCurrentTurn) {
        activeStreamInterruptRef.current = null
        activePendingIdRef.current = ''
        activePublicTurnIdRef.current = ''
        setActivePublicTurnId('')
        setSending(false)
        setAgentExecutionAccepted(false)
      }
      // A provider can emit a partial result (or close after content) while the
      // durable turn has already reached succeeded. The transport finalizer
      // must not leave the truncated local bubble authoritative. Re-read the
      // exact accepted turn once after cleanup and replace only that turn's
      // assistant message with the durable terminal response. This remains a
      // structural turn-id/state reconciliation; prompt prose is not inspected.
      if (settledTransportTurnId) {
        const reconcileSettledTransportTurn = async () => {
          // The result event and the durable status projection are written by
          // separate layers. Give the status projection a few short windows
          // to become visible instead of treating the first stale snapshot as
          // authoritative and leaving a partial streamed bubble on screen.
          for (let attempt = 0; attempt < 4; attempt += 1) {
            const snapshot = await refreshChatTurnStatus()
            if (snapshot?.turn?.turnId === settledTransportTurnId) {
              if (
                activePublicTurnIdRef.current
                && activePublicTurnIdRef.current !== settledTransportTurnId
              ) return
              if (shouldReconcileLocalTurnFromDurableStatus({
                activeTurnId: settledTransportTurnId,
                snapshot,
              })) {
                const terminalText = resolveRecoveredChatTurnTerminalText(snapshot.turn)
                if (!terminalText) return
                const terminalTurn = snapshot.turn
                reconcileLiveChatTurnStatus(snapshot)
                setMessages((current) => patchChatMessageById(
                  current,
                  settledAssistantMessageId,
                  (message) => ({
                    ...message,
                    content: terminalText,
                    ts: formatNowTime(),
                    phase: 'final',
                    kind: terminalChatMessageKind(terminalTurn.logicalTaskState.status),
                    logicalTaskStatus: terminalTurn.logicalTaskState.status,
                  }),
                ))
                return
              }
            }
            if (attempt < 3) {
              await new Promise<void>((resolve) => window.setTimeout(resolve, 750))
            }
          }
        }
        void reconcileSettledTransportTurn().catch(() => undefined)
      } else {
        void refreshChatTurnStatus()
      }
    }
  }, [activeSkill, agentSkills, aiChatWatchAssetsEnabled, animateAssistantReply, chatModelsError, chatModelsLoading, chatSessionBaseKey, chatSessionLane, chatTurnChecking, chatTurnSnapshot, chatTurnStatusError, completeLiveChatRun, creativePhase, currentChapterCreativeOverride, currentFlowId, currentProjectId, currentProjectName, currentTurnActive, directorChatScopeNodeId, draft, effectiveChatSessionKey, enqueueRunningMessage, failLiveChatRun, forcedAgentRole, implicitSendRequest, messages, mode, recordLiveChatRunEvent, recoveredActiveTurn, refreshChatTurnStatus, replicateTargetImage, selectedCanvasNodeContext, selectedChatModelOption, selectedChatModelRequest, selectedChatModelValue, sending, startLiveChatRun])

  const submitToSelectedTarget = React.useCallback(async () => {
    if (codexDispatch.target === 'agents') {
      if (submissionPreparingRef.current) return
      submissionPreparingRef.current = true
      setSubmissionPreparing(true)
      try {
        await send({ origin: 'composer' })
      } finally {
        submissionPreparingRef.current = false
        setSubmissionPreparing(false)
      }
      return
    }
    const goal = String(draft || '').trim()
    if (!goal) return
    if (!sessionScopeProjectId) {
      toast('请先进入一个真实项目画布再派发给 Codex', 'error')
      return
    }
    let persistedCanvasScope: PersistedCodexCanvasScope
    try {
      persistedCanvasScope = await persistCodexCanvasBeforeDispatch({
        flowId: sessionScopeFlowId || null,
        chapterId: sessionScopeChapterId || null,
      })
    } catch (error: unknown) {
      toast(
        error instanceof Error
          ? `无法同步当前画布：${error.message}`
          : '无法同步当前画布，Codex 派发已停止',
        'error',
      )
      return
    }
    const selection = readCodexCanvasSelection()
    try {
      const submission = await codexDispatch.dispatch(goal, {
        projectId: sessionScopeProjectId,
        flowId: persistedCanvasScope.flowId,
        chapterId: persistedCanvasScope.chapterId,
        canvasRevision: persistedCanvasScope.canvasRevision,
        selectedNodeIds: selection.selectedNodeIds,
      })
      setDraft((current) => String(current || '').trim() === goal ? '' : current)
      toast(
        submission.kind === 'steering'
          ? '补充消息已进入持久队列，等待 Bridge 送达当前 Codex 回合'
          : submission.task.turnSequence > 1
            ? '已发送给同一 Codex 会话的下一回合'
            : `已发送给 Codex：${submission.task.workspaceId}`,
        'success',
      )
    } catch (error: unknown) {
      toast(
        error instanceof Error ? error.message : 'Codex 任务派发失败',
        'error',
      )
    }
  }, [
    codexDispatch,
    draft,
    send,
    sessionScopeChapterId,
    sessionScopeFlowId,
    sessionScopeProjectId,
    submissionPreparing,
  ])

  // 外部（画布「打组→视频编排」等）通过 chatCommandStore 派发内部执行正文；聊天气泡、
  // 持久会话与恢复状态只使用 displayText，避免把机器合同作为用户消息展示。
  React.useEffect(() => {
    const run = (cmd: ChatSendCommand | null) => {
      if (!cmd) return
      if (cmd.freshConversation) {
        // This effect is declared before the UI callback that backs the
        // toolbar's "new conversation" button. Keep the production reset
        // local here so one-click film dispatch cannot hit a TDZ during the
        // first render. A new conversation id also creates a fresh server
        // session and prevents old runs/BeatSheets from being reused.
        revokeCurrentTurnForConversationReset()
        invalidateChatTurnRecovery()
        clearCreationSession()
        const freshBaseKey = conversationScopeKey ? '' : createChatSessionBaseKey()
        freshConversationBaseKeyRef.current = conversationScopeKey ? null : freshBaseKey
        if (!conversationScopeKey) {
          pendingOwnedConversationScopeRef.current = getChatSessionConversationScope(
            buildEffectiveChatSessionKey({
              persistedBaseKey: freshBaseKey,
              projectId: sessionScopeProjectId,
              flowId: sessionScopeFlowId,
              canvasId: sessionScopeFlowId,
              chapterId: sessionScopeChapterId,
              lane: 'general',
              skillId: activeSkill?.id ?? null,
            }),
          )
          persistChatSessionBaseKey(freshBaseKey)
        } else {
          persistScopedChatSessionBaseKey(conversationScopeKey, '')
          resetSessionOnNextSendRef.current = true
        }
        if (!conversationScopeKey) resetSessionOnNextSendRef.current = false
        useSseChatStore.getState().clear(effectiveChatSessionKey)
        setChatSessionBaseKey(freshBaseKey)
        setChatSessionLane('general')
        setDraft('')
        setMessages([])
        setSessionTitle('')
        conversationIdRef.current = crypto.randomUUID()
      }
      setBubbleVisualState('panel')
      setMode((m) => (m === 'compact' ? 'expanded' : m))
      void send({
        text: cmd.text,
        freshConversation: cmd.freshConversation === true,
        ...(cmd.displayText ? { displayText: cmd.displayText } : {}),
        ...(cmd.requiredSkills ? { requiredSkills: cmd.requiredSkills } : {}),
		...(cmd.executionToolPolicy
			? {
				executionToolPolicy: {
					mode: cmd.executionToolPolicy.mode,
					allowedTools: [...cmd.executionToolPolicy.allowedTools],
				},
			}
			: {}),
		...(cmd.canvasNodeId ? { canvasNodeId: cmd.canvasNodeId } : {}),
        ...(cmd.forcedAgentRole ? { forcedAgentRole: cmd.forcedAgentRole } : {}),
        ...(cmd.allowedSubagentTypes?.length
          ? { allowedSubagentTypes: [...cmd.allowedSubagentTypes] }
          : {}),
        ...(cmd.requireAgentsTeamExecution === true
          ? { requireAgentsTeamExecution: true }
          : {}),
        ...(cmd.workflowKey ? { workflowKey: cmd.workflowKey } : {}),
        ...(cmd.requestedWorkflowExecutionVariant
          ? { requestedWorkflowExecutionVariant: cmd.requestedWorkflowExecutionVariant }
          : {}),
        attachCanvasContext: cmd.attachCanvasContext ?? true,
      })
      freshConversationBaseKeyRef.current = null
    }
    const consumeAndRun = () => {
      const pending = useChatCommandStore.getState().pending
      // One dialog owns one live SSE renderer. Keep an explicitly fresh task
      // queued until that local transport closes; never reinterpret it as a
      // follow-up of the previous logical task.
      if (pending?.freshConversation === true && sending) return
      // 中断确认期间不消费画布命令：send() 的 currentTurnActive 含 interruptingChatTurn，
      // 此刻消费会把它静默排进「正在被取消的回合」的 follow_up 队列（#6）。
      // 中断落定后本 effect 重跑（deps 含 interruptingChatTurn）再消费执行。
      if (interruptingChatTurn) return
      run(useChatCommandStore.getState().consume())
    }
    consumeAndRun()
    const unsub = useChatCommandStore.subscribe((s) => {
      if (s.pending) consumeAndRun()
    })
    return unsub
  }, [clearCreationSession, interruptingChatTurn, invalidateChatTurnRecovery, revokeCurrentTurnForConversationReset, send, sending])

  // 把「回合在飞」状态同步给选项卡等对话外组件（DataCardViews 据此提示"点选后排队发送"）。
  React.useEffect(() => {
    useChatCommandStore.getState().setBusy(currentTurnActive)
  }, [currentTurnActive])

  // 写 base：有项目作用域时只写该作用域的槽位（旋转不传染其他项目/章节）；
  // 无作用域（首页）回落到全局遗留单值。
  const applyChatSessionBaseKey = React.useCallback((nextBase: string) => {
    const canonicalBase = conversationScopeKey ? '' : nextBase
    if (conversationScopeKey) {
      persistScopedChatSessionBaseKey(conversationScopeKey, canonicalBase)
    } else {
      persistChatSessionBaseKey(canonicalBase)
    }
    setChatSessionBaseKey(canonicalBase)
  }, [conversationScopeKey])

  const resetConversationState = React.useCallback((nextSkill: ChatSkillReference | null) => {
    historyLoadVersionRef.current += 1
    revokeCurrentTurnForConversationReset()
    invalidateChatTurnRecovery()
    clearCreationSession()
    conversationResetPendingRef.current = true
    setConversationResetPending(true)
    setActiveSkill(nextSkill)
    setChatSessionLane('general')
    setDraft('')
    setMessages([])
    setSessionTitle('')
    setReplicateTargetImage('')
    conversationIdRef.current = crypto.randomUUID()
    if (conversationScopeKey) {
      resetSessionOnNextSendRef.current = true
      persistScopedChatSessionBaseKey(conversationScopeKey, '')
      setChatSessionBaseKey('')
    } else {
      applyChatSessionBaseKey(createChatSessionBaseKey())
    }
    useSseChatStore.getState().clear(effectiveChatSessionKey)
    if (mode === 'compact') setMode('expanded')
  }, [applyChatSessionBaseKey, clearCreationSession, conversationScopeKey, effectiveChatSessionKey, invalidateChatTurnRecovery, mode, revokeCurrentTurnForConversationReset])

  const selectSkillById = React.useCallback((skillId: string) => {
    const id = String(skillId || '').trim()
    if (!id) return
    const skill = agentSkills.find((item) => item.id === id)
    if (!skill) {
      toast('暂无可用 Skill（请在后台设置为可见）', 'error')
      void reloadAgentSkill()
      return
    }

    const nextSkill = activeSkill?.id === id ? null : skill
    resetConversationState(nextSkill)
  }, [activeSkill?.id, agentSkills, reloadAgentSkill, resetConversationState])

  const addMessageToCanvas = React.useCallback((messageId: string, content: string) => {
    const text = stripAssistantMetaTail(String(content || '').trim())
    if (!text) return
    const title = text.replace(/\n[\s\S]*/s, '').slice(0, 20) || '故事片段'
    const chapterCtx = typeof window !== 'undefined'
      ? (window as Window & { __TAPCANVAS_CURRENT_CHAPTER__?: { projectId?: string; bookId?: string; chapterId?: string } }).__TAPCANVAS_CURRENT_CHAPTER__
      : undefined
    useRFStore.getState().addNode('taskNode', title, {
      kind: 'text',
      prompt: text,
      ...(chapterCtx?.chapterId ? { chapterId: chapterCtx.chapterId } : {}),
      ...(chapterCtx?.bookId ? { bookId: chapterCtx.bookId } : {}),
    })
    setCanvasedMessageIds((prev) => new Set([...prev, messageId]))
    const projectId = useUIStore.getState().currentProject?.id
    if (projectId) {
      void createMaterialAsset({
        projectId,
        kind: 'text',
        name: title,
        initialData: {
          content: text,
          ...(chapterCtx?.chapterId ? { chapterId: chapterCtx.chapterId } : {}),
          ...(chapterCtx?.bookId ? { bookId: chapterCtx.bookId } : {}),
        },
      }).catch(() => {})
    }
  }, [])

  const handleChoiceSubmit = React.useCallback((response: { requestId: string; answers: PendingUserInputAnswer[] }) => {
    pendingUserInputAnswerRef.current = response
    const answerSummary = response.answers.map((answer) => answer.optionLabel).join('；')
    void send({ text: answerSummary })
  }, [send])

  const confirmBrief = React.useCallback(async (briefContent: string) => {
    if (briefConfirmationPending) return
    const projectId = sessionScopeProjectId
    const normalizedBrief = String(briefContent || '').trim()
    if (!projectId) {
      toast('请先进入项目再确认创作简报', 'error')
      return
    }
    if (!normalizedBrief) {
      toast('创作简报正文为空，无法确认', 'error')
      return
    }

    setBriefConfirmationPending(true)
    let briefSaved = false
    let confirmationSaved = false
    try {
      await updateProjectWorkspaceContextFile({
        projectId,
        fileName: 'CREATIVE_BRIEF.md',
        content: normalizedBrief,
      })
      briefSaved = true

      const memoryWrite = await writeMemoryEntries([{
        scopeType: 'project',
        scopeId: projectId,
        memoryType: 'domain_fact',
        title: 'creative-brief-confirmed',
        summaryText: '创作简报已确认，可进入后续创作',
        content: { confirmed: true, confirmedAt: new Date().toISOString() },
        sourceKind: 'user_input',
        tags: [CREATIVE_BRIEF_CONFIRMED_TAG],
        importance: 0.9,
      }])
      if (!memoryWrite.success || memoryWrite.items.length !== 1) {
        throw new Error('确认状态写入返回了无效结果')
      }
      confirmationSaved = true

      setCachedCreativePhase(projectId, 'writing')
      setCreativePhase('writing')
      await send({ text: '创作简报已确认。', creativePhaseOverride: 'writing' })
      toast('创作简报已保存并确认', 'success')
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : '未知错误'
      toast(
        confirmationSaved
          ? `创作简报已保存并确认，但继续请求发送失败：${reason}`
          : briefSaved
          ? `创作简报已保存，但确认状态写入失败：${reason}`
          : `创作简报确认失败：${reason}`,
        'error',
      )
    } finally {
      setBriefConfirmationPending(false)
    }
  }, [briefConfirmationPending, send, sessionScopeProjectId])

  const restartPrep = React.useCallback(() => {
    setCachedCreativePhase(currentProjectId || null, 'prep')
    setCreativePhase('prep')
    void send({ text: '我想重新规划创作方向，请重新引导我。' })
  }, [currentProjectId, send])

  // 切换项目时，先用 localStorage 快速恢复，再向服务端确认
  React.useEffect(() => {
    const pid = currentProjectId || null
    const cached = readCachedCreativePhase(pid)
    if (cached === 'writing') {
      setCreativePhase('writing')
      return
    }
    if (!pid) {
      setCreativePhase('prep')
      return
    }
    // 无缓存时查询服务端
    setCreativePhase('prep')
    void searchMemoryEntries({
      scopes: [{ scopeType: 'project', scopeId: pid }],
      tags: [CREATIVE_BRIEF_CONFIRMED_TAG],
      limit: 1,
    }).then((result) => {
      if (result.items.length > 0) {
        setCachedCreativePhase(pid, 'writing')
        setCreativePhase('writing')
      }
    }).catch(() => { /* ignore, stay in prep */ })
  }, [currentProjectId])


  // 从首页携带过来的挂起 prompt：进入画布后自动发送。
  // SPA 导航后 uiStore.currentProject 短暂滞留为上次打开的旧项目，
  // takeHomePendingPrompt 内部校验目标 projectId 一致才取走，防止旧项目抢跑消费、消息串进旧会话。
  const homePendingPromptConsumedRef = React.useRef(false)
  React.useEffect(() => {
    if (homePendingPromptConsumedRef.current) return
    if (!currentProjectId) return
    const pending = takeHomePendingPrompt(currentProjectId)
    if (pending == null) return
    homePendingPromptConsumedRef.current = true
    setTimeout(() => { void send({ text: pending.text, requiredSkills: pending.requiredSkills }) }, 800)
  }, [currentProjectId, send])

  React.useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId, sbaPath } = (e as CustomEvent<{ nodeId: string; sbaPath: string }>).detail
      if (!nodeId) return
      void send({ text: `[SBA_REWIND] nodeId=${nodeId} path=${sbaPath}` })
    }
    window.addEventListener('tc-sba-rewind', handler)
    return () => window.removeEventListener('tc-sba-rewind', handler)
  }, [send])

  const clearSkill = React.useCallback(() => {
    resetConversationState(null)
  }, [resetConversationState])

  const startNewConversation = React.useCallback(() => {
    historyLoadVersionRef.current += 1
    revokeCurrentTurnForConversationReset()
    invalidateChatTurnRecovery()
    clearCreationSession()
    conversationResetPendingRef.current = true
    setConversationResetPending(true)
    setChatSessionLane('general')
    setDraft('')
    setMessages([])
    setSessionTitle('')
    conversationIdRef.current = crypto.randomUUID()
    if (conversationScopeKey) {
      resetSessionOnNextSendRef.current = true
      persistScopedChatSessionBaseKey(conversationScopeKey, '')
      setChatSessionBaseKey('')
    } else {
      applyChatSessionBaseKey(createChatSessionBaseKey())
    }
    useSseChatStore.getState().clear(effectiveChatSessionKey)
    toast('已开启新对话', 'success')
  }, [applyChatSessionBaseKey, clearCreationSession, conversationScopeKey, effectiveChatSessionKey, invalidateChatTurnRecovery, revokeCurrentTurnForConversationReset])

  const handleHistoryMenuOpen = React.useCallback(async () => {
    // 用会话作用域（章节页 = project+chapter）而非滞后的 currentProject/currentFlow，
    // 否则章节页的历史菜单会拿 flow 前缀过滤、把章节会话全部漏掉。
    if (!sessionScopeProjectId) {
      setSessionHistory([])
      return
    }
    setHistoryLoading(true)
    try {
      const items = await listProjectChatSessions({
        projectId: sessionScopeProjectId,
        ...(sessionScopeChapterId
          ? { chapterId: sessionScopeChapterId }
          : sessionScopeFlowId
            ? { flowId: sessionScopeFlowId }
            : {}),
        limit: 15,
      })
      setSessionHistory(items)
    } catch (error: unknown) {
      setSessionHistory([])
      toast(`加载历史会话失败：${error instanceof Error ? error.message : '未知错误'}`, 'error')
    } finally {
      setHistoryLoading(false)
    }
  }, [sessionScopeProjectId, sessionScopeChapterId, sessionScopeFlowId])

  const closeArchivedConversation = React.useCallback(() => {
    archiveLoadVersionRef.current += 1
    setArchiveLoading(false)
    setArchivedConversation(null)
  }, [])

  const openHistorySession = React.useCallback(async (summary: ChatSessionSummaryDto) => {
    let selection
    try {
      selection = resolveChatHistorySelection({
        activeSessionKey: effectiveChatSessionKey,
        selectedSessionKey: summary.sessionKey,
      })
    } catch (error: unknown) {
      toast(error instanceof Error ? error.message : '历史会话标识无效', 'error')
      return
    }
    if (selection.mode === 'current') {
      closeArchivedConversation()
      return
    }

    const requestVersion = archiveLoadVersionRef.current + 1
    archiveLoadVersionRef.current = requestVersion
    setArchiveLoading(true)
    if (mode === 'compact') expandChat()
    try {
      const response = await getMemoryContext({
        sessionKey: selection.sessionKey,
        recentConversationLimit: 20,
        limitPerScope: 4,
      })
      if (archiveLoadVersionRef.current !== requestVersion) return
      const history = (Array.isArray(response.context.recentConversation)
        ? response.context.recentConversation
        : [])
        .map((item, index) => mapMemoryConversationItemToChatMessage(item, index))
        .filter((item): item is ChatMessage => Boolean(item))
      setArchivedConversation({
        sessionKey: selection.sessionKey,
        title: summary.firstUserMessage?.trim() || '历史会话',
        messages: history,
      })
    } catch (error: unknown) {
      if (archiveLoadVersionRef.current !== requestVersion) return
      toast(`读取历史会话失败：${error instanceof Error ? error.message : '未知错误'}`, 'error')
    } finally {
      if (archiveLoadVersionRef.current === requestVersion) setArchiveLoading(false)
    }
  }, [closeArchivedConversation, effectiveChatSessionKey, expandChat, mode])

  const authUser = useAuth((state) => state.user)
  const greetingName = String(authUser?.name || authUser?.login || '').trim()

  const inspirationQuickActions = React.useMemo<InspirationQuickAction[]>(() => {
    return buildChatInspirationQuickActions({
      currentProjectId,
      currentProjectName,
      hasFocusedReference: Boolean(selectedCanvasNodeContext?.nodeId || referenceImages.length > 0),
      selectedNodeLabel: selectedCanvasNodeContext?.label || null,
      selectedNodeKind: selectedCanvasNodeContext?.kind || null,
      hasStoryboardContext: Boolean(
        selectedCanvasNodeContext?.storyboardSelectionContext
        || selectedCanvasNodeContext?.bookId
        || selectedCanvasNodeContext?.chapterId
        || typeof selectedCanvasNodeContext?.shotNo === 'number',
      ),
    }, $).map((action) => ({
      ...action,
      skill: null,
    }))
  }, [
    currentProjectId,
    currentProjectName,
    referenceImages.length,
    selectedCanvasNodeContext?.bookId,
    selectedCanvasNodeContext?.chapterId,
    selectedCanvasNodeContext?.kind,
    selectedCanvasNodeContext?.label,
    selectedCanvasNodeContext?.nodeId,
    selectedCanvasNodeContext?.shotNo,
    selectedCanvasNodeContext?.storyboardSelectionContext,
  ])
  const contextQuickActions = React.useMemo(
    () => inspirationQuickActions.filter((action) => action.group === 'context'),
    [inspirationQuickActions],
  )
  const projectQuickActions = React.useMemo(
    () => inspirationQuickActions.filter((action) => action.group === 'project'),
    [inspirationQuickActions],
  )
  const starterQuickActions = React.useMemo(
    () => inspirationQuickActions.filter((action) => action.group === 'starter'),
    [inspirationQuickActions],
  )

  const isEmptyConversation = displayMessages.length === 0
  const headerStatusLabel = creativePhase === 'prep' ? $('规划中') : $('创作中')
  const headerTitle = isEmptyConversation ? $('新对话') : $('AI 对话')
  // 头部展示标题：优先用自动生成的会话标题，未生成时回落到默认标题。
  const displayHeaderTitle = archivedConversation ? '历史存档 · 只读' : sessionTitle || headerTitle
  // 底部「选项卡」：取最近一条 assistant 终稿携带的后续建议；用户已发出新消息后作废旧建议。
  const latestSuggestions = React.useMemo(() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const m = displayMessages[i]
      if (m.role === 'user') break
      if (m.role === 'assistant' && m.phase === 'final' && Array.isArray(m.suggestions) && m.suggestions.length > 0) {
        return m.suggestions.map((s) => coerceChoiceText(s)).filter((s) => s.length > 0)
      }
    }
    return [] as string[]
  }, [displayMessages])
  // 排队 Dock 数据：本浏览器已排队（m_user_queued_*）的逐条投影 + 服务端仍有、
  // 但前端无全文的排队条数（刷新/新窗口后）。pendingQueueCount 是权威计数：
  // 任意回合状态下，若本地条目多于服务端计数，多出的条目已按 FIFO 被消费（开始执行），
  // 不再当作「排队中」展示，避免陈旧条目常驻队列条（#14 样式错乱的近亲）。
  const queuedDockItems = React.useMemo<ChatQueuedItem[]>(() => displayMessages
    .filter((message) => message.role === 'user' && String(message.id || '').startsWith('m_user_queued_'))
    .map((message) => ({
      id: message.id,
      text: String(message.content || '').trim(),
      mode: message.queuedMode ?? 'follow_up',
    }))
    .filter((item) => item.text.length > 0), [displayMessages])
  const queuedServerTotal = Number.isInteger(chatTurnSnapshot?.turn?.pendingQueueCount)
    ? (chatTurnSnapshot?.turn?.pendingQueueCount ?? null)
    : null
  const queuedProjection = React.useMemo(
    () => projectChatQueue(queuedDockItems, queuedServerTotal),
    [queuedDockItems, queuedServerTotal],
  )
  const queuedDockItemsVisible = queuedProjection.pendingItems
  const queuedConsumedCount = queuedProjection.consumedCount
  const queuedServerOnlyCount = queuedProjection.serverOnlyCount
  // 后台 agent 回合活动：由 canvas-events SSE 的 agent-activity 驱动，断开/重连/重载后仍能恢复，
  // 解决"前台 turn 结束/浏览器断开后看不出后台还在不在跑、不知是否中断"的问题。
  const backgroundAgentActivity = useChatActivityStore((s) => s.active && s.projectId === sessionScopeProjectId)
  const backgroundAgentRoleName = useChatActivityStore((s) => s.projectId === sessionScopeProjectId ? s.roleName : null)
  const backgroundAgentActive = backgroundAgentActivity
  const backgroundAgentRole = backgroundAgentRoleName
  React.useEffect(() => {
    if (liveChatRunStatus !== 'waiting_external' || !liveChatRunId || scopedVideoRuns.length === 0) return
    setObservedAsyncChatRunId(liveChatRunId)
  }, [liveChatRunId, liveChatRunStatus, scopedVideoRuns.length])
  const displayVideoRuns = activeVideoRuns.length > 0 ? activeVideoRuns : scopedVideoRuns
  // 跨项目陈旧 liveRun 泄漏（#13）：liveChatRunStore.activeRun 是全局单值且持久化，
  // 项目 A 的 suspended 回合在切到项目 B（或刷新后落在 B）后，若不做作用域校验，
  // 进度卡会常驻「当前执行已挂起 / 后台任务已受理」。只有与当前会话作用域匹配的
  // liveRun 才有资格驱动进度视图。
  const liveChatRunInScope = Boolean(
    liveChatRunScope
    && String(liveChatRunScope.projectId || '') === String(sessionScopeProjectId || '')
    && String(liveChatRunScope.flowId || '') === String(sessionScopeFlowId || ''),
  )
  const scopedLiveRunStatus = liveChatRunInScope ? liveChatRunStatus : null
  const awaitingFirstVideoRunStatus = shouldAwaitFirstVideoRunStatus({
    liveRunStatus: scopedLiveRunStatus,
    liveRunReason: liveChatRunInScope ? (liveChatRunScope?.doneReason ?? null) : null,
    liveRunId: liveChatRunInScope ? liveChatRunId : '',
    observedLiveRunId: observedAsyncChatRunId,
    liveRunFinishedAt: liveChatRunInScope ? (liveChatRunScope?.finishedAt ?? null) : null,
    snapshotAppliedAt: videoRunSnapshotAppliedAt,
  })
  const productionWorkflowNodeId = React.useMemo(
    () => resolveVideoProductionWorkflowNode(displayVideoRuns, awaitingFirstVideoRunStatus),
    [awaitingFirstVideoRunStatus, displayVideoRuns],
  )
  const productionProgressView = React.useMemo(
    () => resolvePhysicalExecutionProgress(
      resolveAsyncArtifactProgress(liveChatAsyncArtifacts) ?? resolveAsyncProductionProgress(
        displayVideoRuns,
        awaitingFirstVideoRunStatus,
      ),
      {
        liveRunStatus: scopedLiveRunStatus,
        hasActiveExecutionEvidence: sending
          || Boolean(recoveredActiveTurn)
          || backgroundAgentActive
          || liveChatAsyncArtifacts.some((artifact) => artifact.status === 'running' || artifact.status === 'queued'),
        requiresAgentContinuation: displayVideoRuns.some((run) => run.state === 'collecting' && Boolean(run.authoringState)),
        failureMessage: liveChatRunInScope ? (liveChatRunScope?.errorMessage ?? undefined) : undefined,
      },
    ),
    [
      displayVideoRuns,
      awaitingFirstVideoRunStatus,
      backgroundAgentActive,
      liveChatAsyncArtifacts,
      liveChatRunInScope,
      liveChatRunScope?.errorMessage,
      scopedLiveRunStatus,
      recoveredActiveTurn,
      sending,
    ],
  )
  const productionActive = activeVideoRuns.length > 0
    || liveChatAsyncArtifacts.some((artifact) => artifact.status === 'accepted' || artifact.status === 'queued' || artifact.status === 'running')
  React.useEffect(() => {
    // 新任务重新出现真实活跃证据时，允许新的进度卡再次展示；关闭只作用于当前已结束结果。
    if (productionActive) setTerminalProductionProgressDismissed(false)
  }, [productionActive])
  React.useEffect(() => {
    // 切换项目/章节后，不能把上一个作用域的“已关闭”状态带到新作用域。
    setTerminalProductionProgressDismissed(false)
  }, [sessionScopeChapterId, sessionScopeFlowId, sessionScopeProjectId])
  React.useEffect(() => {
    // 成功和失败都是后台生产的终态。短暂展示结果后自动收起，避免已结束的
    // 卡片继续占据聊天区或让用户误以为计时仍在推进。暂停/等待输入不是终态，
    // 必须继续保留，直到用户处理或手动关闭。
    if (
      productionActive
      || !shouldAutoDismissAsyncProductionProgress(productionProgressView)
    ) return
    const timer = window.setTimeout(
      () => setTerminalProductionProgressDismissed(true),
      TERMINAL_PRODUCTION_PROGRESS_AUTO_DISMISS_MS,
    )
    return () => window.clearTimeout(timer)
  }, [
    productionActive,
    productionProgressView?.detail,
    productionProgressView?.label,
    productionProgressView?.tone,
  ])
  const presentedProductionProgressView = terminalProductionProgressDismissed && !productionActive
    ? null
    : productionProgressView
  const dismissTerminalProductionProgress = React.useCallback(() => {
    if (!productionActive) setTerminalProductionProgressDismissed(true)
  }, [productionActive])
  const stopVideoProduction = React.useCallback(
    () => cancelCurrentCanvasVideoProduction(),
    [cancelCurrentCanvasVideoProduction],
  )
  const headerSubtitle = React.useMemo(() => {
    if (interruptingChatTurn) return $('正在确认中断当前任务')
    if (sending) return $('正在处理当前请求')
    if (submissionPreparing) return $('正在校验并提交请求')
    if (chatTurnStatusDiagnostic) return `任务状态同步暂时不可用：${chatTurnStatusDiagnostic.message}`
    if (recoveredActiveTurn) {
      return formatRecoveredChatTurnSummary(
        recoveredActiveTurn.lastConfirmedSummary,
        recoveredActiveTurn.pendingQueueCount,
      )
    }
    if (chatTurnStateUncertain) return $('上一次执行状态不确定，需要刷新确认')
    if (productionActive && presentedProductionProgressView) return presentedProductionProgressView.detail
    if (backgroundAgentActive) {
      return backgroundAgentRole
        ? $(`后台进行中：${backgroundAgentRole} 正在工作…`)
        : $('后台任务进行中…')
    }
    if (isEmptyConversation) return $('从一句创意开始，先整理思路，再决定执行方式')
    return $('继续基于当前画布与项目上下文协作')
  }, [backgroundAgentActive, backgroundAgentRole, chatTurnStateUncertain, chatTurnStatusDiagnostic, interruptingChatTurn, isEmptyConversation, presentedProductionProgressView, productionActive, recoveredActiveTurn, sending, submissionPreparing])

  const runQuickPreset = React.useCallback(async (preset: {
    prompt: string
    skill: ChatSkillReference | null
    group: ChatQuickActionPreset['group']
  }) => {
    const nextSkill = preset.skill
    resetConversationState(nextSkill)
    await send({
      text: preset.prompt,
      skill: nextSkill,
      attachCanvasContext: preset.group === 'context',
    })
  }, [resetConversationState, send])

  const onRootKeyDownCapture = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    if (mode === 'maximized') {
      e.preventDefault()
      e.stopPropagation()
      toggleMaximized()
    }
  }, [mode, toggleMaximized])

  const onRootKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (mode !== 'maximized') return
    e.stopPropagation()
  }, [mode])

  const rootClassName = [
    'tc-ai-chat',
    `tc-ai-chat--${mode}`,
    dockRight ? 'tc-ai-chat--dock-right' : '',
    // 收起态的旧右下浮标整体隐藏：导演小T是唯一可见的对话入口。
    showDockedBubble ? 'tc-ai-chat--launcher-hidden' : '',
    className,
  ].filter(Boolean).join(' ')

  const auraClassName = [
    'tc-ai-chat__aura',
    mode === 'compact' ? 'tc-ai-chat__aura--compact' : '',
    mode === 'maximized' ? 'tc-ai-chat__aura--maximized' : '',
  ].filter(Boolean).join(' ')
  const composerShellClassName = [
    'tc-ai-chat__composer-shell',
    referenceImages.length > 0 ? 'tc-ai-chat__composer-shell--with-refs' : '',
  ].filter(Boolean).join(' ')

  const attachMenu = (
    <Menu className="tc-ai-chat__attach-menu" position="top-start" zIndex={10050}>
      <Menu.Target>
        <AttachMenuTarget tooltip={$('添加参考图或文本文件（可直接拖进输入框）')} />
      </Menu.Target>
      <Menu.Dropdown className="tc-ai-chat__attach-dropdown">
        <Menu.Label className="tc-ai-chat__attach-label">{$('文本')}</Menu.Label>
        <Menu.Item
          className="tc-ai-chat__attach-item"
          leftSection={<IconFileText className="tc-ai-chat__attach-item-icon" size={16} />}
          onClick={() => textFileInputRef.current?.click()}
          disabled={currentTurnActive || importingText}
        >
          {$('上传文本（txt/md/docx）')}
        </Menu.Item>
        <Menu.Divider className="tc-ai-chat__attach-divider" />
        <Menu.Label className="tc-ai-chat__attach-label">{$('参考图')}</Menu.Label>
        <Menu.Item
          className="tc-ai-chat__attach-item"
          leftSection={<IconPhoto className="tc-ai-chat__attach-item-icon" size={16} />}
          onClick={() => void addSelectedCanvasImagesAsReferences()}
          disabled={currentTurnActive || refsLoading}
        >
          {$('使用画布选中图片')}
        </Menu.Item>
        <Menu.Item
          className="tc-ai-chat__attach-item"
          leftSection={<IconUpload className="tc-ai-chat__attach-item-icon" size={16} />}
          onClick={() => fileInputRef.current?.click()}
          disabled={currentTurnActive || refsLoading}
        >
          {$('上传参考图')}
        </Menu.Item>
        <Menu.Divider className="tc-ai-chat__attach-divider" />
        <Menu.Item
          className="tc-ai-chat__attach-item"
          leftSection={<IconTrash className="tc-ai-chat__attach-item-icon" size={16} />}
          onClick={clearReferenceImages}
          disabled={currentTurnActive || refsLoading || referenceImages.length === 0}
        >
          {$('清空参考图')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  )

  // 全局生成偏好：生图模型/视频模型/规格，弹窗设置，服务端持久化（小T 上下文注入生效）。
  const generationPrefsControl = (
    <Tooltip className="tc-ai-chat__tooltip" label={$('生成偏好（生图/视频模型与规格）')} withArrow>
      <ActionIcon
        className="tc-ai-chat__attach"
        variant="subtle"
        aria-label="生成偏好"
        onClick={() => setGenPrefsOpened(true)}
      >
        <IconPhotoCog className="tc-ai-chat__attach-icon" size={16} />
      </ActionIcon>
    </Tooltip>
  )

  const skillLibraryControl = (
    <SkillPickerPopover
      selectionMode="single"
      activeSkill={activeSkill}
      disabled={currentTurnActive}
      error={skillLibrary.error}
      loading={skillLibrary.loading}
      skills={agentSkills}
      onManage={() => setSkillLibraryOpen(true)}
      onRefresh={reloadAgentSkill}
      onSelect={selectSkillById}
    />
  )

  // 语音输入麦克风按钮：录音中变红，点击开始/停止；识别文本实时回填输入框。
  const voiceInputControl = (
    <Tooltip
      className="tc-ai-chat__tooltip"
      label={voiceInput.isListening ? $('停止语音输入') : $('语音输入')}
      withArrow
    >
      <ActionIcon
        className="tc-ai-chat__attach"
        variant="subtle"
        color={voiceInput.isListening ? 'red' : undefined}
        aria-label="语音输入"
        onClick={voiceInput.toggle}
        disabled={currentTurnActive}
      >
        {voiceInput.isListening ? (
          <IconMicrophoneOff className="tc-ai-chat__attach-icon" size={16} />
        ) : (
          <IconMicrophone className="tc-ai-chat__attach-icon" size={16} />
        )}
      </ActionIcon>
    </Tooltip>
  )

  // 智能团花名册 + 手动指派：查看小T与四个子 agent，可手动选「本轮由谁干活」。
  const forcedRole = getTeamRole(forcedAgentRole)
  const teamRosterControl = (
    <Popover
      opened={rosterOpened}
      onChange={setRosterOpened}
      position="top-start"
      width={300}
      withArrow
      shadow="md"
      zIndex={10050}
    >
      <Popover.Target>
        <Tooltip className="tc-ai-chat__tooltip" label={$('智能团')} withArrow>
          <ActionIcon
            className={`tc-ai-chat__team-btn${forcedRole?.assignable ? ' tc-ai-chat__team-btn--active' : ''}`}
            variant="subtle"
            aria-label="智能团"
            onClick={() => setRosterOpened((v) => !v)}
          >
            {forcedRole?.assignable ? (
              <img className="tc-ai-chat__team-btn-avatar" src={forcedRole.avatar} alt={forcedRole.name} />
            ) : (
              <IconUsersGroup size={18} />
            )}
          </ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown className="tc-ai-chat__roster">
        <div className="tc-ai-chat__roster-head">
          <img className="tc-ai-chat__roster-lead-avatar" src={XIAOT_ROLE.avatar} alt={XIAOT_ROLE.name} />
          <div className="tc-ai-chat__roster-lead-meta">
            <Text className="tc-ai-chat__roster-lead-name" fw={600} size="sm">{XIAOT_ROLE.name}</Text>
            <Text className="tc-ai-chat__roster-lead-desc" size="xs" c="dimmed">{XIAOT_ROLE.description}</Text>
          </div>
        </div>
        <Text className="tc-ai-chat__roster-section" size="xs" c="dimmed">{$('本轮由谁干活')}</Text>
        <button
          type="button"
          className={`tc-ai-chat__roster-item${!forcedRole?.assignable ? ' tc-ai-chat__roster-item--selected' : ''}`}
          onClick={() => { selectForcedRole(null); setRosterOpened(false) }}
        >
          <span className="tc-ai-chat__roster-auto-icon"><IconSparkles size={18} /></span>
          <span className="tc-ai-chat__roster-item-meta">
            <span className="tc-ai-chat__roster-item-name">{$('自动（小T 智能委派）')}</span>
            <span className="tc-ai-chat__roster-item-desc">{$('由小T按 SOP 自动分配最合适的角色')}</span>
          </span>
        </button>
        {TEAM_ROLES.map((role: TeamRole) => {
          const selected = forcedAgentRole === role.id
          return (
            <button
              key={role.id}
              type="button"
              className={`tc-ai-chat__roster-item${selected ? ' tc-ai-chat__roster-item--selected' : ''}`}
              style={selected ? { borderColor: role.accent } : undefined}
              onClick={() => { selectForcedRole(selected ? null : role.id); setRosterOpened(false) }}
            >
              <img className="tc-ai-chat__roster-item-avatar" src={role.avatar} alt={role.name} style={{ borderColor: role.accent }} />
              <span className="tc-ai-chat__roster-item-meta">
                <span className="tc-ai-chat__roster-item-name">{role.name}</span>
                <span className="tc-ai-chat__roster-item-desc">{role.description}</span>
              </span>
            </button>
          )
        })}
      </Popover.Dropdown>
    </Popover>
  )

  const selectedChatModelUnavailable = Boolean(
    selectedChatModelValue && !selectedChatModelOption && !chatModelsLoading && !chatModelsError,
  )
  const chatModelControlLabel = chatModelsError
    ? chatModelsError.message
    : chatModelsLoading
      ? $('正在加载对话模型')
      : selectedChatModelUnavailable
        ? $(`已选模型 ${selectedChatModelValue} 当前不可用，请重新选择`)
      : chatModelSelectData.length > 0
        ? $('选择本轮对话模型')
        : $('没有可用文本模型')
  const chatModelPlaceholder = chatModelsError
    ? $('模型加载失败')
    : chatModelsLoading
      ? $('加载模型…')
      : selectedChatModelUnavailable
        ? $('原模型已不可用，请重新选择')
      : chatModelSelectData.length > 0
        ? $('选择模型')
        : $('无可用模型')
  const chatModelControl = (
    <div className="tc-ai-chat__model-control">
      <Tooltip className="tc-ai-chat__tooltip" label={chatModelControlLabel} withArrow>
        <Select
          className="tc-ai-chat__model-select"
          classNames={{
            input: 'tc-ai-chat__model-select-input',
            dropdown: 'tc-ai-chat__model-select-dropdown',
            option: 'tc-ai-chat__model-select-option',
          }}
          data={chatModelSelectData}
          value={selectedChatModelOption ? selectedChatModelValue : null}
          onChange={selectChatModel}
          placeholder={chatModelPlaceholder}
          size="xs"
          variant="unstyled"
          allowDeselect={false}
          searchable
          disabled={currentTurnActive || chatModelsLoading || chatModelSelectData.length === 0}
          rightSection={<IconChevronDown className="tc-ai-chat__model-select-chevron" size={14} />}
          rightSectionPointerEvents="none"
          comboboxProps={{ zIndex: 10050 }}
        />
      </Tooltip>
      {chatModelsError ? (
        <Tooltip className="tc-ai-chat__tooltip" label={$('重新加载对话模型')} withArrow>
          <ActionIcon
            className="tc-ai-chat__model-retry"
            aria-label={$('重新加载对话模型')}
            color="red"
            variant="subtle"
            size="sm"
            disabled={currentTurnActive || chatModelsLoading}
            onClick={retryChatModels}
          >
            <IconRefresh className="tc-ai-chat__model-retry-icon" size={15} />
          </ActionIcon>
        </Tooltip>
      ) : null}
    </div>
  )

  return (
    <div
      className={rootClassName}
      data-ux-floating
      onWheelCapture={stopPanelWheelPropagation}
      onKeyDownCapture={onRootKeyDownCapture}
      onKeyDown={onRootKeyDown}
    >
      <input
        ref={fileInputRef}
        className="tc-ai-chat__file-input"
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => void onUploadReferenceFiles(e.currentTarget.files)}
      />
      <input
        ref={targetFileInputRef}
        className="tc-ai-chat__file-input tc-ai-chat__target-file-input"
        type="file"
        accept="image/*"
        onChange={(e) => void onUploadReplicateTargetFile(e.currentTarget.files)}
      />
      <input
        ref={textFileInputRef}
        className="tc-ai-chat__file-input"
        type="file"
        accept={SUPPORTED_TEXT_ACCEPT}
        multiple
        onChange={onPickTextFiles}
      />
      <GenerationPrefsModal opened={genPrefsOpened} onClose={() => setGenPrefsOpened(false)} />
      {skillLibraryOpen ? (
        <AppErrorBoundary title="技能库加载失败" onDismiss={() => setSkillLibraryOpen(false)}>
          <React.Suspense fallback={<div className="tc-skill-library-loading" aria-label="技能库加载中" />}>
            <SkillLibraryDialog
              opened
              onClose={() => setSkillLibraryOpen(false)}
              data={skillLibrary}
              selectedOfficialIds={activeSkill?.source === 'system' ? [activeSkill.id] : []}
              onToggleOfficial={(skill) => selectSkillById(skill.id)}
              selectionMode="single"
            />
          </React.Suspense>
        </AppErrorBoundary>
      ) : null}
      <Modal
        opened={replicatePickerOpened}
        onClose={() => setReplicatePickerOpened(false)}
        centered
        title={$('从画布中选择目标效果图')}
        size="lg"
      >
        <div className="tc-ai-chat__replicate-picker-grid">
          {canvasImageCandidates.map((item) => {
            const selected = replicateTargetImage === item.url
            return (
              <button
                key={`${item.id}_${item.url}`}
                type="button"
                className={`tc-ai-chat__replicate-picker-item${selected ? ' tc-ai-chat__replicate-picker-item--selected' : ''}`}
                onClick={() => void chooseReplicateTargetFromCanvas(item.url)}
              >
                <ManagedImage className="tc-ai-chat__replicate-picker-thumb" src={item.url} alt={item.label} />
                <span className="tc-ai-chat__replicate-picker-label">{item.label}</span>
              </button>
            )
          })}
        </div>
      </Modal>
      {isMaximized && (
        <div
          aria-hidden="true"
          className="tc-ai-chat__backdrop"
          onMouseDown={(e) => {
            e.preventDefault()
            toggleMaximized()
          }}
        />
      )}
      <div aria-hidden="true" className={auraClassName} />
      <Paper
        ref={cardRef}
        className={[
          'tc-ai-chat__card',
          showDockedBubble ? 'tc-ai-chat__card--bubble' : '',
        ].filter(Boolean).join(' ')}
        radius="sm"
        p={showDockedBubble ? 0 : isCompact ? 'sm' : 'md'}
      >
        {!showDockedBubble && (
          <button
            type="button"
            className="tc-ai-chat__handle"
            aria-label={$('展开对话')}
            title={$('点击展开')}
            onClick={expandChat}
          >
            <span className="tc-ai-chat__handle-pill" />
          </button>
        )}

        {isCompact ? (
          <>
            {showDockedBubble ? (
            <Tooltip className="tc-ai-chat__tooltip" label={currentTurnActive ? $('AI 对话中…点击展开') : presentedProductionProgressView ? `${presentedProductionProgressView.label}：${presentedProductionProgressView.detail}` : backgroundAgentActive ? $('后台任务进行中…点击展开') : $('展开 AI 对话')} withArrow position="left">
                <button
                  type="button"
                  className="tc-ai-chat__bubble-button"
                  aria-label={$('展开 AI 对话')}
                  onClick={expandChat}
                >
                  <span className="tc-ai-chat__bubble-core">
                    <IconMessageCircle className="tc-ai-chat__bubble-icon" size={24} />
                    {(currentTurnActive || backgroundAgentActive || productionActive) && <span className="tc-ai-chat__bubble-status" aria-hidden="true" />}
                  </span>
                </button>
              </Tooltip>
            ) : (
              <>
                <ReferenceImagesStrip
                  className="tc-ai-chat__refs--compact-corner"
                  urls={referenceImages}
                  onClear={clearReferenceImages}
                  disabled={currentTurnActive || refsLoading}
                />
                <Group
                  className="tc-ai-chat__compact-row"
                  justify="flex-end"
                  align="center"
                  gap={10}
                  wrap="nowrap"
                  mt={referenceImages.length > 0 ? 50 : 0}
                >
                  <div className={composerShellClassName}>
                    <ChatQueueDock
                      items={queuedDockItemsVisible}
                      serverOnlyCount={queuedServerOnlyCount}
                      consumedCount={queuedConsumedCount}
                      running={currentTurnActive}
                      compact
                    />
                    <PanelCard className="tc-ai-chat__compact-composer tc-ai-chat__composer" padding="compact">
                      <Group className="tc-ai-chat__composer-row" gap={10} align="center" wrap="nowrap">
                        <div className="tc-ai-chat__composer-tools">
                          {codexDispatch.target === 'agents' ? (
                            <div className="tc-ai-chat__agents-tools">
                              {attachMenu}
                              {skillLibraryControl}
                              {generationPrefsControl}
                              {voiceInputControl}
                              {teamRosterControl}
                              {chatModelControl}
                              {creativePhase === 'writing' ? (
                                <Button className="tc-ai-chat__restart-prep" size="xs" variant="subtle" color="dimmed" px={6} onClick={restartPrep} disabled={currentTurnActive}>
                                  重新规划
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>

                        <div className="tc-ai-chat__input-slot">
                          <Textarea
                            ref={compactInputRef}
                            className={`tc-ai-chat__input${dragOverInput ? ' tc-ai-chat__input--dragover' : ''}`}
                            autosize
                            minRows={1}
                            maxRows={4}
                            placeholder={
                              importingText
                                ? $('正在解析文本…')
                                : codexDispatch.target === 'codex'
                                  ? '描述要在本地 workspace 完成的产品目标'
                                  : currentTurnActive
                                    ? $('输入调整要求，再选择纠偏或续做')
                                    : chatTurnChecking
                                      ? $('正在确认当前任务状态…')
                                      : $('描述创意或需求，可拖入 txt/docx')
                            }
                            value={draft}
                            onChange={(e) => setDraft(e.currentTarget.value)}
                            onPaste={onPasteIntoInput}
                            onDrop={onDropIntoInput}
                            onDragOver={onDragOverInput}
                            onDragLeave={onDragLeaveInput}
                            onFocus={() => {
                              if (mode !== 'compact') return
                              setMode('expanded')
                            }}
                          />
                        </div>

                        <div className="tc-ai-chat__composer-actions">
                          {currentTurnActive && codexDispatch.target === 'agents' ? (
                            <Group className="tc-ai-chat__running-actions" gap={4} wrap="nowrap">
                              <Tooltip className="tc-ai-chat__tooltip" label="纠偏当前任务" withArrow>
                                <ActionIcon className="tc-ai-chat__send tc-ai-chat__send--steering" variant="light" aria-label="纠偏当前任务" onClick={() => void enqueueRunningMessage('steering')} disabled={!normalizedDraft || queueSubmitting || interruptingChatTurn}>
                                  <IconSend2 className="tc-ai-chat__send-icon" size={18} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip className="tc-ai-chat__tooltip" label="完成后续做" withArrow>
                                <ActionIcon className="tc-ai-chat__send tc-ai-chat__send--follow-up" variant="subtle" aria-label="完成后续做" onClick={() => void send({ origin: 'composer' })} disabled={!normalizedDraft || queueSubmitting || interruptingChatTurn}>
                                  <IconMessagePlus className="tc-ai-chat__send-icon" size={18} />
                                </ActionIcon>
                              </Tooltip>
                              <Tooltip className="tc-ai-chat__tooltip" label={confirmedActiveTurnId ? '中断当前任务' : '任务确认开始后可中断'} withArrow>
                                <ActionIcon className="tc-ai-chat__send tc-ai-chat__send--stop" variant="light" color="red" aria-label="中断当前任务" onClick={interruptActiveChat} disabled={interruptingChatTurn || !confirmedActiveTurnId}>
                                  <IconX className="tc-ai-chat__send-icon" size={18} />
                                </ActionIcon>
                              </Tooltip>
                            </Group>
                          ) : (
                            <Tooltip className="tc-ai-chat__tooltip" label={selectedTargetSendLabel} withArrow>
                              <ActionIcon className="tc-ai-chat__send" variant="light" aria-label={selectedTargetSendLabel} onClick={() => void submitToSelectedTarget()} disabled={!canSubmitToSelectedTarget}>
                                <IconSend2 className="tc-ai-chat__send-icon" size={18} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </div>
                      </Group>
                    </PanelCard>
                  </div>

                  <Group className="tc-ai-chat__compact-right" gap={6} align="center" wrap="nowrap">
                    <Tooltip className="tc-ai-chat__tooltip" label={$('开启新对话')} withArrow>
                      <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="开启新对话" onClick={startNewConversation}>
                        <IconMessagePlus className="tc-ai-chat__icon-svg" size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Menu position="bottom-end" width={280} withinPortal zIndex={10050} onOpen={handleHistoryMenuOpen}>
                      <Menu.Target>
                        <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="历史会话">
                          <IconHistory className="tc-ai-chat__icon-svg" size={16} />
                        </ActionIcon>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Label>历史会话</Menu.Label>
                        {historyLoading ? (
                          <Menu.Item disabled>加载中…</Menu.Item>
                        ) : sessionHistory.length === 0 ? (
                          <Menu.Item disabled>暂无历史会话</Menu.Item>
                        ) : sessionHistory.slice(0, 15).map((s) => (
                          <Menu.Item className="tc-ai-chat__history-item" key={s.sessionKey} onClick={() => void openHistorySession(s)}>
                            <Stack className="tc-ai-chat__history-item-content" gap={1}>
                              <Text className="tc-ai-chat__history-item-date" size="xs" c="dimmed">{formatSessionDate(s.updatedAt)}</Text>
                              <Text className="tc-ai-chat__history-item-title" size="xs" lineClamp={1}>{s.firstUserMessage || '(空会话)'}</Text>
                            </Stack>
                          </Menu.Item>
                        ))}
                      </Menu.Dropdown>
                    </Menu>
                    <Tooltip className="tc-ai-chat__tooltip" label={$('聚焦')} withArrow>
                      <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="聚焦" onClick={toggleMaximized}>
                        <IconArrowsMaximize className="tc-ai-chat__icon-svg" size={16} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip className="tc-ai-chat__tooltip" label={$('展开')} withArrow>
                      <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="展开" onClick={expandChat}>
                        <IconChevronLeft className="tc-ai-chat__icon-svg" size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </Group>
              </>
            )}
          </>
        ) : (
          <>
            <Group className="tc-ai-chat__header" justify="space-between" align="center" gap={10} wrap="nowrap">
              <div className="tc-ai-chat__header-left">
                <Text className="tc-ai-chat__header-title" lineClamp={1} title={displayHeaderTitle}>
                  {displayHeaderTitle}
                </Text>
              </div>
              <Group className="tc-ai-chat__header-right" gap={6} align="center" wrap="nowrap">
                <Tooltip className="tc-ai-chat__tooltip" label={$('开启新对话')} withArrow>
                  <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="开启新对话" onClick={startNewConversation}>
                    <IconMessagePlus className="tc-ai-chat__icon-svg" size={16} />
                  </ActionIcon>
                </Tooltip>
                <Menu position="bottom-end" width={280} withinPortal zIndex={10050} onOpen={handleHistoryMenuOpen}>
                  <Menu.Target>
                    <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="历史会话">
                      <IconHistory className="tc-ai-chat__icon-svg" size={16} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Label>历史会话</Menu.Label>
                    {historyLoading ? (
                      <Menu.Item disabled>加载中…</Menu.Item>
                    ) : sessionHistory.length === 0 ? (
                      <Menu.Item disabled>暂无历史会话</Menu.Item>
                    ) : sessionHistory.slice(0, 15).map((s) => (
                      <Menu.Item className="tc-ai-chat__history-item" key={s.sessionKey} onClick={() => void openHistorySession(s)}>
                        <Stack className="tc-ai-chat__history-item-content" gap={1}>
                          <Text className="tc-ai-chat__history-item-date" size="xs" c="dimmed">{formatSessionDate(s.updatedAt)}</Text>
                          <Text className="tc-ai-chat__history-item-title" size="xs" lineClamp={1}>{s.firstUserMessage || '(空会话)'}</Text>
                        </Stack>
                      </Menu.Item>
                    ))}
                  </Menu.Dropdown>
                </Menu>
                <Tooltip className="tc-ai-chat__tooltip" label={mode === 'maximized' ? $('退出聚焦') : $('聚焦')} withArrow>
                  <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label={mode === 'maximized' ? '退出聚焦' : '聚焦'} onClick={toggleMaximized}>
                    {mode === 'maximized' ? (
                      <IconArrowsMinimize className="tc-ai-chat__icon-svg" size={16} />
                    ) : (
                      <IconArrowsMaximize className="tc-ai-chat__icon-svg" size={16} />
                    )}
                  </ActionIcon>
                </Tooltip>
                {!isMaximized && (
                  <Tooltip className="tc-ai-chat__tooltip" label={$('收起')} withArrow>
                    <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="收起" onClick={collapseChat}>
                      <IconChevronRight className="tc-ai-chat__icon-svg" size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
                {isMaximized && (
                  <Tooltip className="tc-ai-chat__tooltip" label={$('关闭')} withArrow>
                    <ActionIcon className="tc-ai-chat__icon" variant="subtle" aria-label="关闭" onClick={collapseChat}>
                      <IconX className="tc-ai-chat__icon-svg" size={16} />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Group>
            </Group>

            {presentedProductionProgressView ? (
              <AsyncProductionProgress
                view={presentedProductionProgressView}
                taskStartedAtMs={liveChatRunInScope ? liveChatRunScope?.startedAt : undefined}
                taskFinishedAtMs={
                  liveChatRunInScope && (
                    recoveredActiveTurn
                    || sending
                    || liveChatRunScope?.status === 'active'
                    || liveChatRunScope?.status === 'waiting_external'
                    || liveChatRunScope?.status === 'waiting_input'
                  )
                    ? null
                    : (liveChatRunInScope ? liveChatRunScope?.finishedAt : undefined)
                }
                cancelling={cancellingVideoProduction}
                onCancel={productionActive && currentProjectId ? () => void stopVideoProduction() : undefined}
                onDismiss={dismissTerminalProductionProgress}
              />
            ) : null}

            <div className={['tc-ai-chat__body', isEmptyConversation ? 'tc-ai-chat__body--empty' : ''].filter(Boolean).join(' ')}>
              {archiveLoading ? (
                <Group className="tc-ai-chat__archive-bar" justify="space-between" align="center" wrap="nowrap">
                  <Text className="tc-ai-chat__archive-label" size="xs" c="dimmed">正在读取历史存档…</Text>
                  <ActionIcon className="tc-ai-chat__archive-close" variant="subtle" size="sm" aria-label="回到当前会话" onClick={closeArchivedConversation}>
                    <IconX className="tc-ai-chat__archive-close-icon" size={14} />
                  </ActionIcon>
                </Group>
              ) : archivedConversation ? (
                <Group className="tc-ai-chat__archive-bar" justify="space-between" align="center" wrap="nowrap">
                  <div className="tc-ai-chat__archive-copy">
                    <Text className="tc-ai-chat__archive-label" size="xs" fw={600}>历史存档 · 只读</Text>
                    <Text className="tc-ai-chat__archive-title" size="xs" c="dimmed" lineClamp={1}>{archivedConversation.title}</Text>
                  </div>
                  <Button className="tc-ai-chat__archive-return" variant="subtle" size="compact-xs" leftSection={<IconChevronLeft className="tc-ai-chat__archive-return-icon" size={13} />} onClick={closeArchivedConversation}>
                    回到当前会话
                  </Button>
                </Group>
              ) : null}
              {canShowHistory && (
                isEmptyConversation ? (
                  <ScrollArea className="tc-ai-chat__empty-scroll" type="auto" scrollbarSize={8}>
                    <div className="tc-ai-chat__empty-state">
                      <div className="tc-ai-chat__greeting">
                        <div className="tc-ai-chat__greeting-hi">
                          <TapCanvasMark className="tc-ai-chat__greeting-logo" size={30} />
                          <span>{greetingName ? `Hi ${greetingName}!` : 'Hi!'}</span>
                        </div>
                        <div className="tc-ai-chat__greeting-title">今天一起创作点什么？</div>
                      </div>
                      {inspirationQuickActions.length > 0 ? (
                        <div className="tc-ai-chat__starter-chips">
                          {[...contextQuickActions, ...projectQuickActions, ...starterQuickActions].slice(0, 4).map((action) => (
                            <button
                              key={action.key}
                              type="button"
                              className="tc-ai-chat__starter-chip"
                              disabled={currentTurnActive}
                              onClick={() => void runQuickPreset(action)}
                            >
                              {action.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="tc-sba-banner"
                        disabled={currentTurnActive}
                        onClick={() => void send({ text: '[SBA_START]' })}
                      >
                        <div className="tc-sba-banner__glow" aria-hidden="true" />
                        <div className="tc-sba-banner__content">
                          <span className="tc-sba-banner__icon" aria-hidden="true">✦</span>
                          <div className="tc-sba-banner__text">
                            <span className="tc-sba-banner__title">沉浸式故事板创作</span>
                            <span className="tc-sba-banner__desc">AI 实时为每个故事分支生成画面，你来掌控剧情走向</span>
                          </div>
                          <span className="tc-sba-banner__cta">体验一下</span>
                        </div>
                      </button>
                    </div>
                  </ScrollArea>
                ) : useScrollableHistory ? (
                  <ScrollArea className="tc-ai-chat__messages-scroll" viewportRef={viewportRef} type="auto" scrollbarSize={8}>
                    <Stack ref={messagesContentRef} className="tc-ai-chat__messages" gap={16}>
                      {displayMessages.map((message, idx) => {
                        const isLastAssistant = message.role === 'assistant' && idx === displayMessages.length - 1
                        return (
                          <ChatBubble
                            key={message.localKey ?? message.id}
                            message={message}
                            isCreativeMode
                            onConfirmBrief={!archivedConversation && creativePhase === 'prep' && isLastAssistant && message.source !== 'codex' ? confirmBrief : undefined}
                            confirmBriefPending={briefConfirmationPending}
                            onChoiceSubmit={!archivedConversation && message.pendingUserInput && isLastAssistant ? handleChoiceSubmit : undefined}
                          />
                        )
                      })}
                    </Stack>
                  </ScrollArea>
                ) : (
                  <Stack ref={messagesContentRef} className="tc-ai-chat__messages tc-ai-chat__messages--expanded" gap={10}>
                    {displayMessages.map((message, idx) => {
                      const isLastAssistant = message.role === 'assistant' && idx === displayMessages.length - 1
                      return (
                        <ChatBubble
                          key={message.localKey ?? message.id}
                          message={message}
                          isCreativeMode
                          onConfirmBrief={!archivedConversation && creativePhase === 'prep' && isLastAssistant && message.source !== 'codex' ? confirmBrief : undefined}
                          confirmBriefPending={briefConfirmationPending}
                          onChoiceSubmit={!archivedConversation && message.pendingUserInput && isLastAssistant ? handleChoiceSubmit : undefined}
                        />
                      )
                    })}
                  </Stack>
                )
              )}

            </div>

            <div className={composerShellClassName}>
              {archivedConversation ? (
                <PanelCard className="tc-ai-chat__archive-composer" padding="compact">
                  <Group className="tc-ai-chat__archive-composer-row" justify="space-between" align="center" wrap="nowrap">
                    <Text className="tc-ai-chat__archive-composer-text" size="xs" c="dimmed">历史存档不会进入小T当前上下文</Text>
                    <Button className="tc-ai-chat__archive-composer-return" variant="light" size="compact-xs" onClick={closeArchivedConversation}>继续当前会话</Button>
                  </Group>
                </PanelCard>
              ) : (
              <>
              {isCanvasChapterNodeKind(selectedCanvasNodeContext?.kind) && selectedCanvasNodeContext?.nodeId ? (
                <button
                  type="button"
                  className="tc-ai-chat__canvas-node-locate"
                  title="点击在画布上定位此节点"
                  onClick={() => {
                    const fn = (window as Window & { __tcFocusNode?: (id: string) => void }).__tcFocusNode
                    fn?.(selectedCanvasNodeContext.nodeId)
                  }}
                >
                  <IconMapPin size={11} />
                  <span className="tc-ai-chat__canvas-node-locate-label">{selectedCanvasNodeContext.label}</span>
                </button>
              ) : null}
              {latestSuggestions.length > 0 && !currentTurnActive ? (
                <div className="tc-ai-chat__suggestions-bar">
                  {latestSuggestions.map((text, idx) => (
                    <button
                      key={`bottom_sugg_${idx}`}
                      type="button"
                      className="tc-ai-suggestion-chip"
                      onClick={() => void send({ text })}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              ) : null}
              <ChatQueueDock
                items={queuedDockItemsVisible}
                serverOnlyCount={queuedServerOnlyCount}
                consumedCount={queuedConsumedCount}
                running={currentTurnActive}
              />
              <ReferenceImagesStrip urls={referenceImages} onClear={clearReferenceImages} disabled={currentTurnActive || refsLoading} />
              <PanelCard className="tc-ai-chat__composer" padding="compact">
                {showProjectTextMaterialHint ? (
                  <Text className="tc-ai-chat__creation-warning" size="xs" c="yellow" mb={8}>
                    当前项目检测到 {projectTextMaterialState.count} 个文本素材。AI 对话不会因此被拦截；如果你希望基于某一份文本继续，优先在消息里说明书名/章节，或先选中关联节点。
                  </Text>
                ) : null}
                {currentProjectId && projectTextMaterialState.status === 'failed' ? (
                  <Text className="tc-ai-chat__creation-warning" size="xs" c="red" mb={8}>
                    {projectTextMaterialState.error || '项目文本素材状态读取失败'}
                  </Text>
                ) : null}
                <Group className="tc-ai-chat__composer-row" gap={10} align="flex-end" wrap="nowrap">
                  <div className="tc-ai-chat__composer-tools">
                    {codexDispatch.target === 'agents' ? (
                      <div className="tc-ai-chat__agents-tools">
                        {attachMenu}
                        {skillLibraryControl}
                        {generationPrefsControl}
                        {voiceInputControl}
                        {teamRosterControl}
                        {chatModelControl}
                      </div>
                    ) : null}
                  </div>

                  <div className="tc-ai-chat__input-slot">
                    <Textarea
                      ref={expandedInputRef}
                      className={`tc-ai-chat__input${dragOverInput ? ' tc-ai-chat__input--dragover' : ''}`}
                      autosize
                      minRows={2}
                      maxRows={6}
                      placeholder={
                        importingText
                          ? $('正在解析文本…')
                          : codexDispatch.target === 'codex'
                            ? '描述要在本地 workspace 完成的真实页面、游戏或应用目标'
                            : currentTurnActive
                              ? $('输入调整要求，再选择纠偏或续做')
                              : chatTurnChecking
                                ? $('正在确认当前任务状态…')
                                : $('请输入你的设计需求，可拖入 txt/docx 文件')
                      }
                      value={draft}
                      onChange={(e) => setDraft(e.currentTarget.value)}
                      onPaste={onPasteIntoInput}
                      onDrop={onDropIntoInput}
                      onDragOver={onDragOverInput}
                      onDragLeave={onDragLeaveInput}
                    />
                  </div>

                  <div className="tc-ai-chat__composer-actions">
                    {currentTurnActive && codexDispatch.target === 'agents' ? (
                      <Group className="tc-ai-chat__running-actions" gap={4} wrap="nowrap">
                        <Tooltip className="tc-ai-chat__tooltip" label="纠偏当前任务：下一个思考边界生效" withArrow>
                          <ActionIcon className="tc-ai-chat__send tc-ai-chat__send--steering" variant="light" aria-label="纠偏当前任务" onClick={() => void enqueueRunningMessage('steering')} disabled={!normalizedDraft || queueSubmitting || interruptingChatTurn}>
                            <IconSend2 className="tc-ai-chat__send-icon" size={18} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip className="tc-ai-chat__tooltip" label="完成后续做：当前任务结束后执行" withArrow>
                          <ActionIcon className="tc-ai-chat__send tc-ai-chat__send--follow-up" variant="subtle" aria-label="完成后续做" onClick={() => void send({ origin: 'composer' })} disabled={!normalizedDraft || queueSubmitting || interruptingChatTurn}>
                            <IconMessagePlus className="tc-ai-chat__send-icon" size={18} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip className="tc-ai-chat__tooltip" label={confirmedActiveTurnId ? '中断小T执行；已受理的片段继续保留' : '任务确认开始后可中断'} withArrow>
                          <ActionIcon className="tc-ai-chat__send tc-ai-chat__send--stop" variant="light" color="gray" aria-label="中断小T执行" onClick={interruptActiveChat} disabled={interruptingChatTurn || !confirmedActiveTurnId}>
                            <IconPlayerStop className="tc-ai-chat__send-icon" size={18} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    ) : (
                      <Tooltip className="tc-ai-chat__tooltip" label={selectedTargetSendLabel} withArrow>
                        <ActionIcon className="tc-ai-chat__send" variant="light" aria-label={selectedTargetSendLabel} onClick={() => void submitToSelectedTarget()} disabled={!canSubmitToSelectedTarget}>
                          <IconSend2 className="tc-ai-chat__send-icon" size={18} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </div>
                </Group>

                <Group className="tc-ai-chat__hint" justify="flex-start" align="center" gap={10} mt={8} wrap="nowrap">
                  <Text className="tc-ai-chat__hint-text" size="xs" c="dimmed" lineClamp={1}>
                    {codexDispatch.target === 'codex'
                      ? codexDispatch.dispatching
                        ? '正在提交到持久队列；尚未宣称开始执行'
                        : codexDispatch.canDispatch
                          ? 'Codex 只编辑授权目录；测试、构建和预览默认在远程 Sandbox'
                          : '等待 Bridge / workspace 可用；单次只执行一个任务'
                      : submissionPreparing && !sending
                        ? '正在校验会话与模型目录，准备提交请求'
                      : chatTurnStatusDiagnostic
                        ? '状态同步暂不可用；发送时由服务端判定继续执行或持久排队'
                        : chatTurnStateUncertain
                          ? '上次任务未正常收尾，但当前已无执行进程；可发送新消息继续'
                          : currentTurnActive
                            ? interruptingChatTurn
                              ? '正在确认中断；在状态落定前不会启动新回合'
                              : sending && !agentExecutionAccepted
                                ? '请求已发送，等待执行器受理；尚未开始运行'
                                : recoveredActiveTurn
                                  ? formatRecoveredChatTurnSummary(
                                      recoveredActiveTurn.lastConfirmedSummary,
                                      recoveredActiveTurn.pendingQueueCount,
                                    )
                                  : '可继续发送调整要求'
                            : chatTurnChecking
                              ? '正在核对该会话的持久任务状态'
                              : $('仅支持点击发送，Enter 可换行')}
                  </Text>
                  {codexDispatch.target === 'agents' && (chatTurnStatusDiagnostic || chatTurnStateUncertain) ? (
                    <Tooltip className="tc-ai-chat__tooltip" label="重新读取任务状态" withArrow>
                      <ActionIcon
                        className="tc-ai-chat__status-refresh"
                        variant="subtle"
                        size="xs"
                        aria-label="重新读取任务状态"
                        onClick={() => void refreshChatTurnStatus()}
                        disabled={chatTurnChecking}
                      >
                        <IconRefresh className="tc-ai-chat__status-refresh-icon" size={14} />
                      </ActionIcon>
                    </Tooltip>
                  ) : null}
                </Group>
              </PanelCard>
              </>
              )}
            </div>
          </>
        )}
      </Paper>
    </div>
  )
}
