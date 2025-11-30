import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards, Res, Query } from '@nestjs/common'
import type { Response } from 'express'
import { JwtGuard } from '../auth/jwt.guard'
import { ModelService } from './model.service'

@UseGuards(JwtGuard)
@Controller('models')
export class ModelController {
  constructor(private readonly service: ModelService) {}

  @Get('providers')
  listProviders(@Req() req: any) {
    return this.service.listProviders(String(req.user.sub))
  }

  @Get('available')
  listAvailableModels(@Req() req: any, @Query('vendor') vendor?: string) {
    return this.service.listAvailableModels(String(req.user.sub), vendor)
  }

  @Get('providers/:id/tokens')
  listTokens(@Param('id') id: string, @Req() req: any) {
    return this.service.listTokens(id, String(req.user.sub))
  }

  @Get('providers/:id/endpoints')
  listEndpoints(@Param('id') id: string, @Req() req: any) {
    return this.service.listEndpoints(id, String(req.user.sub))
  }

  @Post('providers')
  upsertProvider(@Body() body: { id?: string; name: string; vendor: string; baseUrl?: string | null; sharedBaseUrl?: boolean }, @Req() req: any) {
    return this.service.upsertProvider(body, String(req.user.sub))
  }

  @Post('tokens')
  upsertToken(
    @Body()
    body: {
      id?: string
      providerId: string
      label: string
      secretToken: string
      enabled?: boolean
      userAgent?: string | null
      shared?: boolean
    },
    @Req() req: any,
  ) {
    return this.service.upsertToken(body, String(req.user.sub))
  }

  @Delete('tokens/:id')
  deleteToken(@Param('id') id: string, @Req() req: any) {
    return this.service.deleteToken(id, String(req.user.sub))
  }

  @Post('endpoints')
  upsertEndpoint(
    @Body()
    body: {
      id?: string
      providerId: string
      key: string
      label: string
      baseUrl: string
      shared?: boolean
    },
    @Req() req: any,
  ) {
    return this.service.upsertEndpoint(body, String(req.user.sub))
  }

  @Get('export')
  async exportAll(@Req() req: any, @Res() res: Response) {
    try {
      const data = await this.service.exportAll(String(req.user.sub))

      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Content-Disposition', `attachment; filename="model-config-${new Date().toISOString().split('T')[0]}.json"`)

      res.json(data)
    } catch (error) {
      res.status(500).json({ error: 'Export failed', message: error.message })
    }
  }

  @Post('import')
  async importAll(@Body() data: any, @Req() req: any) {
    try {
      const result = await this.service.importAll(String(req.user.sub), data)
      return {
        success: true,
        message: 'Import completed',
        result
      }
    } catch (error) {
      return {
        success: false,
        error: 'Import failed',
        message: error.message
      }
    }
  }

  @Get('proxy/:vendor')
  getProxyConfig(@Param('vendor') vendor: string, @Req() req: any) {
    return this.service.getProxyConfig(String(req.user.sub), vendor)
  }

  @Post('proxy/:vendor')
  upsertProxyConfig(
    @Param('vendor') vendor: string,
    @Body()
    body: {
      baseUrl?: string
      apiKey?: string | null
      enabled?: boolean
      enabledVendors?: string[]
      name?: string
    },
    @Req() req: any,
  ) {
    return this.service.upsertProxyConfig(String(req.user.sub), {
      vendor,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      enabled: body.enabled,
      enabledVendors: body.enabledVendors,
      name: body.name,
    })
  }

  @Get('proxy/:vendor/credits')
  getProxyCredits(@Param('vendor') vendor: string, @Req() req: any) {
    return this.service.fetchProxyCredits(String(req.user.sub), vendor)
  }

  @Get('proxy/:vendor/model-status')
  getProxyModelStatus(
    @Param('vendor') vendor: string,
    @Query('model') model: string,
    @Req() req: any,
  ) {
    if (!model || !model.trim()) {
      throw new Error('model is required')
    }
    return this.service.fetchProxyModelStatus(String(req.user.sub), vendor, model)
  }
}
