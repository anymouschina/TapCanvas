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

  @Post('video/publish')
  publishVideo(
    @Body()
    body: {
      tokenId?: string
      taskId: string
      postText?: string
      generationId?: string
    },
    @Req() req: any,
  ) {
    const { tokenId, taskId, postText, generationId } = body
    return this.service.publishVideo(String(req.user.sub), tokenId, taskId, postText, generationId)
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

  @Post('video/create')
  createVideo(
    @Body()
    body: {
      tokenId?: string
      prompt: string
      orientation?: 'portrait' | 'landscape' | 'square'
      size?: string
      n_frames?: number
      remixTargetId?: string
      inpaintFileId?: string
      imageUrl?: string
      operation?: string
      title?: string
    },
    @Req() req: any,
  ) {
    const { tokenId, ...rest } = body

    // 记录控制器层收到的请求
    console.log('SoraController.createVideo: Received request', {
      userId: req.user?.sub,
      tokenId,
      body: {
        prompt: body.prompt,
        orientation: body.orientation,
        size: body.size,
        n_frames: body.n_frames,
        remixTargetId: body.remixTargetId,
        operation: body.operation,
        title: body.title,
      }
    })

    return this.service.createVideoTask(String(req.user.sub), tokenId, rest)
  }

  @Get('mentions')
  searchMentions(
    @Query('tokenId') tokenId: string | undefined,
    @Query('username') username: string | undefined,
    @Query('intent') intent: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: any,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) || 10 : 10
    return this.service.searchMentions(
      String(req.user.sub),
      tokenId,
      username || '',
      intent || 'cameo',
      parsedLimit,
    )
  }

  @Get('video/pending')
  getPendingVideos(
    @Query('tokenId') tokenId: string | undefined,
    @Req() req: any,
  ) {
    return this.service.getPendingVideos(String(req.user.sub), tokenId)
  }

  @Get('video/history')
  getVideoHistory(
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: any,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) || undefined : undefined
    const parsedOffset = offset ? parseInt(offset, 10) || undefined : undefined
    return this.service.getVideoHistory(String(req.user.sub), {
      limit: parsedLimit,
      offset: parsedOffset,
      status: status || undefined,
    })
  }

  @Get('video/draft-by-task')
  getVideoDraftByTask(
    @Query('tokenId') tokenId: string | undefined,
    @Query('taskId') taskId: string,
    @Req() req: any,
  ) {
    return this.service.getDraftByTaskId(String(req.user.sub), tokenId, taskId)
  }

  @Get('video/draft-details')
  getDraftDetails(
    @Query('tokenId') tokenId: string | undefined,
    @Query('generationId') generationId: string,
    @Req() req: any,
  ) {
    return this.service.getDraftDetailsById(String(req.user.sub), tokenId, generationId)
  }

  @Get('video/post-details')
  getPostDetails(
    @Query('tokenId') tokenId: string | undefined,
    @Query('postId') postId: string,
    @Req() req: any,
  ) {
    return this.service.getPostDetailsById(String(req.user.sub), tokenId, postId)
  }

  @Post('video/unwatermark')
  unwatermarkVideo(
    @Body() body: { url: string },
    @Req() req: any,
  ) {
    const soraUrl = (body?.url || '').trim()
    if (!soraUrl) {
      throw new Error('url is required')
    }
    return this.service.unwatermarkVideo(String(req.user.sub), soraUrl)
  }

  @Post('upload/image')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @Body() body: { tokenId?: string },
    @UploadedFile() file: any,
    @Req() req: any,
  ) {
    const { tokenId } = body
    if (!file) {
      throw new Error('file is required')
    }
    return this.service.uploadImage(String(req.user.sub), tokenId, file)
  }

  @Get('published/me')
  getPublishedVideos(
    @Query('tokenId') tokenId: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: any,
  ) {
    const parsedLimit = limit ? parseInt(limit, 10) || 8 : 8
    return this.service.getMyPublishedVideos(String(req.user.sub), tokenId, parsedLimit)
  }
}
