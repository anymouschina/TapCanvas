import { Module } from '@nestjs/common'
import { TaskService } from './task.service'
import { TaskController } from './task.controller'

@Module({
  providers: [TaskService],
  controllers: [TaskController],
})
export class TaskModule {}

