import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { SoraUploadProxyService } from './sora-upload.service'

@Controller('backend/project_y')
export class SoraUploadController {
  constructor(private readonly uploadService: SoraUploadProxyService) {}

  @Post('file/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Headers('authorization') authorization: string | undefined,
    @UploadedFile() file: any,
    @Body('use_case') useCase: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!file) {
      throw new BadRequestException('file is required')
    }
    if (!authorization || authorization.trim().length === 0) {
      throw new UnauthorizedException('Authorization: Bearer <sora access token> is required')
    }

    const result = await this.uploadService.uploadFilePassthrough({
      authHeader: authorization,
      file,
      useCase: useCase || 'profile',
    })

    res.status(result.status)
    return result.data
  }
}
