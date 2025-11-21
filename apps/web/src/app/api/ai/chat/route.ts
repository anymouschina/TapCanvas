/**
 * AI聊天API端点 - 简化版本，只处理AI模型调用
 * 工具执行由客户端处理
 */

import { streamText } from 'ai'
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { NextRequest } from 'next/server'
import { isAnthropicModel } from '../../../config/modelSource'
import { getModelProvider } from '../../../config/models'

// 配置运行时为Edge
export const runtime = 'edge'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { messages, model = 'gpt-4-turbo', apiKey, system, tools, baseUrl } = body

    const providerFromModel = getModelProvider(model)
    const lower = String(model || '').toLowerCase()
    const provider =
      baseUrl && baseUrl.toLowerCase().includes('anthropic')
        ? 'anthropic'
        : providerFromModel
    const keyFromEnv = provider === 'anthropic'
      ? process.env.ANTHROPIC_API_KEY
      : provider === 'google'
        ? process.env.GEMINI_API_KEY
        : process.env.OPENAI_API_KEY
    const finalKey = apiKey || keyFromEnv
    if (!finalKey) return Response.json({ error: 'API key missing' }, { status: 400 })

    // 根据模型选择提供商
    let selectedModel
    if (provider === 'anthropic' || isAnthropicModel(model) || lower.includes('claude') || lower.includes('glm')) {
      selectedModel = anthropic(model, { apiKey: finalKey, baseURL: baseUrl || process.env.ANTHROPIC_BASE_URL || undefined })
    } else if (provider === 'google' || lower.startsWith('gemini')) {
      selectedModel = google(model, { apiKey: finalKey, baseURL: baseUrl || process.env.GEMINI_BASE_URL || undefined })
    } else if (lower.startsWith('gpt-') || provider === 'openai') {
      selectedModel = openai(model, { apiKey: finalKey, baseURL: baseUrl || process.env.OPENAI_BASE_URL || undefined })
    } else {
      selectedModel = openai('gpt-3.5-turbo', { apiKey: finalKey })
    }

    // 准备消息
    const preparedMessages = []

    // 添加系统消息
    if (system) {
      preparedMessages.push({
        role: 'system' as const,
        content: system
      })
    }

    // 添加用户和助手消息
    preparedMessages.push(...messages)

    // 调用AI模型
    const result = await streamText({
      model: selectedModel,
      messages: preparedMessages,
      tools: tools && tools.length > 0 ? tools : undefined,
      maxToolRoundtrips: 3, // 允许最多3轮工具调用
      temperature: 0.7,
    })
    // Log basic info only. Do not log message contents to avoid leaking user inputs.
    console.debug('[ai/chat] model=%s provider=%s baseUrl=%s msgCount=%d', model, provider, baseUrl || '(default)', preparedMessages.length)

    return result.toAIStreamResponse()

  } catch (error) {
    console.error('AI API Error:', error)

    return Response.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
