import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { decodeModelBytes, encodeModelBytes, modelPath, packModelFiles, readGltfDocument, resolveModelUri, unpackModelFiles } from '../src/resources/model-package.ts';
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

test('portable glTF collects relative buffer/image dependencies and excludes unrelated selected files', () => {
    const document = { asset: { version: '2.0' }, buffers: [{ uri: '../data/mesh.bin', byteLength: 4 }], images: [{ uri: '../images/a%20b.png' }] };
    const packed = packModelFiles('scene/model.gltf', [{ path: 'scene/model.gltf', bytes: json(document) }, { path: 'data/mesh.bin', bytes: new Uint8Array([0, 1, 2, 3]) },
        { path: 'images/a b.png', bytes: new Uint8Array([4, 5, 6]) }, { path: 'private.txt', bytes: json('not a model dependency') }]);
    assert.deepEqual(packed.files.map(f => f.path), ['data/mesh.bin', 'images/a b.png', 'scene/model.gltf']);
    const reopened = unpackModelFiles(JSON.parse(JSON.stringify(packed)));
    assert.deepEqual([...reopened.get('data/mesh.bin')!], [0, 1, 2, 3]);
    assert.equal(JSON.stringify(packed).includes('private'), false);
});

test('missing dependencies, truncated buffers and duplicate names fail before any partial import', () => {
    const document = { asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin', byteLength: 10 }], images: [{ uri: 'paint.png' }] };
    const main = { path: 'model.gltf', bytes: json(document) };
    assert.throws(() => packModelFiles(main.path, [main]), /mesh.bin、paint.png/);
    assert.throws(() => packModelFiles(main.path, [main, { path: 'mesh.bin', bytes: new Uint8Array(2) }]), /截断/);
    assert.throws(() => packModelFiles(main.path, [main, main]), /重复/);
    const packed = packModelFiles('model.gltf', [{ path: 'model.gltf', bytes: json({ asset: { version: '2.0' } }) }]);
    packed.files.push({ path: 'unused.bin', data: 'AAAA' });
    assert.throws(() => unpackModelFiles(packed), /未引用/);
});

test('local references resolve parent directories but never allow absolute/network paths', () => {
    assert.equal(resolveModelUri('models/body.gltf', '../textures/肤色.png'), 'textures/肤色.png');
    assert.equal(resolveModelUri('models/body.gltf', '../textures/a%2520b.png'), 'textures/a%20b.png');
    for (const value of ['https://host/model.bin', 'file:///private.bin', 'C:/private.bin', '//host/share.bin', '..\\private.bin', '%2fprivate.bin', '../../private.bin', 'part.bin?key=secret']) {
        assert.throws(() => resolveModelUri('models/body.gltf', value), value);
    }
    for (const value of ['', '/file.bin', '../file.bin', 'a\x00.bin', 'C:\\file.bin']) assert.throws(() => modelPath(value));
});

test('base64 conversion handles large models and rejects damaged data; inline buffers need no companion file', () => {
    const bytes = new Uint8Array(3_000_001); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    assert.deepEqual(decodeModelBytes(encodeModelBytes(bytes)), bytes);
    for (const bad of ['A', 'AAAA!', 'AA=A', '====', 'A===', ' AAA']) assert.throws(() => decodeModelBytes(bad));
    const doc = { asset: { version: '2.0' }, buffers: [{ uri: 'data:application/octet-stream;base64,AAECAw==', byteLength: 4 }] };
    assert.equal(packModelFiles('inline.gltf', [{ path: 'inline.gltf', bytes: json(doc) }]).files.length, 1);
});

test('real downloaded skin, animation and material GLBs survive portable package serialization byte for byte', async () => {
    for (const name of ['CesiumMan', 'RiggedFigure', 'SheenChair']) {
        const bytes = new Uint8Array(await fs.readFile(`test-assets/external/${name}/${name}.glb`));
        const packed = packModelFiles(name + '.glb', [{ path: name + '.glb', bytes }]);
        const copied = unpackModelFiles(JSON.parse(JSON.stringify(packed))).get(name + '.glb')!;
        assert.deepEqual(copied, bytes);
        const original = readGltfDocument(copied, name + '.glb');
        if (name !== 'SheenChair') { assert.ok(Array.isArray(original.document.skins)); assert.ok(Array.isArray(original.document.animations)); }
        const damaged = bytes.slice(); new DataView(damaged.buffer).setUint32(8, bytes.length - 4, true);
        assert.throws(() => packModelFiles(name + '.glb', [{ path: name + '.glb', bytes: damaged }]), /长度/);
    }
});
