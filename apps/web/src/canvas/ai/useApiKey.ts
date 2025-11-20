/**
 * 获取已配置的API key
 */

import { listModelTokens, listModelProviders, upsertModelProvider, type ModelProviderDto } from '../../api/server'

export type AIProvider = 'openai' | 'anthropic' | 'google'

// 缓存providers数据
let providersCache: ModelProviderDto[] | null = null

async function getProviders(): Promise<ModelProviderDto[]> {
  if (!providersCache) {
    providersCache = await listModelProviders()

    // 确保AI助手的provider都存在
    const requiredProviders = [
      { name: 'OpenAI', vendor: 'openai' },
      { name: 'Anthropic', vendor: 'anthropic' },
      { name: 'Gemini', vendor: 'gemini' }
    ]

    for (const required of requiredProviders) {
      const existing = providersCache.find(p => p.vendor === required.vendor)
      if (!existing) {
        try {
          const created = await upsertModelProvider(required)
          providersCache.push(created)
          console.log(`创建${required.name} provider成功`)
        } catch (error) {
          console.error(`创建${required.name} provider失败:`, error)
        }
      }
    }
  }
  return providersCache
}

export async function getFirstAvailableApiKey(provider: AIProvider): Promise<string | null> {
  try {
    const providers = await getProviders()

    // 根据vendor查找对应的provider
    const providerMap: Record<AIProvider, string> = {
      'openai': 'openai',
      'anthropic': 'anthropic',
      'google': 'gemini' // Google对应Gemini vendor
    }

    const vendor = providerMap[provider]
    const foundProvider = providers.find(p => p.vendor === vendor)

    if (!foundProvider) {
      console.log(`未找到vendor为${vendor}的provider`)
      return null
    }

    console.log(`查找${vendor} provider的token, provider ID: ${foundProvider.id}`)
    const tokens = await listModelTokens(foundProvider.id)
    console.log(`找到${tokens.length}个tokens`)

    // 返回第一个可用的token
    const availableToken = tokens.find(token => token.enabled && token.secretToken)
    if (availableToken) {
      console.log(`找到可用的token: ${availableToken.label}`)
      return availableToken.secretToken
    }

    console.log(`没有找到可用的token`)
    return null

  } catch (error) {
    console.error(`获取${provider} API key失败:`, error)
    return null
  }
}

export async function getAnyAvailableApiKey(): Promise<{key: string, provider: AIProvider} | null> {
  // 按优先级尝试不同的provider
  const providers: AIProvider[] = ['openai', 'anthropic', 'google']

  for (const provider of providers) {
    console.log(`尝试获取${provider}的API key...`)
    const key = await getFirstAvailableApiKey(provider)
    if (key) {
      console.log(`成功获取${provider}的API key`)
      return { key, provider }
    }
  }

  console.log('所有provider都没有可用的API key')
  return null
}