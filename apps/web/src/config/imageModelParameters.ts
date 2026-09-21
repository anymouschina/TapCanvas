export type ImageParameterValue = string | number | boolean
export type ImageParameterValues = Record<string, ImageParameterValue>
export type ImageParameterSpec = {
  key: string
  label: string
  type: 'string' | 'integer' | 'float' | 'number' | 'boolean'
  default?: ImageParameterValue
  min?: number
  max?: number
  step?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function readImageParameterSpecs(meta: unknown): ImageParameterSpec[] {
  if (!isRecord(meta) || !Array.isArray(meta.runtimeParameters)) return []
  return meta.runtimeParameters.flatMap((value): ImageParameterSpec[] => {
    if (!isRecord(value) || value.scope !== 'image_advanced') return []
    if (typeof value.key !== 'string' || !value.key || typeof value.label !== 'string') return []
    const type = value.type
    if (type !== 'string' && type !== 'integer' && type !== 'float' && type !== 'number' && type !== 'boolean') return []
    return [{
      key: value.key, label: value.label, type,
      ...(typeof value.default === 'string' || typeof value.default === 'number' || typeof value.default === 'boolean'
        ? { default: value.default } : {}),
      ...(typeof value.min === 'number' ? { min: value.min } : {}),
      ...(typeof value.max === 'number' ? { max: value.max } : {}),
      ...(typeof value.step === 'number' ? { step: value.step } : {}),
    }]
  })
}

export function imageQuantityUnit(meta: unknown): '张' | '组' {
  if (!isRecord(meta) || !Array.isArray(meta.runtimeParameters)) return '张'
  return meta.runtimeParameters.some((value) => isRecord(value) && value.key === 'n' && value.scope === 'submission') ? '组' : '张'
}

export function readImageParameterValues(nodeData: unknown, modelKey: string): ImageParameterValues {
  if (!isRecord(nodeData) || !isRecord(nodeData.imageModelParameters)) return {}
  const values = nodeData.imageModelParameters[modelKey]
  if (!isRecord(values)) return {}
  return Object.fromEntries(Object.entries(values).filter((entry): entry is [string, ImageParameterValue] =>
    typeof entry[1] === 'string' || typeof entry[1] === 'boolean'
      || (typeof entry[1] === 'number' && Number.isFinite(entry[1])),
  ))
}

export function updateImageParameterValues(nodeData: unknown, modelKey: string, key: string, value: ImageParameterValue): Record<string, unknown> {
  const stored = isRecord(nodeData) && isRecord(nodeData.imageModelParameters) ? nodeData.imageModelParameters : {}
  return { ...stored, [modelKey]: { ...readImageParameterValues(nodeData, modelKey), [key]: value } }
}

export function imageModelParameterExtras(nodeData: unknown, modelKey: string): { modelParameters?: ImageParameterValues } {
  const values = readImageParameterValues(nodeData, modelKey)
  return Object.keys(values).length > 0 ? { modelParameters: values } : {}
}
