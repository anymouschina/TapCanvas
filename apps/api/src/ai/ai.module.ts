import { Module } from '@nestjs/common'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'
import { ToolEventsService } from './tool-events.service'

@Module({
  controllers: [AiController],
  providers: [AiService, ToolEventsService],
})
export class AiModule {}
