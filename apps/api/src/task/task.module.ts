import { Module } from '@nestjs/common'
import { TaskService } from './task.service'
import { TaskController } from './task.controller'
import { ProxyService } from '../proxy/proxy.service'
import { TaskProgressService } from './task-progress.service'
import { R2StorageService } from '../storage/r2.service'

@Module({
  providers: [TaskService, ProxyService, TaskProgressService, R2StorageService],
  controllers: [TaskController],
})
export class TaskModule {}
