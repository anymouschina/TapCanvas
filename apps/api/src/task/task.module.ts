import { Module } from '@nestjs/common'
import { TaskService } from './task.service'
import { TaskController } from './task.controller'
import { ProxyService } from '../proxy/proxy.service'

@Module({
  providers: [TaskService, ProxyService],
  controllers: [TaskController],
})
export class TaskModule {}
