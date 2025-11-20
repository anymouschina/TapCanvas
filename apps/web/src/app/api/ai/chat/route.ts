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

// 配置运行时为Edge
export const runtime = 'edge'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { messages, model = 'gpt-4-turbo', apiKey, system, tools } = body

    if (!apiKey) {
      return Response.json(
        { error: 'API Key is required' },
        { status: 400 }
      )
    }

    // 根据模型选择提供商
    let selectedModel
    const lower = String(model || '').toLowerCase()
    if (isAnthropicModel(model) || lower.includes('claude')) {
      selectedModel = anthropic(model, { apiKey })
    } else if (lower.startsWith('gpt-')) {
      selectedModel = openai(model, { apiKey })
    } else if (lower.startsWith('gemini')) {
      selectedModel = google(model, { apiKey })
    } else {
      selectedModel = openai('gpt-3.5-turbo', { apiKey })
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
