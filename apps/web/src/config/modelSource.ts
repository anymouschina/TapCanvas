// Track model sources discovered at runtime so downstream logic can pick vendors correctly.
const anthropicIds = new Set<string>()

export function markAnthropicModels(models: Array<string | undefined>) {
  models.forEach((id) => {
    if (id) anthropicIds.add(id)
  })
}

export function isAnthropicModel(id?: string | null): boolean {
  if (!id) return false
  if (anthropicIds.has(id)) return true
  return false
}
