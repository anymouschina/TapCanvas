import type { ModelOption } from '../config/models'
import { findModelOptionByIdentifier } from '../config/useModelOptions'

export type PromptSourceModel = Readonly<{
  slug: string
  name: string
}>

function canonicalModelIdentifier(value: string): string {
  let canonical = ''
  for (const character of value.trim().toLowerCase()) {
    const codePoint = character.codePointAt(0)
    if (codePoint === undefined) continue
    const asciiDigit = codePoint >= 48 && codePoint <= 57
    const asciiLetter = codePoint >= 97 && codePoint <= 122
    if (asciiDigit || asciiLetter) canonical += character
  }
  return canonical
}

function readModelOptionIdentifiers(option: ModelOption): string[] {
  return [
    option.value,
    option.label,
    option.modelKey ?? '',
    option.modelAlias ?? '',
    ...(option.routingAliases ?? []),
  ].map(canonicalModelIdentifier).filter(Boolean)
}

export function findPromptSourceModelOption(
  options: readonly ModelOption[],
  sourceModels: readonly PromptSourceModel[],
): ModelOption | null {
  for (const sourceModel of sourceModels) {
    const exact = findModelOptionByIdentifier(options, sourceModel.slug)
      ?? findModelOptionByIdentifier(options, sourceModel.name)
    if (exact) return exact
  }

  const sourceIdentifiers = sourceModels
    .flatMap((model) => [model.slug, model.name])
    .map(canonicalModelIdentifier)
    .filter(Boolean)
  const matches = options.filter((option) => {
    const optionIdentifiers = readModelOptionIdentifiers(option)
    return sourceIdentifiers.some((sourceIdentifier) =>
      optionIdentifiers.some((optionIdentifier) => optionIdentifier.endsWith(sourceIdentifier)),
    )
  })
  return matches.length === 1 ? matches[0] ?? null : null
}
