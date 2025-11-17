import { Module } from '@nestjs/common'
import { SoraController } from './sora.controller'
import { SoraService } from './sora.service'
import { TokenRouterService } from './token-router.service'

@Module({
  controllers: [SoraController],
  providers: [SoraService, TokenRouterService],
  exports: [TokenRouterService],
})
export class SoraModule {}

