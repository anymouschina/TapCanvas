import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { ProjectService } from './project.service'
import { JwtGuard } from '../auth/jwt.guard'

@UseGuards(JwtGuard)
@Controller('projects')
export class ProjectController {
  constructor(private readonly service: ProjectService) {}

  @Get()
  list(@Req() req: any) { return this.service.list(String(req.user.sub)) }

  @Post()
  upsert(@Body() body: { id?: string; name: string }, @Req() req: any) { return this.service.upsert(String(req.user.sub), body) }
}

