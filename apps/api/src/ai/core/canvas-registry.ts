import {
  CanvasCapability,
  CanvasActionDomain,
  ParsedCanvasIntent,
  ParameterSchema
} from './types/canvas-intelligence.types'

export class CanvasCapabilityRegistry {
  private capabilities = new Map<string, CanvasCapability>()
  private intentPatterns = new Map<string, CanvasCapability[]>()

  /**
   * 注册新的画布能力
   */
  register(capability: CanvasCapability): void {
    const key = `${capability.domain}:${capability.name}`
    this.capabilities.set(key, capability)

    // 同时注册意图模式
    capability.intentPatterns.forEach(pattern => {
      pattern.patterns.forEach(p => {
        const normalizedPattern = p.toLowerCase()
        if (!this.intentPatterns.has(normalizedPattern)) {
          this.intentPatterns.set(normalizedPattern, [])
        }
        this.intentPatterns.get(normalizedPattern)!.push(capability)
      })
    })
  }

  /**
   * 获取所有注册的能力
   */
  getAllCapabilities(): CanvasCapability[] {
    return Array.from(this.capabilities.values())
  }

  /**
   * 根据域获取能力
   */
  getCapabilitiesByDomain(domain: CanvasActionDomain): CanvasCapability[] {
    return Array.from(this.capabilities.values()).filter(cap => cap.domain === domain)
  }

  /**
   * 根据名称获取能力
   */
  getCapabilityByName(domain: CanvasActionDomain, name: string): CanvasCapability | undefined {
    const key = `${domain}:${name}`
    return this.capabilities.get(key)
  }

  /**
   * 基于用户输入查找匹配的能力
   */
  findMatchingCapabilities(userInput: string): Array<{capability: CanvasCapability, score: number}> {
    const input = userInput.toLowerCase()
    const matches: Array<{capability: CanvasCapability, score: number}> = []

    // 直接模式匹配
    for (const [pattern, capabilities] of this.intentPatterns) {
      if (input.includes(pattern)) {
        capabilities.forEach(cap => {
          const existingMatch = matches.find(m => m.capability === cap)
          if (existingMatch) {
            existingMatch.score += 1
          } else {
            matches.push({ capability: cap, score: 1 })
          }
        })
      }
    }

    // 语义匹配 (简单实现)
    const semanticKeywords = {
      [CanvasActionDomain.NODE_MANIPULATION]: ['节点', '创建', '删除', '修改', '添加'],
      [CanvasActionDomain.LAYOUT_ARRANGEMENT]: ['布局', '排列', '整理', '对齐', '排版'],
      [CanvasActionDomain.VIEW_NAVIGATION]: ['视图', '缩放', '聚焦', '导航', '定位'],
      [CanvasActionDomain.PROJECT_MANAGEMENT]: ['项目', '保存', '加载', '导出', '文件'],
      [CanvasActionDomain.EXECUTION_DEBUG]: ['执行', '运行', '调试', '优化', '性能'],
      [CanvasActionDomain.TEMPLATE_SYSTEM]: ['模板', '预设', '样式', '示例'],
      [CanvasActionDomain.CONNECTION_FLOW]: ['连接', '线', '流', '管道', '关联'],
      [CanvasActionDomain.ASSET_MANAGEMENT]: ['素材', '资产', '文件', '图片', '视频'],
      [CanvasActionDomain.SETTINGS_CONFIG]: ['设置', '配置', '参数', '选项']
    }

    for (const [domain, keywords] of Object.entries(semanticKeywords)) {
      if (keywords.some(keyword => input.includes(keyword))) {
        const domainCapabilities = this.getCapabilitiesByDomain(domain as CanvasActionDomain)
        domainCapabilities.forEach(cap => {
          const existingMatch = matches.find(m => m.capability === cap)
          const keywordMatches = keywords.filter(k => input.includes(k)).length

          if (existingMatch) {
            existingMatch.score += keywordMatches * 0.5
          } else {
            matches.push({ capability: cap, score: keywordMatches * 0.5 })
          }
        })
      }
    }

    return matches.sort((a, b) => b.score - a.score)
  }

  /**
   * 智能提取参数
   */
  extractParameters(capability: CanvasCapability, userInput: string): Record<string, any> {
    const input = userInput.toLowerCase()
    const params: Record<string, any> = {}

    // 遍历所有操作模式
    capability.operationModes.forEach(mode => {
      mode.parameters.forEach(param => {
        const value = this.extractParameterValue(param, input)
        if (value !== null) {
          params[param.name] = value
        }
      })
    })

    return params
  }

  private extractParameterValue(param: ParameterSchema, input: string): any {
    switch (param.type) {
      case 'enum':
        if (param.options) {
          for (const option of param.options) {
            if (input.includes(option.toLowerCase())) {
              return option
            }
          }
        }
        break

      case 'number':
        // 提取数字
        const numberMatch = input.match(/(\d+(\.\d+)?)/)
        if (numberMatch) {
          return parseFloat(numberMatch[1])
        }
        break

      case 'boolean':
        // 提取布尔值
        if (input.includes('是') || input.includes('启用') || input.includes('打开')) {
          return true
        }
        if (input.includes('否') || input.includes('禁用') || input.includes('关闭')) {
          return false
        }
        break

      case 'string':
        // 简单的字符串提取
        if (param.name === 'style') {
          const styleKeywords = {
            '写实': 'realistic',
            '动漫': 'anime',
            '油画': 'oil_painting',
            '水彩': 'watercolor',
            '赛博朋克': 'cyberpunk',
            '古风': 'ancient'
          }
          for (const [chinese, english] of Object.entries(styleKeywords)) {
            if (input.includes(chinese)) {
              return english
            }
          }
        }

        if (param.name === 'quality') {
          if (input.includes('高清') || input.includes('高质量')) return 'high'
          if (input.includes('标清') || input.includes('标准')) return 'standard'
          if (input.includes('超高清') || input.includes('4k')) return 'ultra'
        }

        if (param.name === 'layoutType') {
          if (input.includes('网格') || input.includes('grid')) return 'grid'
          if (input.includes('层次') || input.includes('分层')) return 'hierarchical'
          if (input.includes('圆形') || input.includes('环形')) return 'circular'
          if (input.includes('力导') || input.includes('force')) return 'force-directed'
        }
        break

      case 'array':
        // 简单的数组提取
        if (param.name === 'nodeIds' && input.includes('节点')) {
          // 这里需要从上下文中提取具体的节点ID
          return []
        }
        break
    }

    return param.default || null
  }

  /**
   * 获取能力统计信息
   */
  getStatistics() {
    const stats = {
      totalCapabilities: this.capabilities.size,
      capabilitiesByDomain: {} as Record<CanvasActionDomain, number>,
      totalIntentPatterns: 0
    }

    for (const domain of Object.values(CanvasActionDomain)) {
      stats.capabilitiesByDomain[domain] = this.getCapabilitiesByDomain(domain).length
    }

    stats.totalIntentPatterns = Array.from(this.intentPatterns.values())
      .reduce((total, caps) => total + caps.length, 0)

    return stats
  }
}

// 全局注册器实例
export const canvasCapabilityRegistry = new CanvasCapabilityRegistry()