import { Module } from '@nestjs/common'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'
import { IntelligentAiService } from './intelligent-ai.service'
import { CanvasIntentRecognizer } from './intelligence/intent-recognizer'
import { ThinkingStream } from './intelligence/thinking-stream'
import { WebExecutionEngine } from './execution/web-execution-engine'
import { ToolEventsService } from './tool-events.service'
import { CapabilityRegistryService } from './capabilities'
import { CanvasCapabilityRegistry, canvasCapabilityRegistry } from './core/canvas-registry'

@Module({
  controllers: [AiController],
  providers: [
    // 原有服务
    AiService,
    ToolEventsService,

    // 智能系统服务
    IntelligentAiService,
    CanvasIntentRecognizer,
    ThinkingStream,
    WebExecutionEngine,
    CapabilityRegistryService,

    // 画布能力注册器
    {
      provide: CanvasCapabilityRegistry,
      useValue: canvasCapabilityRegistry
    }
  ],
  exports: [
    IntelligentAiService,
    CanvasIntentRecognizer,
    ThinkingStream,
    WebExecutionEngine
  ]
})
export class AiModule {}
