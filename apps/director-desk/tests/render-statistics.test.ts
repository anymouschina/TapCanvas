import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { collectRenderStatistics } from '../src/resources/render-statistics.ts';

test('resource statistics deduplicate shared geometry, buffers, textures and overlapping roots without confusing instances with allocation', () => {
    const data = new Float32Array(18), buffer = new T.InterleavedBuffer(data, 6), geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.InterleavedBufferAttribute(buffer, 3, 0)); geometry.setAttribute('normal', new T.InterleavedBufferAttribute(buffer, 3, 3));
    geometry.setIndex([0, 1, 2]); geometry.morphAttributes.position = [new T.Float32BufferAttribute([0, 0, 0, 1, 1, 1, 2, 2, 2], 3)];
    const texture = new T.DataTexture(new Uint8Array(4 * 8 * 4), 4, 8), material = new T.MeshStandardMaterial({ map: texture });
    const a = new T.Mesh(geometry, material), b = new T.InstancedMesh(geometry, material.clone(), 5), root = new T.Group();
    b.visible = false; root.add(a, b); const result = collectRenderStatistics([root, a]);
    assert.deepEqual(result, { meshes: 2, instances: 6, triangles: 6, points:0, lines:0, uniqueGeometries: 1, geometryBufferBytes: data.byteLength + 6 + 36,
        materials: 2, textures: 1, baseLevelTexels: 32, unknownTextureSizes: 0 });
    assert.equal(b.visible, false); assert.equal(material.map, texture);
    geometry.dispose(); material.dispose(); b.material.dispose(); b.dispose(); texture.dispose();
});

test('particle and line buffers are counted without pretending they are triangles',()=>{
    const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,1,0,0,1,1,0,0,1,0],3));
    const points=new T.Points(geometry,new T.PointsMaterial()),lines=new T.LineSegments(geometry,new T.LineBasicMaterial());
    const result=collectRenderStatistics([points,lines]);assert.equal(result.points,4);assert.equal(result.lines,2);assert.equal(result.triangles,0);assert.equal(result.uniqueGeometries,1);assert.equal(result.geometryBufferBytes,48);
    geometry.dispose();points.material.dispose();lines.material.dispose();
});

test('cube faces, unavailable image sizes, and geometry buffers aliased by separate attributes remain explicit', () => {
    const geometry = new T.BufferGeometry(), data = new Float32Array(18);
    geometry.setAttribute('position', new T.BufferAttribute(data.subarray(0, 9), 3)); geometry.setAttribute('normal', new T.BufferAttribute(data.subarray(9), 3));
    const cube = new T.CubeTexture(Array.from({ length: 6 }, () => ({ width: 2, height: 2 }))), unknown = new T.Texture();
    const material = new T.ShaderMaterial({ uniforms: { maps: { value: [cube, unknown, cube] } } });
    const result = collectRenderStatistics([new T.Mesh(geometry, material)]);
    assert.equal(result.geometryBufferBytes, data.byteLength); assert.equal(result.textures, 2); assert.equal(result.baseLevelTexels, 24); assert.equal(result.unknownTextureSizes, 1);
    geometry.dispose(); material.dispose(); cube.dispose(); unknown.dispose();
});
