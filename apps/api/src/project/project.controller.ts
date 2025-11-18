import { Body, Controller, Get, Post, Patch, Req, UseGuards, Param } from '@nestjs/common'
import { ProjectService } from './project.service'
import { JwtGuard } from '../auth/jwt.guard'

// 需要认证的项目端点
@UseGuards(JwtGuard)
@Controller('projects')
export class ProjectController {
  constructor(private readonly service: ProjectService) {}

  @Get()
  list(@Req() req: any) { return this.service.list(String(req.user.sub)) }

  @Post()
  upsert(@Body() body: { id?: string; name: string }, @Req() req: any) { return this.service.upsert(String(req.user.sub), body) }

  @Patch(':id/public')
  togglePublic(@Param('id') id: string, @Body() body: { isPublic: boolean }, @Req() req: any) {
    return this.service.togglePublic(String(req.user.sub), id, body.isPublic)
  }

  @Post(':id/clone')
  clone(@Param('id') id: string, @Body() body: { name?: string }, @Req() req: any) {
    return this.service.clone(String(req.user.sub), id, body.name)
  }
}

// 公开访问的端点（不需要认证）
@Controller()
export class PublicProjectController {
  constructor(private readonly service: ProjectService) {}

  @Get('projects/public')
  listPublic() { return this.service.listPublic() }

  @Get('projects/:id/flows')
  getProjectFlows(@Param('id') id: string) { return this.service.getProjectFlows(id) }
}

