import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import {
  registerLayoutArrangementCapability
} from './layout-arrangement.capability'
import {
  registerNodeManipulationCapability
} from './node-manipulation.capability'
import {
  registerExecutionDebugCapability
} from './execution-debug.capability'
import {
  registerXiaohongshuCoverCapability
} from './xiaohongshu-cover.capability'

@Injectable()
export class CapabilityRegistryService implements OnModuleInit {
  private readonly logger = new Logger(CapabilityRegistryService.name)

  onModuleInit() {
    this.logger.log('Initializing Canvas Capabilities...')
    this.registerAllCapabilities()
    this.logRegistryStatus()
  }

  private registerAllCapabilities() {
    try {
      // 注册布局排列能力
      registerLayoutArrangementCapability()
      this.logger.debug('✅ Layout Arrangement capability registered')

      // 注册节点操作能力
      registerNodeManipulationCapability()
      this.logger.debug('✅ Node Manipulation capability registered')

      // 注册执行调试能力
      registerExecutionDebugCapability()
      this.logger.debug('✅ Execution Debug capability registered')

      // 注册小红书封面生成能力
      registerXiaohongshuCoverCapability()
      this.logger.debug('✅ Xiaohongshu Cover capability registered')

      // TODO: 添加更多能力注册
      // registerViewNavigationCapability()
      // registerProjectManagementCapability()
      // registerTemplateSystemCapability()
      // registerAssetManagementCapability()

      this.logger.log('🎉 All canvas capabilities registered successfully!')

    } catch (error) {
      this.logger.error('Failed to register capabilities', error as any)
      throw error
    }
  }

  private logRegistryStatus() {
    const { canvasCapabilityRegistry } = require('../core/canvas-registry')
    const stats = canvasCapabilityRegistry.getStatistics()

    this.logger.log('📊 Canvas Capability Registry Status:')
    this.logger.log(`   Total Capabilities: ${stats.totalCapabilities}`)
    this.logger.log(`   Total Intent Patterns: ${stats.totalIntentPatterns}`)
    this.logger.log(`   Capabilities by Domain:`)

    Object.entries(stats.capabilitiesByDomain).forEach(([domain, count]) => {
      this.logger.log(`   - ${domain}: ${count}`)
    })
  }
}