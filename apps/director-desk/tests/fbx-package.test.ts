import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { readFbxDocument } from '../src/resources/fbx-document.ts';
import { inspectFbxSource, resolveFbxFile } from '../src/resources/fbx-source.ts';
import { packModelFiles, unpackModelFiles } from '../src/resources/model-package.ts';
const file = (path: string, text: string) => ({ path, bytes: new TextEncoder().encode(text) });
const header = 'FBXHeaderExtension: {\n FBXVersion: 7400\n}\n';
function textured(reference: string, content = '') {
    return header + `GlobalSettings: { Properties70: { P: "UnitScaleFactor", "double", "Number", "", 1\n P: "UpAxis", "int", "Integer", "", 2\n } }\nObjects: {\nVideo: 1, "Video::image", "Clip" {\nRelativeFilename: "${reference}"\n${content}\n}\nTexture: 2, "Texture::image", "" {\nFileName: "image.png"\n}\n}\nConnections: { C: "OO", 1, 2\n }`;
}

test('ASCII FBX normalizes inconsistent indentation structurally and loads three downloaded furniture models', async () => {
    for (const name of ['chair', 'bedDouble', 'table']) {
        const bytes = new Uint8Array(await fs.readFile(`test-assets/external/kenney-furniture/Models/FBX format/${name}.fbx`));
        const doc = readFbxDocument(bytes), scene = new FBXLoader().parse(new TextEncoder().encode(doc.ascii).buffer, '');
        let meshes = 0; scene.traverse(node => {
            if ('isMesh' in node && 'geometry' in node && 'material' in node) {
                meshes++;
                const geometry = node.geometry as import('three').BufferGeometry, count = Array.isArray(node.material) ? node.material.length : 1;
                for (const group of geometry.groups) assert.ok(Number.isInteger(group.materialIndex) && group.materialIndex! >= 0 && group.materialIndex! < count, 'material indices must be numeric and reference actual materials');
            }
        }); assert.ok(meshes > 0);
        assert.equal(inspectFbxSource(bytes).unitScale, 1);
        const packed = packModelFiles(name + '.fbx', [{ path: name + '.fbx', bytes }]);
        assert.deepEqual(unpackModelFiles(JSON.parse(JSON.stringify(packed))).get(name + '.fbx'), bytes);
        assert.equal(doc.version, 7300);
    }
});

test('FBX selected-file relinking preserves relative folders and excludes unrelated data', () => {
    const main = file('scene/model.fbx', textured('../textures/颜色.png'));
    const png = { path: 'textures/颜色.png', bytes: new Uint8Array([1, 2, 3]) };
    const packed = packModelFiles(main.path, [main, png, file('private.txt', 'unrelated')]);
    assert.equal(packed.format, 'fbx'); assert.equal(packed.files.length, 2);
    assert.deepEqual([...unpackModelFiles(packed).keys()], ['scene/model.fbx', 'textures/颜色.png']);
    const info = inspectFbxSource(main.bytes); assert.equal(info.unitScale, .01); assert.equal(info.upAxis, 2);
    assert.throws(() => packModelFiles(main.path, [main]), /缺少模型关联文件：颜色.png/);
    const absolute = file('s.fbx', textured('C:\\source-only\\image.png'));
    assert.equal(packModelFiles(absolute.path, [absolute, file('selected/image.png', 'image')]).files.length, 2);
    const files = new Map([['a/image.png', new Uint8Array()], ['b/image.png', new Uint8Array()]]);
    assert.throws(() => resolveFbxFile('s.fbx', 'C:\\source-only\\image.png', files), /同名/);
    assert.equal(resolveFbxFile('s.fbx', 'a/image.png', files), 'a/image.png');
});

test('FBX rejects network references, silent texture placeholders, malformed structure and invalid metadata', () => {
    for (const reference of ['https://example.invalid/image.png', 'data:image/png;base64,AAAA', 'blob:invalid']) assert.throws(() => inspectFbxSource(file('s.fbx', textured(reference)).bytes), /协议/);
    assert.throws(() => inspectFbxSource(file('s.fbx', textured('image.png').replace('C: "OO", 1, 2', 'C: "OO", 99, 2')).bytes), /图片关联/);
    assert.throws(() => inspectFbxSource(file('s.fbx', textured('image.png').replace('"", 1\n P:', '"", -1\n P:')).bytes), /单位/);
    for (const text of [header + 'Objects: {', header + 'Objects: {} }', header + 'Objects: { __proto__: {} }', 'not fbx']) assert.throws(() => readFbxDocument(file('s.fbx', text).bytes));
    const embedded = inspectFbxSource(file('s.fbx', textured('image.png', 'Content: ,\n "AAEC"')).bytes);
    assert.equal(embedded.media[0].embedded, true); assert.equal(embedded.media[0].content, 'AAEC');
});

test('real binary skin/animation and embedded-image FBX packages preserve original bytes', async () => {
    for (const name of ['Samba Dancing', 'monkey_embedded_texture']) {
        const bytes = new Uint8Array(await fs.readFile(`test-assets/external/three-fbx/${name}.fbx`));
        const info = inspectFbxSource(bytes); assert.equal(info.document.version, 7400); assert.equal(info.unitScale, .01);
        const objectTypes = info.document.nodes.find(n => n.name === 'Objects')!.children.map(n => n.name);
        if (name === 'Samba Dancing') { assert.ok(objectTypes.includes('Deformer')); assert.ok(objectTypes.includes('AnimationStack')); }
        else assert.ok(info.media[0].content instanceof Uint8Array && info.media[0].content.length > 100000);
        const packed = packModelFiles(name + '.fbx', [{ path: name + '.fbx', bytes }]); assert.equal(packed.files.length, 1);
        assert.deepEqual(unpackModelFiles(JSON.parse(JSON.stringify(packed))).get(name + '.fbx'), bytes);
        assert.throws(() => readFbxDocument(bytes.subarray(0, bytes.length / 2)), /截断|边界/);
        const damaged = bytes.slice(); new DataView(damaged.buffer).setUint32(27, bytes.length + 1, true);
        assert.throws(() => readFbxDocument(damaged), /边界/);
    }
});

test('binary FBX 7500 reads 64-bit node headers and rejects unsafe offsets and truncated footers', () => {
    const encoded = (name: string, properties: Buffer[], children: ((start: number) => Buffer)[] = []) => (start: number): Buffer => {
        const label = Buffer.from(name), body = Buffer.concat(properties), header = Buffer.alloc(25);
        let offset = start + header.length + label.length + body.length; const parts: Buffer[] = [label, body];
        for (const child of children) { const b = child(offset); parts.push(b); offset += b.length; }
        if (children.length) { parts.push(Buffer.alloc(25)); offset += 25; }
        header.writeBigUInt64LE(BigInt(offset), 0); header.writeBigUInt64LE(BigInt(properties.length), 8); header.writeBigUInt64LE(BigInt(body.length), 16); header[24] = label.length;
        return Buffer.concat([header, ...parts]);
    };
    const str = (value: string) => { const b = Buffer.from(value), h = Buffer.alloc(5); h[0] = 83; h.writeUInt32LE(b.length, 1); return Buffer.concat([h, b]); };
    const double = (value: number) => { const b = Buffer.alloc(9); b[0] = 68; b.writeDoubleLE(value, 1); return b; };
    const head = Buffer.alloc(27); head.write('Kaydara FBX Binary  \0\x1a\0', 0, 'binary'); head.writeUInt32LE(7500, 23);
    const settings = encoded('GlobalSettings', [], [encoded('Properties70', [], [encoded('P', [str('UnitScaleFactor'), str('double'), str('Number'), str(''), double(2.54)])])])(27);
    const objects = encoded('Objects', [])(27 + settings.length), bytes = Buffer.concat([head, settings, objects, Buffer.alloc(25 + 176)]);
    assert.equal(inspectFbxSource(bytes).unitScale, .0254);
    assert.equal(readFbxDocument(bytes).version, 7500);
    const unsafe = Buffer.from(bytes); unsafe.writeBigUInt64LE(2n ** 60n, 27); assert.throws(() => readFbxDocument(unsafe), /安全范围/);
    assert.throws(() => readFbxDocument(bytes.subarray(0, bytes.length - 100)), /文件尾/);
});
