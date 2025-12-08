import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
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

  @Get('proxy-image')
  async proxyImage(@Query('url') url: string, @Res() res: Response) {
    const raw = (url || '').trim()
    if (!raw) {
      res.status(400).json({ message: 'url is required' })
      return
    }
    let target = raw
    try {
      target = decodeURIComponent(raw)
    } catch {
      // ignore
    }
    if (!/^https?:\/\//i.test(target)) {
      res.status(400).json({ message: 'only http/https urls are allowed' })
      return
    }
    try {
      const resp = await fetch(target, {
        headers: {
          Origin: 'https://tapcanvas.local',
        },
      })
      const ct = resp.headers.get('content-type') || 'application/octet-stream'
      const buf = Buffer.from(await resp.arrayBuffer())
      res.setHeader('Content-Type', ct)
      res.setHeader('Cache-Control', 'public, max-age=60')
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.status(resp.status).send(buf)
    } catch (err: any) {
      res.status(500).json({ message: err?.message || 'proxy image failed' })
    }
  }
}
