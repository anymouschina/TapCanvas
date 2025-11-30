export type PromptSampleNodeKind = 'image' | 'composeVideo' | 'storyboard'

export interface PromptSamplePayloadDto {
  scene: string
  commandType: string
  title: string
  nodeKind: PromptSampleNodeKind
  prompt: string
  description?: string
  inputHint?: string
  outputNote?: string
  keywords?: string[]
}

export interface PromptSampleResponseDto extends PromptSamplePayloadDto {
  id: string
  source: 'official' | 'custom'
}

export interface PromptSampleParseRequestDto {
  rawPrompt: string
  nodeKind?: PromptSampleNodeKind
  model?: string
  provider?: string
  baseUrl?: string | null
}
