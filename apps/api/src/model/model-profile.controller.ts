import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { ModelService } from './model.service'

@UseGuards(JwtGuard)
@Controller('models/profiles')
export class ModelProfileController {
  constructor(private readonly service: ModelService) {}

  @Get()
  listProfiles(
    @Req() req: any,
    @Query('providerId') providerId?: string,
    @Query('kind') kind?: string | string[],
  ) {
    const kinds = Array.isArray(kind)
      ? kind.filter((k) => typeof k === 'string' && k.trim())
      : kind
        ? [kind]
        : undefined
    return this.service.listProfiles(String(req.user.sub), {
      providerId,
      kinds: kinds as any,
    })
  }

  @Post()
  upsertProfile(
    @Body()
    body: {
      id?: string
      providerId: string
      name: string
      kind: any
      modelKey: string
      settings?: Record<string, any> | null
    },
    @Req() req: any,
  ) {
    return this.service.upsertProfile(body, String(req.user.sub))
  }

  @Delete(':id')
  deleteProfile(@Param('id') id: string, @Req() req: any) {
    return this.service.deleteProfile(id, String(req.user.sub))
  }
}

