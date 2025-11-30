import { Module } from '@nestjs/common'
import { SoraController } from './sora.controller'
import { SoraService } from './sora.service'
import { TokenRouterService } from './token-router.service'
import { VideoHistoryService } from '../video/video-history.service'
import { ProxyService } from '../proxy/proxy.service'

@Module({
  controllers: [SoraController],
  providers: [SoraService, TokenRouterService, VideoHistoryService, ProxyService],
  exports: [TokenRouterService],
})
export class SoraModule {}
