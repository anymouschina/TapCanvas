import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ASSETS } from '../src/asset-catalog.ts';
import { entity } from '../src/model.ts';
import { makeActor } from '../src/assets/actors.ts';
import { makeProp } from '../src/assets/props.ts';
import { makeCrowd } from '../src/assets/crowd.ts';
import {disposeVisual} from '../src/visuals/runtime.ts';
import { disposeTree } from '../src/assets.ts';
import { setEntityColor } from '../src/editor/entity-color.ts';

test('every built-in model responds to its own color without changing another instance', () => {
    for (const asset of ASSETS) {
        const e = entity(asset.kind, asset.id, asset.name), copy = structuredClone(e); copy.id += '-copy';
        if (e.kind === 'crowd') { e.count = 2; copy.count = 2; }
        const make = () => e.kind === 'actor' ? makeActor(e).root : e.kind === 'crowd' ? makeCrowd(e).root : makeProp(e);
        const colors = (root: T.Object3D) => { const out: string[] = []; root.traverse(o => { if (o instanceof T.Mesh||o instanceof T.Points||o instanceof T.Line) for (const m of Array.isArray(o.material) ? o.material : [o.material]) {if ('color' in m) out.push((m.color as T.Color).getHexString());if(m instanceof T.ShaderMaterial&&m.uniforms.color?.value instanceof T.Color)out.push(m.uniforms.color.value.getHexString());} }); return out; };
        const original = make(), before = colors(original);
        setEntityColor(e, '#2580ca'); const recolored = make();
        assert.notDeepEqual(colors(recolored), before, asset.id + ' ignores chosen color');
        assert.deepEqual(colors(original), before, asset.id + ' leaks into other instance materials');
        assert.notEqual(e.color, copy.color);
        disposeVisual(original);disposeVisual(recolored);disposeTree(original); disposeTree(recolored);
    }
});
