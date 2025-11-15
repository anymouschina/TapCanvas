import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from 'nestjs-prisma'

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest()
    const auth = req.headers['authorization'] as string | undefined
    if (!auth || !auth.startsWith('Bearer ')) throw new UnauthorizedException('missing token')
    const token = auth.slice(7)
    try {
      const payload = await this.jwt.verifyAsync(token)
      // Ensure the user record exists for this JWT subject.
      const userId = String(payload.sub)
      const login = (payload as any).login || userId
      const name = (payload as any).name || login
      const avatarUrl = (payload as any).avatarUrl || null
      const email = (payload as any).email || null
      await this.prisma.user.upsert({
        where: { id: userId },
        update: { login, name, avatarUrl, email },
        create: { id: userId, login, name, avatarUrl, email },
      })
      req.user = payload
      return true
    } catch {
      throw new UnauthorizedException('invalid token')
    }
  }
}
