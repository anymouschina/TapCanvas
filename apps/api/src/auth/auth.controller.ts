import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { AuthService } from './auth.service'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Frontend callback handler: /oauth/github?code=...
  @Get('github/callback')
  async callback(@Query('code') code: string) {
    return this.auth.exchangeGithubCode(code)
  }

  // Direct exchange endpoint
  @Post('github/exchange')
  async exchange(@Body() body: { code: string }) {
    return this.auth.exchangeGithubCode(body.code)
  }

  @Post('guest')
  async createGuest(@Body() body: { nickname?: string }) {
    return this.auth.createGuestUser(body?.nickname)
  }
}
