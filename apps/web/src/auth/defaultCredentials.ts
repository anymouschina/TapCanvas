export type DefaultPlatformCredential = Readonly<{
  platform: 'TapCanvas' | 'new-api'
  username: string
  password: string
}>

export const DEFAULT_PLATFORM_CREDENTIALS: readonly DefaultPlatformCredential[] = [
  { platform: 'TapCanvas', username: 'admin', password: '123456' },
  { platform: 'new-api', username: 'admin', password: '123456' },
]
