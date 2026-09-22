import test from 'node:test';
import assert from 'node:assert/strict';
import { createScene } from '../src/scenes.ts';
import { cameraFocal } from '../src/cinematography/camera-effects.ts';
import { entityPosition } from '../src/timeline.ts';
import { numberAt } from '../src/animation/channels.ts';
import { assertProject } from '../src/model.ts';
import { Vector3 } from 'three';

test('feature scenes preserve editable lights, lens channels and timed movement through save/load', () => {
    for(const name of ['light-stage','dolly-hall','neon-chase'] as const) {
        const p=createScene(name);assertProject(JSON.parse(JSON.stringify(p)));
        assert.ok(p.entities.some(e=>e.light));assert.ok(p.entities.some(e=>e.camera?.effects));
        assert.ok(p.entities.some(e=>e.path));assert.equal(p.cuts[0].time,0);
        assert.ok(p.cuts.every(c=>c.time<p.duration));
        assert.equal(p.resources,undefined,'examples need no downloaded assets');
    }
    const stage=createScene('light-stage'),zoom=stage.entities.find(e=>e.name.includes('固定机位变焦'))!;
    assert.ok(numberAt(zoom.camera!.effects!.channels!.focal,12)>numberAt(zoom.camera!.effects!.channels!.focal,6));
    const hall=createScene('dolly-hall'),camera=hall.entities.find(e=>e.camera)!,target=new Vector3(...camera.camera!.target);
    const ratio=(t:number)=>{const distance=entityPosition(camera,t).distanceTo(target);return cameraFocal(camera.camera!.effects,t,camera.camera!.focal,distance)/distance;};
    assert.ok(Math.abs(ratio(0)-ratio(9.99))<1e-9,'dolly zoom holds subject scale');
    const chase=createScene('neon-chase'),actors=chase.entities.filter(e=>e.kind==='actor');
    for(const e of actors)assert.ok(entityPosition(e,10).distanceTo(entityPosition(e,0))>30,'chase travels through the street');
    for(let t=0;t<10;t+=.25)assert.ok(entityPosition(actors[0],t).distanceTo(entityPosition(actors[1],t))>2,'pursuer stays behind');
    assert.equal(createScene('blank').entities.length,2,'blank remains just ground and camera');
});
