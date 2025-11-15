import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { DraftService } from './draft.service'

@UseGuards(JwtGuard)
@Controller('drafts')
export class DraftController {
  constructor(private readonly service: DraftService) {}

  @Get('suggest')
  suggest(
    @Query('q') q: string,
    @Query('provider') provider: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: any,
  ) {
    const userId = String(req.user.sub)
    const parsedLimit = limit ? parseInt(limit, 10) || undefined : undefined
    return this.service.suggestPrompts(userId, q || '', provider || 'sora', parsedLimit)
  }

  @Get('mark-used')
  markUsed(
    @Query('prompt') prompt: string,
    @Query('provider') provider: string | undefined,
    @Req() req: any,
  ) {
    const userId = String(req.user.sub)
    return this.service.markPromptUsed(userId, provider || 'sora', prompt || '')
  }
}
