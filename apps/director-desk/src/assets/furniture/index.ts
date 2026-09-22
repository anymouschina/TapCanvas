import type { Entity } from '../../model.ts';
import { FURNITURE_SPECS } from '../catalog/furniture.ts';
import { furnitureBuilder } from './shared.ts';
import { buildSeating } from './seating.ts';
import { buildStorage } from './storage.ts';
import { buildBedroom } from './bedroom.ts';
import { buildAppliance } from './appliances.ts';

export function makeFurniture(e:Entity) {
    const spec=FURNITURE_SPECS.find(s=>s.id===e.asset);
    if(!spec)throw new Error(`未知家具资产：${e.asset}`);
    const f=furnitureBuilder(e);
    if(![buildSeating,buildStorage,buildBedroom,buildAppliance].some(build=>build(f,spec.style)))throw new Error(`未实现家具结构：${spec.style}`);
    return f.root;
}
