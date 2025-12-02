import { Injectable, Logger } from '@nestjs/common'
import axios from 'axios'

interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name)

  async search(query: string, maxResults = 4, locale = 'zh-CN'): Promise<WebSearchResult[]> {
    const apiKey = process.env.WEB_SEARCH_API_KEY
    const baseUrl = process.env.WEB_SEARCH_BASE_URL

    if (!apiKey || !baseUrl) {
      this.logger.warn('WEB_SEARCH_API_KEY 或 WEB_SEARCH_BASE_URL 未配置，跳过联网搜索')
      throw new Error('WebSearch 未配置：请设置 WEB_SEARCH_API_KEY 与 WEB_SEARCH_BASE_URL')
    }

    const trimmedQuery = (query || '').trim()
    if (!trimmedQuery) {
      throw new Error('搜索 query 不能为空')
    }

    try {
      const resp = await axios.post(
        baseUrl.replace(/\/+$/, ''),
        {
          query: trimmedQuery,
          max_results: Math.min(Math.max(maxResults, 1), 8),
          search_lang: locale || 'zh-CN',
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      )

      const items = Array.isArray(resp.data?.results) ? resp.data.results : []
      return items.map((item: any) => ({
        title: String(item.title || '').slice(0, 200),
        url: String(item.url || item.link || ''),
        snippet: String(item.content || item.snippet || '').slice(0, 600),
      }))
    } catch (error: any) {
      this.logger.error('WebSearch 调用失败', {
        message: error?.message,
        status: error?.response?.status,
        data: error?.response?.data,
      })
      throw new Error('WebSearch 请求失败')
    }
  }
}

