import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { AiService } from './ai.service'
import type { ChatRequestDto } from './dto/chat.dto'

@UseGuards(JwtGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('chat')
  chat(@Body() body: ChatRequestDto, @Req() req: any) {
    return this.aiService.chat(String(req.user.sub), body)
  }
}
