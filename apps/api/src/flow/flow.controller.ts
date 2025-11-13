import { Body, Controller, Delete, Get, Param, Post, UseGuards, Req } from '@nestjs/common'
import { FlowService } from './flow.service'
import { JwtGuard } from '../auth/jwt.guard'

@Controller('flows')
export class FlowController {
  constructor(private readonly service: FlowService) {}

  @UseGuards(JwtGuard)
  @Get()
  list(@Req() req: any) {
    return this.service.list(String(req.user.sub))
  }

  @UseGuards(JwtGuard)
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) {
    return this.service.get(id, String(req.user.sub))
  }

  @UseGuards(JwtGuard)
  @Post()
  upsert(@Body() body: { id?: string; name: string; data: any; projectId?: string|null }, @Req() req: any) {
    return this.service.upsert(String(req.user.sub), body)
  }

  @UseGuards(JwtGuard)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, String(req.user.sub))
  }

  @UseGuards(JwtGuard)
  @Get(':id/versions')
  versions(@Param('id') id: string, @Req() req: any) {
    return this.service.versions(id, String(req.user.sub))
  }

  @UseGuards(JwtGuard)
  @Post(':id/rollback')
  rollback(@Param('id') id: string, @Body() body: { versionId: string }, @Req() req: any) {
    return this.service.rollback(id, body.versionId, String(req.user.sub))
  }
}
