import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { SoraService } from './sora.service'

@UseGuards(JwtGuard)
@Controller('sora')
export class SoraController {
  constructor(private readonly service: SoraService) {}

  @Get('drafts')
  getDrafts(
    @Query('tokenId') tokenId: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: any,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) || undefined : undefined
    return this.service.getDrafts(String(req.user.sub), tokenId, cursor, parsedLimit)
  }

  @Get('drafts/delete')
  deleteDraft(
    @Query('tokenId') tokenId: string,
    @Query('draftId') draftId: string,
    @Req() req: any,
  ) {
    return this.service.deleteDraft(String(req.user.sub), tokenId, draftId)
  }
}
