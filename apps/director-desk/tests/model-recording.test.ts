import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRecording, recordingStep, recordingError } from '../src/editor/model-recording.ts';
import { assertProject, clone, demoProject, entity, clip } from '../src/model.ts';
import { entityPosition, sampledAction } from '../src/timeline.ts';
import { SceneWorkspace } from '../src/scenes/scene-workspace.ts';

test('recorded distance is measured in metres per second at every supported frame rate', () => {
    for (const fps of [24, 30, 50, 59, 60, 90, 120]) {
        const e = entity('actor', 'person', '测试人物');
        const take = new ModelRecording(e, 0, fps, 'auto');
        for (let f = 0; f < fps * 2; f++) take.advance(new Set(['KeyW', 'ShiftLeft']), [0, 0, -1]);
        assert.ok(Math.abs(take.position[2] + 10) < 1e-8);
        assert.equal(take.time, 2); assert.equal(take.entity.clips.length, 1);
        assert.equal(take.entity.path!.points.length, 2, 'constant-speed straight motion needs only its endpoints');
        assert.equal(sampledAction(take.entity, 1).action, 'run');
        assert.equal(e.path, null, 'recording must not mutate the source entity');
    }
    const straight = recordingStep([0,0,0], [0,0,-1], new Set(['KeyW']), 1, 'auto');
    const diagonal = recordingStep([0,0,0], [0,0,-1], new Set(['KeyW','KeyD']), 1, 'auto');
    assert.ok(Math.abs(Math.hypot(...straight.position) - Math.hypot(...diagonal.position)) < 1e-8);
});

test('recording changes walk/run/idle clips at input boundaries and retains actual pauses', () => {
    const take = new ModelRecording(entity('actor','person','测试人物'), 0, 24, 'auto');
    for (const keys of [new Set(['KeyW']), new Set<string>(), new Set(['KeyD','ShiftLeft'])])
        for (let f=0; f<24; f++) take.advance(keys, [0,0,-1]);
    assert.deepEqual(take.entity.clips.map(c=>[c.action,c.start,c.end]), [['walk',0,1],['idle',1,2],['run',2,3]]);
    assert.deepEqual(entityPosition(take.entity,1).toArray(),entityPosition(take.entity,1.9).toArray());
    assert.ok(Math.abs(take.position[0]-5)<1e-8);
});

test('resuming inside a retimed smooth route preserves prior output-frame positions', () => {
    const e=entity('actor','person','测试人物');
    e.path={smooth:true,points:[{time:0,position:[0,0,0]},{time:2,position:[1,0,4]},{time:4,position:[5,0,3]},{time:6,position:[10,0,1]}],
        sections:[{start:1,end:5,from:0,to:6}]};
    e.clips=[clip('wave',0,5),clip('run',5,10)];
    const take=new ModelRecording(e,3,24,'auto');
    for(let f=0;f<24;f++)take.advance(new Set(['KeyW']),[0,0,-1]);
    for(let f=0;f<=72;f++)assert.ok(entityPosition(e,f/24).distanceTo(entityPosition(take.entity,f/24))<1e-8);
    assert.equal(take.entity.clips[0].end,3);
    assert.equal(take.entity.clips[0].sourceDuration,5);
    assert.equal(take.entity.path!.points.at(-1)!.time,4);
    assert.equal(take.entity.clips.at(-1)!.action,'walk');
});

test('props and animals keep their actions and hand-bound props cannot be recorded separately', () => {
    const e=entity('prop','cube','测试道具');
    const take=new ModelRecording(e,2,24,'auto');
    take.advance(new Set(['KeyR']),[0,0,-1]);
    assert.equal(take.mode,'keep'); assert.deepEqual(take.entity.clips,e.clips);
    assert.ok(take.position[1]>0);
    const animal=new ModelRecording(entity('actor','animal-dog-small','测试动物'),0,24,'auto');
    animal.advance(new Set(['KeyW']),[0,0,-1]);
    assert.equal(animal.mode,'keep'); assert.equal(animal.entity.clips.length,0);
    assert.ok(recordingError({...e,locked:true}));
    assert.ok(recordingError({...e,kind:'camera'}));
    assert.ok(recordingError({...e,handBinding:{actorId:'a',hand:'right',offset:[0,0,0],rotation:[0,0,0]}}));
});

test('one recording is one transaction; cancel, undo, redo, and serialized playback are consistent', () => {
    const project=demoProject(), before=clone(project), actor=project.entities.find(e=>e.kind==='actor')!;
    const history=new SceneWorkspace(project,()=>({time:0,selected:actor.id,preview:'program'}));
    history.begin(project);
    const take=new ModelRecording(actor,0,24,'auto');
    for(let f=0;f<24;f++)take.advance(new Set(['KeyW']),[0,0,-1]);
    project.entities[project.entities.indexOf(actor)]=take.entity;
    assertProject(project);history.commit(project);
    assert.deepEqual(history.undo(project)!.entities,before.entities);
    const restored=history.redo(project)!;
    assert.deepEqual(restored.entities.find(e=>e.id===actor.id),take.entity);
    const roundtrip=JSON.parse(JSON.stringify(restored));assertProject(roundtrip);
    assert.deepEqual(entityPosition(roundtrip.entities.find((e:typeof actor)=>e.id===actor.id)!,.5),entityPosition(take.entity,.5));
    history.begin(restored);restored.entities[0].name='临时修改';
    assert.notEqual(history.rollback()!.entities[0].name,'临时修改');
});
