export type ChatRequestAssetScopeInput = {
  projectTextIsolation: boolean
  explicitCanvasNodeId: string
}

/**
 * Selected canvas assets belong only to an ordinary free-form chat turn.
 * An explicit node command already declares its authoritative source node;
 * carrying a stale selection into that request would widen the user's scope.
 */
export function shouldAttachSelectedCanvasAssets(
  input: ChatRequestAssetScopeInput,
): boolean {
  return !input.projectTextIsolation && input.explicitCanvasNodeId.length === 0
}
