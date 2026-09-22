import type { AssetDefinition } from './types.ts';
import { lengthField } from './architecture.ts';
export const ROOM_PARTS = ['floor', 'north', 'south', 'east', 'west', 'ceiling'] as const;
export const ROOM_PART_NAMES = ['地板', '北墙', '南墙 · 门洞', '东墙', '西墙 · 窗洞', '天花板'] as const;
export const ROOM_PART_ASSETS: readonly AssetDefinition[] = [{
    id: 'room-part', name: '房间外壳部件', kind: 'prop', group: '建筑构件', icon: '▥', family: 'room-part-v1',
    aliases: ['房间', '墙', '地板', '天花板', 'room'],
    capabilities: { rig: 'none', actions: [], pose: false, path: true },
    parameters: {
        width: lengthField('房间宽度', 4.8, 2.3, 10000), depth: lengthField('房间进深', 4.2, 2.3, 10000),
        height: lengthField('房间高度', 2.8, 2.3, 10000),
        part: { label: '部件', default: 0, min: 0, max: 5, step: 1, integer: true, choices: Object.fromEntries(ROOM_PART_NAMES.map((name, i) => [i, name])) },
    },
}];
