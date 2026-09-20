/** User-required scene-card suffix. Exact suffix comparison only. */
export function appendSceneCardConstraint(prompt: string, referenceType: unknown): string {
  if (referenceType !== 'scene') return prompt
  const text = prompt.trim()
  return text.endsWith('不要出现人物') ? text : `${text}\n不要出现人物`
}
