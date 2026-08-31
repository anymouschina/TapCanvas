export type DeclaredClipScene = {
  sceneName?: unknown;
};

export function buildDeclaredClipSceneData(
  clip: DeclaredClipScene | undefined,
): Record<string, string> {
  const sceneName = typeof clip?.sceneName === "string" ? clip.sceneName.trim() : "";
  return sceneName ? { sceneName } : {};
}
