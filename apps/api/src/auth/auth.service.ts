import { Injectable } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { JwtService } from '@nestjs/jwt'
import axios, { AxiosInstance } from 'axios'
import { PrismaService } from 'nestjs-prisma'

@Injectable()
export class AuthService {
  private readonly http: AxiosInstance

  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {
    const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.DEV_PROXY

    if (proxyUrl) {
      try {
        const parsed = new URL(proxyUrl)
        this.http = axios.create({
          proxy: {
            host: parsed.hostname,
            port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
            protocol: (parsed.protocol.replace(':', '') || 'http') as 'http' | 'https',
          },
        })
      } catch {
        this.http = axios
      }
    } else {
      this.http = axios
    }
  }

  async exchangeGithubCode(code: string) {
    const client_id = process.env.GITHUB_CLIENT_ID || ''
    const client_secret = process.env.GITHUB_CLIENT_SECRET || ''
    const tokenResp = await this.http.post(
      'https://github.com/login/oauth/access_token',
      { client_id, client_secret, code },
      { headers: { Accept: 'application/json' } },
    )
    const access_token = tokenResp.data?.access_token as string
    if (!access_token) throw new Error('no access token')
    const user = (
      await this.http.get('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${access_token}`, Accept: 'application/vnd.github+json' },
      })
    ).data
    const emailRes = await this.http
      .get('https://api.github.com/user/emails', { headers: { Authorization: `Bearer ${access_token}` } })
      .catch(() => ({ data: [] }))
    const primaryEmail = Array.isArray(emailRes.data) ? (emailRes.data.find((e: any) => e.primary)?.email || emailRes.data[0]?.email) : undefined
    // upsert user
    await this.prisma.user.upsert({
      where: { id: String(user.id) },
      update: { login: user.login, name: user.name || user.login, avatarUrl: user.avatar_url, email: primaryEmail || undefined },
      create: { id: String(user.id), login: user.login, name: user.name || user.login, avatarUrl: user.avatar_url, email: primaryEmail || undefined },
    })
    const payload = { sub: String(user.id), login: user.login, name: user.name, avatarUrl: user.avatar_url, email: primaryEmail, guest: false }
    const token = await this.jwt.signAsync(payload)
    return { token, user: payload }
  }

  async createGuestUser(nickname?: string) {
    const id = randomUUID()
    const trimmed = typeof nickname === 'string' ? nickname.trim().slice(0, 32) : ''
    const normalizedLogin = trimmed ? trimmed.replace(/[^\w-]/g, '').toLowerCase() : ''
    const login = normalizedLogin || `guest_${id.slice(0, 8)}`
    const name = trimmed || `Guest ${id.slice(0, 4).toUpperCase()}`
    await this.prisma.user.create({
      data: {
        id,
        login,
        name,
        avatarUrl: null,
        email: null,
      },
    })
    const payload = { sub: id, login, name, guest: true }
    const token = await this.jwt.signAsync(payload)
    return { token, user: payload }
  }
}
