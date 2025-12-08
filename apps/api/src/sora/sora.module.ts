import { Module } from '@nestjs/common'
import { SoraController } from './sora.controller'
import { SoraService } from './sora.service'
import { TokenRouterService } from './token-router.service'
import { VideoHistoryService } from '../video/video-history.service'
import { ProxyService } from '../proxy/proxy.service'
import { SoraUploadController } from './sora-upload.controller'
import { SoraUploadProxyService } from './sora-upload.service'

@Module({
  controllers: [SoraController, SoraUploadController],
  providers: [SoraService, TokenRouterService, VideoHistoryService, ProxyService, SoraUploadProxyService],
  exports: [TokenRouterService],
})
export class SoraModule {}
