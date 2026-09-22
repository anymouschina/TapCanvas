import type { Entity } from '../model.ts';
import { findAsset } from '../asset-catalog.ts';
import { makeProp as makeLegacyProp } from './props-legacy.ts';
import { makeShape } from './shapes.ts';
import { makeFurniture } from './furniture/index.ts';
import { makeHandProp } from './hand-props.ts';
import { makeArchitecture } from './architecture.ts';
import { makeCirculation } from './circulation.ts';
import { makeRoad } from './roads.ts';
import { makePlant } from './plants.ts';
import { makeTerrain } from './terrain.ts';
import { makeBuilding } from './buildings.ts';
import { makeIndustrial } from './industrial.ts';
import { makeThemed } from './themed.ts';
import { makeVehicle } from './vehicles.ts';
import { makeRoomPart } from './room-part.ts';
import { makeVisual } from '../visuals/runtime.ts';
import { makeLight } from '../lighting/runtime.ts';

export function makeProp(e: Entity) {
    if(e.visual||e.field||e.warp)return makeVisual(e);
    if (e.light) return makeLight(e);
    if (e.asset === 'room-part') return makeRoomPart(e);
    if (findAsset(e.asset)?.family === 'industrial-v1') return makeIndustrial(e);
    if (findAsset(e.asset)?.family === 'themed-v1') return makeThemed(e);
    if (findAsset(e.asset)?.family === 'vehicle-v1') return makeVehicle(e);
    if (findAsset(e.asset)?.family === 'plant-v1') return makePlant(e);
    if (findAsset(e.asset)?.family === 'terrain-v1') return makeTerrain(e);
    if (findAsset(e.asset)?.family === 'building-v1') return makeBuilding(e);
    if (findAsset(e.asset)?.family === 'architecture-v1') return makeArchitecture(e);
    if (findAsset(e.asset)?.family === 'circulation-v1') return makeCirculation(e);
    if (findAsset(e.asset)?.family === 'road-v1') return makeRoad(e);
    if (findAsset(e.asset)?.family === 'shape-v1') return makeShape(e);
    if (findAsset(e.asset)?.family === 'furniture-v1') return makeFurniture(e);
    if (findAsset(e.asset)?.family === 'hand-prop-v1') return makeHandProp(e);
    return makeLegacyProp(e);
}
