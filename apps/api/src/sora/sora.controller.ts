import { Body, Controller, Get, Post, Query, Req, UseGuards, UploadedFile, UseInterceptors } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { SoraService } from './sora.service'
import { FileInterceptor } from '@nestjs/platform-express'

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

  @Get('characters')
  getCharacters(
    @Query('tokenId') tokenId: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: any,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) || undefined : undefined
    return this.service.getCharacters(String(req.user.sub), tokenId, cursor, parsedLimit)
  }

  @Get('characters/delete')
  deleteCharacter(
    @Query('tokenId') tokenId: string,
    @Query('characterId') characterId: string,
    @Req() req: any,
  ) {
    return this.service.deleteCharacter(String(req.user.sub), tokenId, characterId)
  }

  @Post('characters/check-username')
  checkCharacterUsername(
    @Body() body: { tokenId?: string; username: string },
    @Req() req: any,
  ) {
    const { tokenId, username } = body
    return this.service.checkCharacterUsername(String(req.user.sub), tokenId, username)
  }

  @Post('characters/update')
  updateCharacter(
    @Body()
    body: {
      tokenId: string
      characterId: string
      username?: string
      display_name?: string | null
      profile_asset_pointer?: any
    },
    @Req() req: any,
  ) {
    const { tokenId, characterId, ...rest } = body
    return this.service.updateCharacter(String(req.user.sub), tokenId, characterId, rest)
  }

  @Post('characters/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadCharacterVideo(
    @Body() body: { tokenId: string; timestamps: string },
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    const { tokenId, timestamps } = body
    if (!file) {
      throw new Error('file is required')
    }
    const [startStr, endStr] = (timestamps || '').split(',')
    const start = Number(startStr) || 0
    const end = Number(endStr) || 0
    return this.service.uploadCharacterVideo(String(req.user.sub), tokenId, file, [start, end])
  }

  @Get('cameos/in-progress')
  getCameoInProgress(
    @Query('tokenId') tokenId: string,
    @Query('id') id: string,
    @Req() req: any,
  ) {
    return this.service.getCameoStatus(String(req.user.sub), tokenId, id)
  }

  @Post('characters/finalize')
  finalizeCharacter(
    @Body()
    body: {
      tokenId: string
      cameo_id: string
      username: string
      display_name: string
      profile_asset_pointer: any
    },
    @Req() req: any,
  ) {
    const { tokenId, ...rest } = body
    return this.service.finalizeCharacter(String(req.user.sub), tokenId, rest)
  }

  @Post('cameos/set-public')
  setCameoPublic(
    @Body() body: { tokenId: string; cameoId: string },
    @Req() req: any,
  ) {
    const { tokenId, cameoId } = body
    return this.service.setCameoPublic(String(req.user.sub), tokenId, cameoId)
  }

  @Post('profile/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadProfileAsset(
    @Body() body: { tokenId: string },
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    const { tokenId } = body
    if (!file) {
      throw new Error('file is required')
    }
    return this.service.uploadProfileAsset(String(req.user.sub), tokenId, file)
  }
}
