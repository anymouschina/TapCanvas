import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { TaskService } from './task.service'
import type { AnyTaskRequest } from './task.types'

@UseGuards(JwtGuard)
@Controller('tasks')
export class TaskController {
  constructor(private readonly service: TaskService) {}

  @Post()
  runTask(
    @Body()
    body:
      | {
          profileId: string
          request: AnyTaskRequest
        }
      | {
          vendor: string
          request: AnyTaskRequest
        },
    @Req() req: any,
  ) {
    const userId = String(req.user.sub)
    if ('profileId' in body && body.profileId) {
      return this.service.execute(userId, body.profileId, body.request)
    }
    if ('vendor' in body && body.vendor) {
      return this.service.executeWithVendor(userId, body.vendor, body.request)
    }
    throw new Error('either profileId or vendor must be provided')
  }
}
