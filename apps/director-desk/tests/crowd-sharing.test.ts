import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { entity } from '../src/model.ts';
import { makeCrowd } from '../src/assets/crowd.ts';
import { makeHuman } from '../src/assets/humanoid.ts';
import { animateHuman } from '../src/assets/human-animation.ts';
import { disposeTree } from '../src/assets/dispose.ts';

test('crowd geometry sharing preserves legacy member shape, random placement, transforms and animation', () => {
    for (const build of ['slim', 'normal', 'broad'] as const) {
        const e = entity('crowd', 'crowd', '群演'); e.count = 7; e.build = build; e.height = 1.4; e.scale = [2, .8, 1.3]; e.seed = 721; e.gender = 'female';
        e.clips = [{ id: 'walk', action: 'walk', start: .1, end: 3, speed: 1 }];
        const { root, rigs } = makeCrowd(e), cols = Math.ceil(Math.sqrt(e.count));
        const random = (seed: number) => { const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
        for (const [i, rig] of rigs.entries()) {
            const original = makeHuman({ ...e, height: e.height * (.94 + random(e.seed + i) * .12) });
            original.root.position.set((i % cols - (cols - 1) / 2) * e.spacing, 0, (Math.floor(i / cols) - (Math.ceil(e.count / cols) - 1) / 2) * e.spacing);
            original.root.rotation.y = (random(e.seed + i + 100) - .5) * .4;
            for (const time of [0, 1.4, .2, 2.9]) {
                animateHuman(rig, e, time, i * .3); animateHuman(original, e, time, i * .3);
                root.updateMatrixWorld(true); original.root.updateMatrixWorld(true);
                const a: T.Object3D[] = [], b: T.Object3D[] = []; rig.root.traverse(o => a.push(o)); original.root.traverse(o => b.push(o));
                assert.equal(a.length, b.length);
                for (let n = 0; n < a.length; n++) {
                    assert.ok(a[n].matrixWorld.elements.every((value, index) => value === b[n].matrixWorld.elements[index]), 'Member world transforms changed');
                    if (a[n] instanceof T.Mesh) assert.deepEqual((a[n] as T.Mesh).geometry.getAttribute('position').array, (b[n] as T.Mesh).geometry.getAttribute('position').array);
                }
            }
            disposeTree(original.root);
        }
        const meshes = rigs.map(r => { const list: T.Mesh[] = []; r.root.traverse(o => { if (o instanceof T.Mesh) list.push(o); }); return list; });
        for (let i = 1; i < rigs.length; i++) for (let m = 0; m < meshes[0].length; m++) {
            assert.equal(meshes[i][m].geometry, meshes[0][m].geometry); assert.notEqual(meshes[i][m].material, meshes[0][m].material);
        }
        const untouched = rigs[1].joints.leftArm.rotation.x, color = rigs[1].skin.color.getHex();
        rigs[0].joints.leftArm.rotation.x = 2; rigs[0].skin.color.set('#ff0000');
        assert.equal(rigs[1].joints.leftArm.rotation.x, untouched); assert.equal(rigs[1].skin.color.getHex(), color);
        const geometries = new Set(meshes.flat().map(m => m.geometry)); let disposed = 0;
        geometries.forEach(g => g.addEventListener('dispose', () => disposed++)); disposeTree(root); assert.equal(disposed, geometries.size);
    }
});
