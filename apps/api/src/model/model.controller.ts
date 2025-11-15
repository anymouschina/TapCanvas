import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
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

  @Get('providers/:id/tokens')
  listTokens(@Param('id') id: string, @Req() req: any) {
    return this.service.listTokens(id, String(req.user.sub))
  }

  @Get('providers/:id/endpoints')
  listEndpoints(@Param('id') id: string, @Req() req: any) {
    return this.service.listEndpoints(id, String(req.user.sub))
  }

  @Post('providers')
  upsertProvider(@Body() body: { id?: string; name: string; vendor: string; baseUrl?: string | null }, @Req() req: any) {
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
}
