import type { Entity } from '../model.ts';
import { findAsset, isAnimalAsset } from '../asset-catalog.ts';
import { makeHuman } from './humanoid.ts';
import { animateHuman } from './human-animation.ts';
import { makeQuadruped } from './quadruped.ts';
import { makeCreature } from './creatures.ts';
import { poseAnimal } from './rig-pose.ts';
import type { Rig } from './human-legacy.ts';

export const isQuadruped = (e: Pick<Entity, 'asset'>) => findAsset(e.asset)?.capabilities?.rig === 'quadruped';
export function makeActor(e: Entity): Rig { return isQuadruped(e) ? makeQuadruped(e) : isAnimalAsset(e.asset) ? makeCreature(e) : makeHuman(e); }
export function animateActor(rig: Rig, e: Entity, time: number) {
    if (isAnimalAsset(e.asset)) poseAnimal(rig, e, time);
    else animateHuman(rig, e, time);
}
