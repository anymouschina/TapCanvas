import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { ModelService } from './model.service'

@UseGuards(JwtGuard)
@Controller('models')
export class ModelController {
  constructor(private readonly service: ModelService) {}

  @Get('providers')
  listProviders() {
    return this.service.listProviders()
  }

  @Get('providers/:id/tokens')
  listTokens(@Param('id') id: string) {
    return this.service.listTokens(id)
  }

  @Post('providers')
  upsertProvider(@Body() body: { id?: string; name: string; vendor: string; baseUrl?: string | null }) {
    return this.service.upsertProvider(body)
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
    },
  ) {
    return this.service.upsertToken(body)
  }

  @Delete('tokens/:id')
  deleteToken(@Param('id') id: string) {
    return this.service.deleteToken(id)
  }
}

