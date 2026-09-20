import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectFieldRelations } from './index.mjs';
const schema = { 'x-fieldRelations': [{ left: 'end', operator: 'gt', right: 'start' }] };
test('finite numeric relations reject reversed and zero-width intervals without mutation', () => {
 for (const value of [{start:2,end:2},{start:3,end:2}]) { const original=structuredClone(value); assert.equal(inspectFieldRelations(schema,value,'item').length,1); assert.deepEqual(value,original); }
 assert.deepEqual(inspectFieldRelations(schema,{start:0,end:2},'item'),[]);
});
test('malformed schemas and missing or nonnumeric operands are explicit errors', () => {
 for(const value of [{start:0},{start:0,end:'2'},{start:0,end:Infinity}]) assert.equal(inspectFieldRelations(schema,value,'item').length,1);
 assert.equal(inspectFieldRelations({'x-fieldRelations':[{left:'end',operator:'guess',right:'start'}]},{start:0,end:2},'item').length,1);
});
