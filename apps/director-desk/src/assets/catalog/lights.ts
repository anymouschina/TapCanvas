import type { AssetDefinition } from './types.ts';
import { LIGHT_TYPES, defaultLight } from '../../lighting/model.ts';
export const LIGHT_ASSETS: readonly AssetDefinition[] = Object.entries(LIGHT_TYPES).map(([id, name]) => ({
    id, name, kind: 'prop', group: '灯光', family: 'light-v1', icon: '☼',
    aliases: [id.slice(6), 'light', 'lighting', '灯', '光源'],
    capabilities: { rig: 'none', actions: [], pose: false, path: true },
    defaults: { light: defaultLight(id), color: '#ffffff' },
}));
