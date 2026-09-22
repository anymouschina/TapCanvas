export const READ_SECTIONS = ['entities', 'scene', 'cuts', 'production', 'references', 'resources', 'statistics', 'selection'] as const;
export type ReadSection = typeof READ_SECTIONS[number];
export type SceneReadOptions = { ids?: string[]; details?: boolean; resourceId?: string; sections?: (ReadSection | 'all')[] };

