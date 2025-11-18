import { Module } from '@nestjs/common'
import { ProjectService } from './project.service'
import { ProjectController, PublicProjectController } from './project.controller'

@Module({
  providers: [ProjectService],
  controllers: [ProjectController, PublicProjectController],
  exports: [ProjectService],
})
export class ProjectModule {}

