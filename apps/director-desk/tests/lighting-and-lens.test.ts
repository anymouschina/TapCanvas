import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, PerspectiveCamera, Vector2, Vector3, Mesh, MeshDepthMaterial, PointLight, SpotLight, DirectionalLight } from 'three';
import { demoProject, entity, assertProject, clone } from '../src/model.ts';
import { defaultLighting, lightIntensity } from '../src/lighting/model.ts';
import { lightColor, makeLight } from '../src/lighting/runtime.ts';
import { applyOperations } from '../src/automation/edits.ts';
import { LIGHTING_PRESETS } from '../src/lighting/presets.ts';
import { mergeScene } from '../src/scenes/merge-project.ts';
import { lensSource, lensScreen, setLensProjection } from '../src/cinematography/lens-projection.ts';
import { frameBounds } from '../src/spatial/geometry.ts';
import { readSceneDocument, projectForScene } from '../src/scenes/sequence-project.ts';
import { installWallTransmission, isWallEntity, setWallTransmission } from '../src/lighting/wall-transmission.ts';
import { disposeTree } from '../src/assets/dispose.ts';


test('lens forward and inverse projection agree at screen samples including corners for all aspects', () => {
    for (const aspect of [9 / 16, 16 / 9, 21 / 9, 1]) for (const type of ['barrel', 'pincushion', 'fisheye'] as const) for (const amount of [.2, 1]) {
        for (let x = -1; x <= 1; x += .125) for (let y = -1; y <= 1; y += .125) {
            const point = new Vector2(x, y), lens = { type, amount };
            assert.ok(lensScreen(lensSource(point, aspect, lens), aspect, lens).distanceTo(point) < 1e-7);
        }
        const camera = new PerspectiveCamera(60, aspect, .1, 100); setLensProjection(camera, { distortionType: type, channels: { distortion: amount } }, 0);
        const visible = frameBounds(new Box3(new Vector3(-.1, -.1, -4), new Vector3(.1, .1, -3)), camera);
        assert.equal(visible.status, 'inside'); assert.equal(visible.method, 'distorted-bounds-samples');
        assert.equal(frameBounds(new Box3(new Vector3(100, 0, -4), new Vector3(101, 1, -3)), camera).status, 'outside');
    }
});

test('light defaults are independent; invalid lights are atomic and area shadow limits are explicit', () => {
    const a = entity('prop', 'light-point', 'A'), b = entity('prop', 'light-point', 'B');
    a.light!.range = 7; assert.equal(b.light!.range, 20);
    const original = demoProject(); original.entities.push(a, b);
    for (const asset of ['light-point', 'light-spot', 'light-area', 'light-sun']) {
        const p = applyOperations(original, [{ operation: 'add', asset, id: 'light' }]); assertProject(p);
        const model = makeLight(p.entities.at(-1)!); assert.ok(model.getObjectByName('director-light')); disposeTree(model);
    }
    const old = clone(original);
    assert.throws(() => applyOperations(original, [{ operation: 'update', id: a.id, patch: { light: { ...a.light, intensity: -1 } } }]), /强度/); assert.deepEqual(original, old);
    assert.throws(() => applyOperations(original, [{ operation: 'add', asset: 'light-area', patch: { light: { ...b.light, shadows: true } } }]), /面光源/);
    for (const asset of Object.keys(LIGHTING_PRESETS)) assertProject(applyOperations(original, [{ operation: 'lighting-preset', asset }]));
});

test('light color/intensity and scene environment survive file round trip and shifted scene merge', () => {
    const p = demoProject(), lamp = entity('prop', 'light-spot', '移动光', [0, 4, 3]); p.entities.push(lamp);
    lamp.light!.intensity = { keys: [{ time: 0, value: 0 }, { time: 4, value: 100, easing: 'ease-in' }] };
    lamp.light!.colorKeys = [{ time: 0, color: '#ff0000' }, { time: 4, color: '#0000ff' }];
    lamp.light!.throughWalls = true;
    lamp.light!.flicker = { strength: .3, frequency: 4, seed: 7 };
    p.lighting = defaultLighting(); p.lighting.exposure = { keys: [{ time: 0, value: 1 }, { time: 4, value: 2 }] };
    const camera = p.entities.find(e => e.camera)!;
    camera.camera!.effects = { channels: { focal: { keys: [{ time: 0, value: 28 }, { time: 4, value: 50 }] } }, focusTargetId: lamp.id };
    const read = projectForScene(readSceneDocument(JSON.parse(JSON.stringify(readSceneDocument(p)))));
    assert.deepEqual(read.lighting, p.lighting); assert.deepEqual(read.entities, p.entities);
    const merged = mergeScene(demoProject(), p, { offset: [4, 0, 0], timeOffset: 8, scheduling: 'keep', cuts: 'keep' });
    const next = merged.project.entities.find(e => e.id === merged.entityIds[lamp.id])!;
    assert.equal(next.light!.throughWalls, true);
    assert.equal(lightIntensity(next.light!, 10), lightIntensity(lamp.light!, 2));
    assert.deepEqual(lightColor(next, 10), lightColor(lamp, 2));
    const nextCamera = merged.project.entities.find(e => e.id === merged.entityIds[camera.id])!;
    assert.equal(nextCamera.camera!.effects!.focusTargetId, next.id);
    assert.deepEqual(nextCamera.camera!.effects!.channels!.focal, { keys: [{ time: 8, value: 28 }, { time: 12, value: 50 }] });
    assert.ok(merged.warnings.length);
});


test('wall transmission is opt-in, validates types and isolates each lamp shadow pass', () => {
    const p = demoProject(), wall = new Mesh(), material = new MeshDepthMaterial();
    installWallTransmission(wall); const hook = wall.onBeforeShadow;
    installWallTransmission(wall); assert.equal(wall.onBeforeShadow, hook);
    for (const asset of ['light-point', 'light-spot', 'light-sun']) {
        const lamp = entity('prop', asset, 'Lamp');
        assert.equal(lamp.light!.throughWalls, undefined);
        const edited = applyOperations(p, [{ operation: 'add', asset, patch: { light: { ...lamp.light, throughWalls: true } } }]);
        const root = makeLight(edited.entities.at(-1)!);
        const light = root.getObjectByName('director-light');
        assert.ok(light instanceof PointLight || light instanceof SpotLight || light instanceof DirectionalLight);
        const args = [null, null, null, light.shadow.camera, wall.geometry, material, null] as unknown as Parameters<Mesh['onBeforeShadow']>;
        wall.onBeforeShadow(...args); assert.equal(material.depthWrite, false); assert.equal(material.colorWrite, false);
        wall.onAfterShadow(...args); assert.equal(material.depthWrite, true); assert.equal(material.colorWrite, true);
        const normalArgs = [...args] as typeof args; normalArgs[3] = new PerspectiveCamera();
        wall.onBeforeShadow(...normalArgs); assert.equal(material.depthWrite, true); wall.onAfterShadow(...normalArgs);
        setWallTransmission(light.shadow.camera, false);
        wall.onBeforeShadow(...args); assert.equal(material.depthWrite, true); wall.onAfterShadow(...args);
        disposeTree(root);
    }
    const lamp = entity('prop', 'light-point', 'Invalid');
    assert.throws(() => applyOperations(p, [{ operation: 'add', asset: lamp.asset, patch: { light: { ...lamp.light, throughWalls: 'true' } } }]), /灯光参数/);
    for (const asset of ['wall', 'structure-wall', 'structure-slab', 'building-house']) assert.equal(isWallEntity(entity('prop', asset, 'wall')), true);
    for (const asset of ['shape-box', 'ground', 'furniture-chair', 'external-model']) assert.equal(isWallEntity(entity('prop', asset, 'wall')), false);
    material.dispose(); wall.geometry.dispose();
});
