import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { PrismaModule } from 'nestjs-prisma'
import { FlowModule } from './flow/flow.module'
import { AuthModule } from './auth/auth.module'
import { ProjectModule } from './project/project.module'
import { AssetModule } from './asset/asset.module'
import { QueueModule } from './queue/queue.module'
import { ModelModule } from './model/model.module'
import { SoraModule } from './sora/sora.module'
import { DraftModule } from './draft/draft.module'
import { TaskModule } from './task/task.module'
import { AiModule } from './ai/ai.module'

@Module({
  imports: [PrismaModule.forRoot({ isGlobal: true }), QueueModule, AuthModule, ProjectModule, AssetModule, FlowModule, ModelModule, SoraModule, DraftModule, TaskModule, AiModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
