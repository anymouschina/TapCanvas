import React, { useState } from 'react'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatModelControl } from './ChatModelControl'
import { DEFAULT_CHAT_MODEL_SETTINGS } from './useChatModelSettings'
import { chatModelCapabilities, chatModelSettingsPayload } from './chatModelCapabilities'

afterEach(cleanup)

function Harness({ disabled = false, initialModel = 'gpt-6-astra' }: { disabled?: boolean; initialModel?: string }) {
  const [settings, setSettings] = useState(DEFAULT_CHAT_MODEL_SETTINGS)
  const [model, setModel] = useState<string | null>(initialModel)
  return <MantineProvider env="test"><ChatModelControl options={[{ value: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' }, { value: 'gpt-6-astra', label: 'GPT-6 Astra' }, { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }, { value: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }]}
    value={model} onModelChange={setModel} settings={settings} onSettingsChange={setSettings}
    capabilities={chatModelCapabilities(model)} placeholder="选择模型" disabled={disabled} /></MantineProvider>
}

describe('model controls', () => {
  it('changes reasoning while unsupported priority remains disabled', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }))
    expect((await screen.findByRole('slider', { name: '思考程度' })).getAttribute('aria-valuenow')).toBe('1')
    expect(screen.queryByRole('switch', { name: '优先服务' })).toBeNull()
    expect((screen.getByRole('button', { name: '优先服务' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('slider', { name: '思考程度' }), { key: 'ArrowRight' })
    expect(screen.getByRole('slider', { name: '思考程度' }).getAttribute('aria-valuenow')).toBe('2')

  })
  it('disables settings while the current turn is active', () => {
    render(<Harness disabled />)
    expect((screen.getByRole('button', { name: '模型与思考设置' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('does not send unsupported controls when switching to another protocol', () => {
    expect(chatModelSettingsPayload('gpt-6-astra', DEFAULT_CHAT_MODEL_SETTINGS)).toEqual({ reasoningEffort: 'medium' })
    expect(() => chatModelSettingsPayload('deepseek-v4-flash', { reasoningEffort: 'high', serviceTier: 'priority' })).toThrow('不支持优先服务')
    expect(chatModelSettingsPayload('doubao-seed-2-0-pro-260215', DEFAULT_CHAT_MODEL_SETTINGS)).toEqual({})
  })
})

it('DeepSeek V4.1 Flash exposes thinking levels but not priority service', async () => {
  expect(chatModelCapabilities('deepseek-v4.1-flash')).toEqual({
    reasoning: true,
    priority: false,
    reasoningLevels: ['low', 'medium', 'high', 'xhigh'],
  })
  expect(chatModelSettingsPayload('deepseek-v4.1-flash', { reasoningEffort: 'xhigh', serviceTier: 'default' })).toEqual({ reasoningEffort: 'xhigh' })
  cleanup()
  render(<Harness initialModel="deepseek-v4.1-flash" />)
  fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }))
  expect((await screen.findByRole('slider', { name: '思考程度' })).getAttribute('aria-valuemax')).toBe('3')
  expect(screen.queryByRole('switch', { name: '优先服务' })).toBeNull()
})

it('Gemini exposes its own reasoning range without priority service', async () => {
  render(<Harness initialModel="gemini-3.8-flash" />)
  fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }))
  const slider = await screen.findByRole('slider', { name: '思考程度' })
  expect(slider.getAttribute('aria-valuemax')).toBe('3')
  expect(slider.getAttribute('aria-valuenow')).toBe('2')
  expect(screen.queryByRole('switch', { name: '优先服务' })).toBeNull()
  expect(chatModelSettingsPayload('gemini-3.8-flash', { reasoningEffort: 'minimal', serviceTier: 'default' })).toEqual({ reasoningEffort: 'minimal' })
  expect(() => chatModelSettingsPayload('gemini-3.8-flash', { reasoningEffort: 'xhigh', serviceTier: 'default' })).toThrow('重新选择')
})

it('Grok exposes supported effort levels and preserves the selected value', async () => {
  render(<Harness initialModel="grok-4.6" />)
  fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }))
  expect((await screen.findByRole('slider', { name: '思考程度' })).getAttribute('aria-valuemax')).toBe('3')
  expect(screen.queryByRole('switch', { name: '优先服务' })).toBeNull()
  expect(chatModelSettingsPayload('grok-4.6', { reasoningEffort: 'xhigh', serviceTier: 'default' })).toEqual({ reasoningEffort: 'xhigh' })
  expect(chatModelCapabilities('grok-4.5').reasoningLevels).toEqual(['low', 'medium', 'high'])
  expect(() => chatModelSettingsPayload('grok-4.5', { reasoningEffort: 'xhigh', serviceTier: 'default' })).toThrow('重新选择')
  expect(chatModelCapabilities('grok-imagine-video').reasoning).toBe(false)
  cleanup()
  render(<Harness initialModel="grok-4.5" />)
  fireEvent.click(screen.getByRole('button', { name: '模型与思考设置' }))
  expect((await screen.findByRole('slider', { name: '思考程度' })).getAttribute('aria-valuemax')).toBe('2')
})
