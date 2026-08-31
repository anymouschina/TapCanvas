import * as React from 'react'
import {
  ActionIcon,
  Button,
  Group,
  Select,
  Text,
  Textarea,
  Tooltip,
} from '@mantine/core'
import {
  IconBrandOpenai,
  IconCheck,
  IconClipboard,
  IconExternalLink,
  IconRefresh,
  IconTerminal2,
  IconX,
} from '@tabler/icons-react'
import type { CodexTaskState } from '@tapcanvas/codex-task-protocol'
import type {
  CodexDispatchController,
  ChatExecutionTarget,
} from './useCodexDispatch'
import './CodexDispatchControl.css'

const TASK_STATE_LABELS: Readonly<Record<CodexTaskState, string>> = {
  queued: '排队中',
  claimed: '已领取',
  codex_running: 'Codex 编辑中',
  awaiting_user_input: '等待你的回复',
  codex_failed: 'Codex 失败',
  remote_build_queued: '等待远程构建',
  remote_build_running: '远程构建中',
  remote_build_failed_code: '代码验证失败',
  remote_build_failed_infrastructure: '远程基础设施失败',
  fallback_waiting_approval: '等待本机审批',
  local_fallback_approved: '已批准本机验证',
  local_build_running: '本机隔离验证中',
  succeeded: '已通过验收',
  failed: '失败',
  canceled: '已取消',
  unknown: '终态未知',
}

function TargetButton(input: {
  target: ChatExecutionTarget
  selected: boolean
  label: string
  icon: React.ReactNode
  onSelect: (target: ChatExecutionTarget) => void
}): JSX.Element {
  return (
    <button
      type="button"
      className={[
        'tc-codex-dispatch__target',
        input.selected ? 'tc-codex-dispatch__target--selected' : '',
      ].filter(Boolean).join(' ')}
      aria-pressed={input.selected}
      onClick={() => input.onSelect(input.target)}
    >
      <span className="tc-codex-dispatch__target-icon">{input.icon}</span>
      <span className="tc-codex-dispatch__target-label">{input.label}</span>
    </button>
  )
}

function PairingPanel(input: {
  controller: CodexDispatchController
}): JSX.Element {
  const { controller } = input
  const actionLabel = controller.pairing
    ? controller.pairing.copied
      ? '再次复制给 Codex'
      : '复制安装任务'
    : '复制给 Codex'
  return (
    <div className="tc-codex-dispatch__pairing">
      <div className="tc-codex-dispatch__pairing-copy">
        <Text className="tc-codex-dispatch__primary-text" size="xs">
          本机 Codex 尚未连接
        </Text>
        <Text className="tc-codex-dispatch__secondary-text" size="xs" c="dimmed">
          首次只需复制一次，由 Codex 自己安装；之后都在画布直接派发。
        </Text>
      </div>
      <Button
        className="tc-codex-dispatch__pairing-action"
        size="compact-xs"
        variant="light"
        leftSection={controller.pairing?.copied
          ? <IconCheck className="tc-codex-dispatch__button-icon" size={14} />
          : <IconClipboard className="tc-codex-dispatch__button-icon" size={14} />}
        loading={controller.pairingBusy}
        onClick={() => {
          if (controller.pairing) void controller.copyPairingPrompt()
          else void controller.beginPairing()
        }}
      >
        {actionLabel}
      </Button>
      {controller.pairing ? (
        <details className="tc-codex-dispatch__pairing-details">
          <summary className="tc-codex-dispatch__pairing-summary">
            查看可手动复制的安装任务 · {new Date(controller.pairing.session.expiresAt).toLocaleTimeString()}
            失效
          </summary>
          <Textarea
            className="tc-codex-dispatch__pairing-prompt"
            classNames={{
              input: 'tc-codex-dispatch__pairing-prompt-input',
            }}
            value={controller.pairing.prompt}
            readOnly
            autosize
            minRows={3}
            maxRows={7}
          />
        </details>
      ) : null}
    </div>
  )
}

function WorkspaceSelectors(input: {
  controller: CodexDispatchController
}): JSX.Element {
  const { controller } = input
  const bridgeData = controller.bridges.map((bridge) => ({
    value: bridge.bridgeId,
    label: `${bridge.name}${bridge.status === 'online' ? '' : ' · 离线'}`,
  }))
  const workspaceData = (controller.selectedBridge?.workspaces || []).map(
    (workspace) => ({
      value: workspace.id,
      label: workspace.label,
    }),
  )
  return (
    <Group
      className="tc-codex-dispatch__selectors"
      gap={6}
      wrap="nowrap"
    >
      <Select
        className="tc-codex-dispatch__select"
        classNames={{
          input: 'tc-codex-dispatch__select-input',
          dropdown: 'tc-codex-dispatch__select-dropdown',
          option: 'tc-codex-dispatch__select-option',
        }}
        aria-label="选择 Codex Bridge"
        data={bridgeData}
        value={controller.selectedBridge?.bridgeId || null}
        onChange={(value) => {
          if (value) controller.selectBridge(value)
        }}
        size="xs"
        variant="unstyled"
        allowDeselect={false}
      />
      <Select
        className="tc-codex-dispatch__select tc-codex-dispatch__select--workspace"
        classNames={{
          input: 'tc-codex-dispatch__select-input',
          dropdown: 'tc-codex-dispatch__select-dropdown',
          option: 'tc-codex-dispatch__select-option',
        }}
        aria-label="选择 Codex workspace"
        data={workspaceData}
        value={controller.selectedWorkspace?.id || null}
        onChange={(value) => {
          if (value) controller.selectWorkspace(value)
        }}
        size="xs"
        variant="unstyled"
        allowDeselect={false}
      />
      <Tooltip
        className="tc-codex-dispatch__tooltip"
        label="刷新 Bridge 状态"
        withArrow
      >
        <ActionIcon
          className="tc-codex-dispatch__refresh"
          aria-label="刷新 Codex Bridge 状态"
          variant="subtle"
          size="sm"
          loading={controller.loadingBridges}
          onClick={() => void controller.refresh()}
        >
          <IconRefresh className="tc-codex-dispatch__refresh-icon" size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  )
}

function TaskStatus(input: {
  controller: CodexDispatchController
}): JSX.Element | null {
  const { controller } = input
  const task = controller.activeTask
  if (!task) return null
  return (
    <div
      className="tc-codex-dispatch__task"
      data-state={task.state}
    >
      <div className="tc-codex-dispatch__task-copy">
        <Text className="tc-codex-dispatch__task-state" size="xs">
          {TASK_STATE_LABELS[task.state]}
        </Text>
        <Text
          className="tc-codex-dispatch__task-message"
          size="xs"
          c="dimmed"
          lineClamp={2}
          title={task.lastMessage}
        >
          {task.lastMessage}
        </Text>
      </div>
      {task.state === 'fallback_waiting_approval' ? (
        <Group
          className="tc-codex-dispatch__fallback-actions"
          gap={4}
          wrap="nowrap"
        >
          <Tooltip
            className="tc-codex-dispatch__tooltip"
            label="仅本次允许在本机隔离 Docker 中安装、测试、构建和预览"
            withArrow
          >
            <Button
              className="tc-codex-dispatch__fallback-approve"
              size="compact-xs"
              variant="light"
              loading={controller.fallbackBusy}
              onClick={() => void controller.decideFallback('approve')}
            >
              批准本次
            </Button>
          </Tooltip>
          <ActionIcon
            className="tc-codex-dispatch__fallback-decline"
            aria-label="拒绝本机 Docker fallback"
            size="sm"
            variant="subtle"
            color="red"
            disabled={controller.fallbackBusy}
            onClick={() => void controller.decideFallback('decline')}
          >
            <IconX className="tc-codex-dispatch__fallback-decline-icon" size={14} />
          </ActionIcon>
        </Group>
      ) : null}
      {task.state === 'succeeded' && task.deliveryEvidence.preview ? (
        <Tooltip
          className="tc-codex-dispatch__tooltip"
          label="打开隔离预览"
          withArrow
        >
          <ActionIcon
            className="tc-codex-dispatch__preview"
            component="a"
            href={`/preview/${encodeURIComponent(task.previewId)}`}
            target="_blank"
            rel="noreferrer"
            aria-label="打开 Codex 构建预览"
            size="sm"
            variant="light"
          >
            <IconExternalLink className="tc-codex-dispatch__preview-icon" size={14} />
          </ActionIcon>
        </Tooltip>
      ) : null}
    </div>
  )
}

export function CodexDispatchControl(input: {
  controller: CodexDispatchController
  compact?: boolean
}): JSX.Element {
  const { controller } = input
  const hasOnlineBridge = controller.bridges.some(
    (bridge) => bridge.status === 'online',
  )
  return (
    <div
      className={[
        'tc-codex-dispatch',
        input.compact ? 'tc-codex-dispatch--compact' : '',
        controller.target === 'codex'
          ? 'tc-codex-dispatch--codex'
          : 'tc-codex-dispatch--agents',
      ].filter(Boolean).join(' ')}
    >
      <div className="tc-codex-dispatch__target-switch" role="group" aria-label="任务执行目标">
        <TargetButton
          target="agents"
          selected={controller.target === 'agents'}
          label="小T"
          icon={<IconBrandOpenai className="tc-codex-dispatch__target-svg" size={13} />}
          onSelect={controller.setTarget}
        />
        <TargetButton
          target="codex"
          selected={controller.target === 'codex'}
          label="Codex"
          icon={<IconTerminal2 className="tc-codex-dispatch__target-svg" size={13} />}
          onSelect={controller.setTarget}
        />
      </div>

      {controller.target === 'codex' ? (
        <div className="tc-codex-dispatch__body">
          {hasOnlineBridge ? (
            <WorkspaceSelectors controller={controller} />
          ) : (
            <PairingPanel controller={controller} />
          )}
          <TaskStatus controller={controller} />
          {controller.error ? (
            <Text
              className="tc-codex-dispatch__error"
              size="xs"
              c="red"
              lineClamp={2}
              title={controller.error}
            >
              {controller.error}
            </Text>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
