import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { packModelFiles, unpackModelFiles } from '../src/resources/model-package.ts';
import { objFilePath, readObjMaterials } from '../src/resources/obj-source.ts';

const file = (path: string, text: string) => ({ path, bytes: new TextEncoder().encode(text) });
const triangle = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';

test('OBJ package collects multiple MTL libraries and their relative textures, excluding unrelated selected files', () => {
    const sources = [file('model/scene.obj', 'mtllib "../materials/木 材.mtl" ../materials/metal.mtl\nusemtl wood\n' + triangle),
        file('materials/木 材.mtl', 'newmtl wood\nKd .8 .4 .2\nmap_Kd -s 2 3 -o .1 .2 "../images/木 100%.png"'),
        file('materials/metal.mtl', 'newmtl metal\nKd .3 .3 .3\nmap_Ks ../images/metal.png'),
        file('images/木 100%.png', 'image'), file('images/metal.png', 'image'), file('personal.txt', 'must not be packed')];
    const pack = packModelFiles('model/scene.obj', sources);
    assert.equal(pack.format, 'obj'); assert.equal(pack.files.length, 5);
    const roundtrip = unpackModelFiles(JSON.parse(JSON.stringify(pack)));
    assert.equal(roundtrip.has('personal.txt'), false);
    for (const source of sources.slice(0, 5)) assert.deepEqual(roundtrip.get(source.path), source.bytes);
    const map = readObjMaterials('materials/木 材.mtl', sources[1].bytes)[0].properties[1].texture!;
    assert.deepEqual(map, { path: 'images/木 100%.png', options: '-s 2 3 1 -o 0.1 0.2 0' });
});

test('OBJ missing companions and undefined materials fail before load; duplicate names are not silently overwritten', () => {
    const obj = file('s.obj', 'mtllib a.mtl b.mtl\nusemtl red\n' + triangle);
    assert.throws(() => packModelFiles('s.obj', [obj]), /a.mtl、b.mtl/);
    const a = file('a.mtl', 'newmtl red\nmap_Kd red.png\nmap_d alpha.png');
    assert.throws(() => packModelFiles('s.obj', [obj, a]), /red.png、alpha.png、b.mtl/);
    assert.throws(() => packModelFiles('s.obj', [file('s.obj', 'usemtl missing\n' + triangle)]), /未定义/);
    assert.throws(() => packModelFiles('s.obj', [obj, file('a.mtl', 'newmtl red'), file('b.mtl', 'newmtl red')]), /冲突/);
    assert.throws(() => readObjMaterials('a.mtl', file('a.mtl', 'newmtl x\nnewmtl x').bytes), /重复/);
});

test('OBJ filenames are local names, preserve literal percent, and reject absolute or escaping references', () => {
    assert.equal(objFilePath('model/a.obj', '..\\textures\\a%20.png'), 'textures/a%20.png');
    for (const path of ['https://host/a.png', 'C:\\textures\\a.png', '//host/a.png', '/a.png', '../../outside.png']) assert.throws(() => objFilePath('model/a.obj', path));
    const sources = [file('s.obj', 'mtllib big library.mtl\n' + triangle), file('big library.mtl', 'newmtl plain\nKd 1 0 0')];
    assert.equal(packModelFiles('s.obj', sources).files.length, 2);
    const plain = packModelFiles('plain.obj', [file('plain.obj', triangle)]);
    assert.equal(plain.files.length, 1);
    assert.throws(() => unpackModelFiles({ ...plain, format: 'gltf' }), /格式与主文件/);
});

test('MTL options normalize shorthand and reject unsupported maps/options and unsafe material keys', () => {
    const parse = (text: string) => readObjMaterials('m.mtl', file('m.mtl', text).bytes);
    const material = parse('newmtl x\n\tbump\t-bm 0.5 -o -1 normal.png\nmap_Kd -s 2 \\\n "color map.png" # comment')[0];
    assert.equal(material.properties[0].texture?.options, '-bm 0.5 -o -1 0 0');
    assert.equal(material.properties[1].texture?.path, 'color map.png');
    for (const line of ['map_Kd -clamp on a.png', 'map_Kd -s a.png', 'map_Kd -mm 1 a.png', 'map_Kd', 'map_Pr a.png', 'refl a.png', 'Kd 1 nope 0', 'Ns Infinity', 'd', '__proto__ x']) assert.throws(() => parse('newmtl x\n' + line));
    for (const name of ['__proto__', 'constructor', 'prototype']) assert.throws(() => parse('newmtl ' + name));
});

test('downloaded Kenney OBJ furniture retains geometry and material files byte for byte', async () => {
    const dir = 'test-assets/external/kenney-furniture/Models/OBJ format';
    for (const name of ['bedDouble', 'chair', 'table']) {
        const files = await Promise.all(['obj', 'mtl'].map(async ext => ({ path: name + '.' + ext, bytes: new Uint8Array(await fs.readFile(`${dir}/${name}.${ext}`)) })));
        const packed = packModelFiles(name + '.obj', files), reopened = unpackModelFiles(JSON.parse(JSON.stringify(packed)));
        assert.equal(reopened.size, 2);
        for (const f of files) assert.deepEqual(reopened.get(f.path), f.bytes);
    }
});
