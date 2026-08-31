/**
 * 豆包语音（seed-audio）富音色目录服务
 * 从 hono /public/audio/doubao-voices 拉取火山 seed-tts-2.0 在线音色（含头像 + 试听），
 * 内存缓存 30min + inflight 去重；失败/为空时回落静态库 DOUBAO_SEED_AUDIO_VOICES
 * （无头像/试听，仍可选音色）。
 */
import { fetchDoubaoSeedAudioVoices, type DoubaoSeedAudioVoiceDto } from '../../api/server'
import { DOUBAO_SEED_AUDIO_VOICES } from './doubaoSeedAudioVoices'

export type SeedAudioVoice = {
  id: string
  name: string
  avatar: string
  trialUrl: string
  gender: string
  age: string
  scene: string
  description: string
}

let cached: SeedAudioVoice[] | null = null
let cacheTimestamp = 0
let inflight: Promise<SeedAudioVoice[]> | null = null
const CACHE_TTL = 30 * 60 * 1000 // 30 分钟

/** 静态库映射成统一形状（无头像/试听；描述位放语种信息）。 */
function staticFallback(): SeedAudioVoice[] {
  return DOUBAO_SEED_AUDIO_VOICES.map((v) => ({
    id: v.id,
    name: v.name,
    avatar: '',
    trialUrl: '',
    gender: '',
    age: '',
    scene: v.scene,
    description: v.lang || '',
  }))
}

function normalize(raw: DoubaoSeedAudioVoiceDto): SeedAudioVoice | null {
  const id = typeof raw?.id === 'string' ? raw.id : ''
  if (!id) return null
  return {
    id,
    name: typeof raw.name === 'string' && raw.name ? raw.name : id,
    avatar: typeof raw.avatar === 'string' ? raw.avatar : '',
    trialUrl: typeof raw.trialUrl === 'string' ? raw.trialUrl : '',
    gender: typeof raw.gender === 'string' ? raw.gender : '',
    age: typeof raw.age === 'string' ? raw.age : '',
    scene: typeof raw.scene === 'string' && raw.scene ? raw.scene : '通用场景',
    description: typeof raw.description === 'string' ? raw.description : '',
  }
}

/** 拉取动态音色目录；失败或为空回落静态库。 */
export async function fetchSeedAudioVoices(): Promise<SeedAudioVoice[]> {
  if (cached && Date.now() - cacheTimestamp < CACHE_TTL) {
    return cached
  }
  if (inflight) return inflight

  inflight = (async () => {
    try {
      const raw = await fetchDoubaoSeedAudioVoices()
      const list = raw
        .map(normalize)
        .filter((v): v is SeedAudioVoice => v !== null)
      if (list.length === 0) {
        return staticFallback()
      }
      cached = list
      cacheTimestamp = Date.now()
      return list
    } catch {
      return staticFallback()
    } finally {
      inflight = null
    }
  })()

  return inflight
}
