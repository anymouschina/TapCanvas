declare module '@tapcanvas/image-prompt-spec' {
  export type ImagePromptSpecV2 = {
    version: 'v2'
    shotIntent: string
    spatialLayout: string[]
    subjectRelations: string[]
    referenceBindings?: string[]
    identityConstraints?: string[]
    environmentObjects: string[]
    cameraPlan: string[]
    lightingPlan: string[]
    styleConstraints: string[]
    continuityConstraints: string[]
    negativeConstraints: string[]
  }

  export type ImagePromptSpecV2ParseResult =
    | { ok: true; value: ImagePromptSpecV2 | null }
    | { ok: false; error: string }

  export const IMAGE_PROMPT_SPEC_V2_VERSION: 'v2'
  export const IMAGE_PROMPT_SPEC_MAX_LIST_ITEMS: number
  export const IMAGE_PROMPT_SPEC_MAX_TEXT_LENGTH: number
  export function parseImagePromptSpecV2(input: unknown): ImagePromptSpecV2ParseResult
  export function compileImagePromptSpecV2(spec: ImagePromptSpecV2 | null): string

  const imagePromptSpecModule: {
    IMAGE_PROMPT_SPEC_V2_VERSION: 'v2'
    IMAGE_PROMPT_SPEC_MAX_LIST_ITEMS: number
    IMAGE_PROMPT_SPEC_MAX_TEXT_LENGTH: number
    parseImagePromptSpecV2: (input: unknown) => ImagePromptSpecV2ParseResult
    compileImagePromptSpecV2: (spec: ImagePromptSpecV2 | null) => string
  }

  export default imagePromptSpecModule
}
