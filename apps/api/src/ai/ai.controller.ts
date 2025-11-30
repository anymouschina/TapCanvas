import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, Sse, UseGuards } from '@nestjs/common'
import { JwtGuard } from '../auth/jwt.guard'
import { AiService } from './ai.service'
import { IntelligentAiService } from './intelligent-ai.service'
import type { ChatRequestDto, ToolResultDto } from './dto/chat.dto'
import type { PromptSampleParseRequestDto, PromptSamplePayloadDto } from './dto/prompt-sample.dto'
import type { Response } from 'express'

@UseGuards(JwtGuard)
@Controller('ai')
export class AiController {
  constructor(
    private readonly aiService: AiService,
    private readonly intelligentAiService: IntelligentAiService
  ) {}

  @Post('chat')
  chat(@Body() body: ChatRequestDto, @Req() req: any) {
    return this.aiService.chat(String(req.user.sub), body)
  }

  /**
   * 流式聊天（SSE），供前端 useChat 使用
   */
  @Post('chat/stream')
  async chatStream(@Body() body: ChatRequestDto, @Req() req: any, @Res() res: Response) {
    if (body?.intelligentMode) {
      void this.intelligentAiService.runSidecarStreaming(String(req.user.sub), body).catch((err) => {
        // 静默旁路异常，主流仍返回
        console.error('[chat/stream] intelligent sidecar failed', err)
      })
    }
    await this.aiService.chatStream(String(req.user.sub), body, res)
  }

  /**
   * 🧠 智能聊天接口 - 新增的智能版本
   */
  @Post('chat/intelligent')
  async chatIntelligent(@Body() body: ChatRequestDto, @Req() req: any) {
    return this.intelligentAiService.chatIntelligent(String(req.user.sub), body)
  }

  /**
   * 🧠 智能流式聊天接口（已融合到 /ai/chat/stream，通过 intelligentMode 控制）
   */
  @Post('chat/intelligent/stream')
  async chatStreamIntelligent(@Body() body: ChatRequestDto, @Req() req: any, @Res() res: Response) {
    await this.chatStream({ ...body, intelligentMode: true } as ChatRequestDto, req, res)
  }

  @Get('prompt-samples')
  listPromptSamples(
    @Req() req: any,
    @Query('q') q?: string,
    @Query('nodeKind') nodeKind?: string,
    @Query('source') source?: string,
  ) {
    return this.aiService.listPromptSamples(String(req.user.sub), q, nodeKind, source)
  }

  @Post('prompt-samples/parse')
  parsePromptSample(@Req() req: any, @Body() body: PromptSampleParseRequestDto) {
    return this.aiService.parsePromptSample(String(req.user.sub), body)
  }

  @Post('prompt-samples')
  createPromptSample(@Req() req: any, @Body() body: PromptSamplePayloadDto) {
    return this.aiService.createPromptSample(String(req.user.sub), body)
  }

  @Patch('prompt-samples/:id')
  updatePromptSample(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: PromptSamplePayloadDto,
  ) {
    return this.aiService.updatePromptSample(String(req.user.sub), id, body)
  }

  @Delete('prompt-samples/:id')
  deletePromptSample(@Req() req: any, @Param('id') id: string) {
    return this.aiService.deletePromptSample(String(req.user.sub), id)
  }

  @Sse('tool-events')
  toolEvents(@Req() req: any) {
    return this.aiService.subscribeToolEvents(String(req.user.sub))
  }

  @Post('tools/result')
  async toolResult(@Body() body: ToolResultDto, @Req() req: any) {
    await this.aiService.handleToolResult(String(req.user.sub), body)
    return { success: true }
  }

  /**
   * 🧠 获取智能系统统计信息
   */
  @Get('intelligent/stats')
  getIntelligentStats() {
    return {
      capabilities: this.intelligentAiService.getStatistics(),
      timestamp: new Date()
    }
  }

  /**
   * 🧠 清理智能会话
   */
  @Post('intelligent/clear')
  clearIntelligentSession(@Req() req: any) {
    this.intelligentAiService.clearSession()
    return { success: true, message: '智能会话已清理' }
  }
}
