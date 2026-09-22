import test from 'node:test';
import assert from 'node:assert/strict';
import { packModelFiles } from '../src/resources/model-package.ts';
import { assertResourcePackage, sameModelPackage } from '../src/resources/package-validation.ts';
const packageForTest=()=>packModelFiles('test.gltf',[{path:'test.gltf',bytes:new TextEncoder().encode(JSON.stringify({asset:{version:'2.0'},scenes:[{nodes:[]}],scene:0}))}]);
test('cached resource validation survives clones but never trusts mutated file records',t=>{
 const data=packageForTest(),id='test-validated-package';assertResourcePackage(id,data);
 const decode=t.mock.method(globalThis,'atob');assertResourcePackage(id,structuredClone(data));assert.equal(decode.mock.callCount(),0,'unchanged source does not decode Base64 again');
 const original=data.files[0].data;data.files[0].data='!!!!';assert.throws(()=>assertResourcePackage(id,data),/Base64/);
 data.files[0].data=original;assert.doesNotThrow(()=>assertResourcePackage(id,data));
 data.files[0].path='../escape.gltf';assert.throws(()=>assertResourcePackage(id,data));
});
test('package equality covers metadata, file order, missing dependencies and future serialized fields',()=>{
 const data=packageForTest(),other=structuredClone(data);assert.ok(sameModelPackage(data,other));
 other.entry='other.gltf';assert.equal(sameModelPackage(data,other),false);
 other.entry=data.entry;other.files.push({path:'extra.bin',data:'AAAA'});assert.equal(sameModelPackage(data,other),false);assert.throws(()=>assertResourcePackage('test-extra',other));
 const unknown={...data,future:'a'};assert.equal(sameModelPackage(data,unknown),false);assert.ok(sameModelPackage(unknown,structuredClone(unknown)));
});
