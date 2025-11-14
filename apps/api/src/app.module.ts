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

@Module({
  imports: [PrismaModule.forRoot({ isGlobal: true }), QueueModule, AuthModule, ProjectModule, AssetModule, FlowModule, ModelModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
