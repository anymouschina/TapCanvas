export const GRSAI_PROXY_VENDOR = 'grsai'
export const GRSAI_PROXY_UPDATED_EVENT = 'grsai-proxy-updated'

export type GrsaiStatusModel = {
  label: string
  value: string
  group: string
}

export const GRSAI_STATUS_MODELS: GrsaiStatusModel[] = [
  { group: 'Sora 视频', label: 'Sora 2', value: 'sora-2' },
  { group: 'Veo3 视频', label: 'Veo3.1 Fast', value: 'veo3.1-fast' },
  { group: 'Veo3 视频', label: 'Veo3.1 Pro', value: 'veo3.1-pro' },
  { group: 'Veo3 视频', label: 'Veo3 Fast', value: 'veo3-fast' },
  { group: 'Veo3 视频', label: 'Veo3 Pro', value: 'veo3-pro' },
  { group: 'Nano Banana 图片', label: 'Nano Banana', value: 'nano-banana' },
  { group: 'Nano Banana 图片', label: 'Nano Banana Fast', value: 'nano-banana-fast' },
  { group: 'Nano Banana 图片', label: 'Nano Banana Pro', value: 'nano-banana-pro' },
]
