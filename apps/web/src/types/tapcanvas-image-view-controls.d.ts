declare module '@tapcanvas/image-view-controls' {
  export type ImageCameraPresetId =
    | 'front'
    | 'left'
    | 'right'
    | 'back'
    | 'left45'
    | 'right45'
    | 'topDown'
    | 'lowAngle'

  export type ImageLightPresetId =
    | 'left'
    | 'top'
    | 'right'
    | 'topLeft'
    | 'front'
    | 'topRight'
    | 'bottom'
    | 'back'

  export type ImageCameraPreset = {
    id: ImageCameraPresetId
    label: string
    azimuthDeg: number
    elevationDeg: number
  }

  export type ImageLightPreset = {
    id: ImageLightPresetId
    label: string
    azimuthDeg: number
    elevationDeg: number
  }

  export type ImageCameraControlConfig = {
    enabled: boolean
    presetId: ImageCameraPresetId
    azimuthDeg: number
    elevationDeg: number
    distance: number
  }

  export type ImageLightControlConfig = {
    enabled: boolean
    presetId: ImageLightPresetId
    azimuthDeg: number
    elevationDeg: number
    intensity: number
    colorHex: string
  }

  export type ImageLightingRigConfig = {
    main: ImageLightControlConfig
    fill: ImageLightControlConfig
  }

  export const IMAGE_CAMERA_PRESETS: ImageCameraPreset[]
  export const IMAGE_LIGHT_PRESETS: ImageLightPreset[]
  export const DEFAULT_IMAGE_CAMERA_CONTROL: ImageCameraControlConfig
  export const DEFAULT_IMAGE_LIGHT_CONTROL: ImageLightControlConfig
  export const DEFAULT_IMAGE_LIGHTING_RIG: ImageLightingRigConfig

  export function normalizeImageCameraControl(value: unknown): ImageCameraControlConfig
  export function normalizeImageLightingRig(value: unknown): ImageLightingRigConfig
  export function hasActiveImageCameraControl(value: unknown): boolean
  export function hasActiveImageLightingRig(value: unknown): boolean
  export function buildImageCameraPrompt(value: unknown): string
  export function buildImageLightingPrompt(value: unknown): string
  export function appendImageViewPrompt(
    prompt: string,
    input: {
      cameraControl?: unknown
      lightingRig?: unknown
    },
  ): string

  const imageViewControlsModule: {
    IMAGE_CAMERA_PRESETS: ImageCameraPreset[]
    IMAGE_LIGHT_PRESETS: ImageLightPreset[]
    DEFAULT_IMAGE_CAMERA_CONTROL: ImageCameraControlConfig
    DEFAULT_IMAGE_LIGHT_CONTROL: ImageLightControlConfig
    DEFAULT_IMAGE_LIGHTING_RIG: ImageLightingRigConfig
    normalizeImageCameraControl: (value: unknown) => ImageCameraControlConfig
    normalizeImageLightingRig: (value: unknown) => ImageLightingRigConfig
    hasActiveImageCameraControl: (value: unknown) => boolean
    hasActiveImageLightingRig: (value: unknown) => boolean
    buildImageCameraPrompt: (value: unknown) => string
    buildImageLightingPrompt: (value: unknown) => string
    appendImageViewPrompt: (
      prompt: string,
      input: {
        cameraControl?: unknown
        lightingRig?: unknown
      },
    ) => string
  }

  export default imageViewControlsModule
}
