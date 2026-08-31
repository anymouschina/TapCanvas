export function hasCreationSessionProgressChanged(
  persistedProgressKey: string,
  acknowledgedProgress: unknown,
): boolean {
  return persistedProgressKey !== JSON.stringify(acknowledgedProgress ?? null)
}
