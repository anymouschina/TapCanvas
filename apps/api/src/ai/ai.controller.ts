import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { AiService } from './ai.service'
import type { ChatRequestDto } from './dto/chat.dto'
import type { Response } from 'express'

@UseGuards(JwtGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  chat(@Body() body: ChatRequestDto, @Req() req: any) {
    return this.aiService.chat(String(req.user.sub), body)
  }

  /**
   * 流式聊天（SSE），供前端 useChat 使用
   */
  @Post('chat/stream')
  async chatStream(@Body() body: ChatRequestDto, @Req() req: any, @Res() res: Response) {
    await this.aiService.chatStream(String(req.user.sub), body, res)
  }
}
