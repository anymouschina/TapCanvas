import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { AssetService } from './asset.service'

@UseGuards(JwtGuard)
@Controller('assets')
export class AssetController {
  constructor(private readonly service: AssetService) {}

  @Get()
  list(@Req() req: any) {
    // 获取用户的所有资产，不限制项目
    return this.service.list(String(req.user.sub))
  }

  @Post()
  create(@Req() req: any, @Body() body: { name: string; data: any }) {
    // 创建用户级别的资产
    return this.service.create(String(req.user.sub), body)
  }

  @Put(':id')
  rename(@Req() req: any, @Param('id') id: string, @Body() body: { name: string }) {
    return this.service.rename(String(req.user.sub), id, body.name)
  }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) {
    return this.service.remove(String(req.user.sub), id)
  }
}

