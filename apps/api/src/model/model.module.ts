import { Module } from '@nestjs/common'
import { ModelController } from './model.controller'
import { ModelProfileController } from './model-profile.controller'
import { ModelService } from './model.service'

@Module({
  controllers: [ModelController, ModelProfileController],
  providers: [ModelService],
})
export class ModelModule {}
