import type { Entity } from '../model.ts';
import { HUMAN_PROPORTIONS } from './catalog/humans.ts';
import { BODY_OUTFITS, HEADWEAR, HUMAN_RATIO_FIELDS } from './catalog/human-options.ts';
import { assetParameters } from './parameters.ts';

export function humanShape(entity: Pick<Entity, 'asset' | 'assetParameters'>) {
    const base = HUMAN_PROPORTIONS[entity.asset];
    if (!base) return undefined;
    const values = assetParameters(entity), proportions = { ...base };
    for (const key of Object.keys(HUMAN_RATIO_FIELDS) as Array<keyof typeof HUMAN_RATIO_FIELDS>) proportions[key] *= values[key + 'Ratio'];
    const costumes = [BODY_OUTFITS[values.outfit], HEADWEAR[values.headwear], values.backpack ? 'backpack' as const : undefined].filter(value => value !== undefined);
    return { proportions, costumes, length: values.outfitLength, thickness: values.outfitThickness };
}
