import type { Entity } from '../model.ts';
import { assetParameters } from './parameters.ts';
/** Scale supported shape fields before joints and meshes are built, never the stored preset. */
export function animalShape<S extends object>(entity: Pick<Entity, 'asset' | 'assetParameters'>, profile: S): S {
    const values = assetParameters(entity), shape = { ...profile };
    for (const key of Object.keys(shape) as Array<keyof S>) {
        const value = shape[key], ratio = values[String(key) + 'Ratio'];
        if (typeof value === 'number' && ratio !== undefined) shape[key] = value * ratio as S[keyof S];
    }
    return shape;
}
