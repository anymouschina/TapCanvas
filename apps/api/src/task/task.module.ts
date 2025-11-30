import { Module } from '@nestjs/common'
import { TaskService } from './task.service'
import { TaskController } from './task.controller'
import { ProxyService } from '../proxy/proxy.service'
import { TaskProgressService } from './task-progress.service'

@Module({
  providers: [TaskService, ProxyService, TaskProgressService],
  controllers: [TaskController],
})
export class TaskModule {}
