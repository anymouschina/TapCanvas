import { availableThinkingLevels, type ChatModelCapabilities } from './chatModelCapabilities'
import { forwardRef, useState } from 'react'
import { Popover, Select, Slider } from '@mantine/core'
import { IconBolt, IconChevronDown, IconChevronRight } from '@tabler/icons-react'
import { type ChatModelSettings } from './useChatModelSettings'
import './ChatModelControl.css'

type Props = {
  options: Array<{ value: string; label: string }>
  value: string | null
  placeholder: string
  disabled: boolean
  capabilities: ChatModelCapabilities
  settings: ChatModelSettings
  onModelChange: (value: string | null) => void
  onSettingsChange: (settings: ChatModelSettings) => void
}

export const ChatModelControl = forwardRef<HTMLButtonElement, Props>(function ChatModelControl({
  options, value, placeholder, disabled, capabilities, settings, onModelChange, onSettingsChange,
}, ref) {
  const [opened, setOpened] = useState(false)
  const [choosingModel, setChoosingModel] = useState(false)
  const selected = options.find((option) => option.value === value)
  const label = selected?.value === 'gpt-6-astra' ? 'GPT-6 Astra' : selected?.label ?? placeholder
  const thinkingLevels = availableThinkingLevels(capabilities)
  const level = thinkingLevels.findIndex((item) => item.value === settings.reasoningEffort)
  const fast = settings.serviceTier === 'priority'
  return (
    <Popover opened={opened && !disabled} onChange={setOpened} position="top-start" width={300} zIndex={10050} shadow="lg">
      <Popover.Target>
        <button ref={ref} type="button" className="tc-model-control__trigger" disabled={disabled}
          aria-label="模型与思考设置" aria-expanded={opened && !disabled} aria-haspopup="dialog"
          onClick={() => setOpened((current) => !current)}>
          {fast && <IconBolt size={14} className="tc-model-control__bolt" />}
          <span className="tc-model-control__name">{label}</span>
          {selected && capabilities.reasoning && <span className="tc-model-control__level">{thinkingLevels[level]?.label ?? "请选择"}</span>}
          <IconChevronDown className="chat-model-control__icon-chevron-down" size={14} />
        </button>
      </Popover.Target>
      <Popover.Dropdown className="tc-model-control__panel" role="dialog" aria-label="模型与思考设置">
        <div className="tc-model-control__heading">
          <button type="button" className={`tc-model-control__speed${fast ? ' is-active' : ''}`}
            aria-label="优先服务" aria-pressed={fast} disabled={!capabilities.priority && !fast}
            onClick={() => onSettingsChange({ ...settings, serviceTier: fast ? 'default' : 'priority' })}>
            <IconBolt className="chat-model-control__icon-bolt" size={21} fill={fast ? 'currentColor' : 'none'} />
          </button>
          <button type="button" className="tc-model-control__choose" onClick={() => setChoosingModel((current) => !current)}
            aria-expanded={choosingModel} aria-label="切换模型">
            <span className="tc-model-control__name">{label}</span>
            {capabilities.reasoning && <span className="tc-model-control__level">{thinkingLevels[level]?.label ?? "请选择"}</span>}
            <IconChevronRight className="chat-model-control__icon-chevron-right" size={17} />
          </button>
        </div>
        {choosingModel && <Select label="选择模型" aria-label="选择模型" placeholder="搜索模型" searchable
          data={options} value={value} allowDeselect={false} nothingFoundMessage="没有匹配的模型"
          onChange={(next) => { onModelChange(next); setChoosingModel(false) }}
          comboboxProps={{ withinPortal: false }} className="tc-model-control__models" />}
        {capabilities.reasoning && <>
        <div className="tc-model-control__thinking-caption"><span className="chat-model-control__span">思考程度</span><span className="chat-model-control__span">{thinkingLevels[level]?.label ?? "请选择"}</span></div>
        <Slider thumbLabel="思考程度" min={0} max={thinkingLevels.length - 1} step={1} value={Math.max(0, level)}
          onChange={(next) => { const item = thinkingLevels[next]; if (item) onSettingsChange({ ...settings, reasoningEffort: item.value }) }}
          label={(next) => thinkingLevels[next]?.label}
          marks={thinkingLevels.map((item, index) => ({ value: index, label: item.label }))}
          className="tc-model-control__slider" size={26} thumbSize={32} />
        </>}
        {capabilities.priority && <button type="button" role="switch" aria-label="优先服务" aria-checked={fast}
          onClick={() => onSettingsChange({ ...settings, serviceTier: fast ? 'default' : 'priority' })}
          className="tc-model-control__switch">
          <span className="chat-model-control__span">优先服务</span><span className="tc-model-control__switch-track" aria-hidden="true"><span className="chat-model-control__span" /></span>
        </button>}
        <p className="tc-model-control__hint">{capabilities.priority ? '优先服务影响请求调度；思考程度影响推理投入。费用以渠道实际计费为准，设置用于下一次发送。' : capabilities.reasoning ? '思考设置用于下一次发送；当前执行引擎不支持优先服务。' : '该模型未声明可调思考或优先服务能力。'}</p>
      </Popover.Dropdown>
    </Popover>
  )
})
