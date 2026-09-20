export type SceneReferenceCard = Readonly<{
  spacePrompt: string;
  negativePrompt: string;
  sceneProfileVersion: 'scene-card/v1';
  sceneAssetRole: 'space_anchor';
  sceneOccupancy: 'none';
  sceneLightingSpec: Readonly<{
    version: 'scene-lighting/v1';
    narrativeIntent: string;
    keySource: string;
    direction: string;
    colorTemperature: string;
    lightQuality: string;
    shadowBehavior: string;
    atmosphereInteraction: string;
    reflectiveBehavior: string;
    practicalSources: readonly string[];
    continuityLocks: readonly string[];
  }>;
}>;
export const sceneReferenceCardSchema: Record<string, unknown>;
export function inspectSceneReferencePlan(value: unknown, path?: string, stage?: 'authored' | 'projected'): string | null;
export function projectSceneReferenceMetadata(value: unknown, path?: string): Omit<SceneReferenceCard, 'spacePrompt' | 'negativePrompt'> & Readonly<{
  referenceType: 'scene';
  sceneAnchors: readonly string[];
  prohibitedSceneDrift: readonly string[];
}>;

export function inspectRegisteredAssetPlans(value: unknown): string | null;
