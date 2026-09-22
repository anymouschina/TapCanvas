import type { AssetDefinition } from './types.ts';
import { creatureParameterSchema } from './animal-options.ts';
import { BIRD_JOINTS, FISH_JOINTS, SERPENT_JOINTS } from '../joint-schema.ts';

export interface CreatureShape {
    rig: 'bird' | 'fish' | 'serpent';
    species: 'chicken' | 'duck' | 'pigeon' | 'eagle' | 'pterosaur' | 'fish' | 'shark' | 'snake';
    height: number; body: number; width: number; leg: number; neck: number; wing: number;
}
const presets: Array<{ name: string; aliases: string[]; shape: CreatureShape }> = [
    { name: '鸡', aliases: ['家禽', 'chicken'], shape: { rig: 'bird', species: 'chicken', height: .5, body: .5, width: .18, leg: .18, neck: .22, wing: .24 } },
    { name: '鸭', aliases: ['家禽', 'duck'], shape: { rig: 'bird', species: 'duck', height: .45, body: .65, width: .2, leg: .12, neck: .2, wing: .28 } },
    { name: '鸽子', aliases: ['飞鸟', 'pigeon'], shape: { rig: 'bird', species: 'pigeon', height: .3, body: .5, width: .14, leg: .13, neck: .12, wing: .32 } },
    { name: '鹰', aliases: ['猛禽', 'eagle'], shape: { rig: 'bird', species: 'eagle', height: .8, body: .7, width: .22, leg: .22, neck: .12, wing: .85 } },
    { name: '翼龙轮廓', aliases: ['幻想生物', 'pterosaur'], shape: { rig: 'bird', species: 'pterosaur', height: 1.6, body: .85, width: .22, leg: .3, neck: .45, wing: 1.65 } },
    { name: '鱼', aliases: ['游鱼', 'fish'], shape: { rig: 'fish', species: 'fish', height: .28, body: .8, width: .15, leg: 0, neck: 0, wing: .18 } },
    { name: '鲨鱼', aliases: ['水生', 'shark'], shape: { rig: 'fish', species: 'shark', height: .9, body: 2.2, width: .27, leg: 0, neck: 0, wing: .6 } },
    { name: '蛇', aliases: ['爬虫', 'snake'], shape: { rig: 'serpent', species: 'snake', height: .12, body: 2.0, width: .055, leg: 0, neck: 0, wing: 0 } },
];
export const CREATURE_SHAPES: Readonly<Record<string, CreatureShape>> = Object.fromEntries(presets.map(p => ['animal-' + p.shape.species, p.shape]));
export const CREATURE_ASSETS: readonly AssetDefinition[] = presets.map(p => ({
    id: 'animal-' + p.shape.species, name: p.name, aliases: p.aliases, kind: 'actor', group: '飞禽水生幻想', icon: '♧', family: p.shape.rig + '-v1',
    defaults: { height: p.shape.height }, capabilities: { rig: p.shape.rig, actions: ['idle'], pose: true, path: true },
    parameters: creatureParameterSchema(p.shape),
    joints: p.shape.rig === 'bird' ? BIRD_JOINTS : p.shape.rig === 'fish' ? FISH_JOINTS : SERPENT_JOINTS,
}));
