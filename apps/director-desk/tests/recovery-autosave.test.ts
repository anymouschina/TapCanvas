import test from 'node:test';
import assert from 'node:assert/strict';
import { RecoveryAutosave } from '../src/editor/recovery-autosave.ts';
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('recovery coalesces edits, postpones active gestures and retries the latest state',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let blocked=true,writes=0,saved=0;
 const queue=new RecoveryAutosave(async()=>{if(blocked)return false;writes++;return true;},()=>saved++,()=>assert.fail('unexpected save error'),10);
 queue.request();queue.request();t.mock.timers.tick(10);await settle();assert.equal(writes,0);
 blocked=false;t.mock.timers.tick(10);await settle();assert.equal(writes,1);assert.equal(saved,1);
});
test('overlapping edits cannot let an older recovery write finish after a newer one',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let release!:()=>void,writes=0,saved=0;
 const queue=new RecoveryAutosave(async()=>{writes++;if(writes===1)await new Promise<void>(r=>release=r);return true;},()=>saved++,()=>assert.fail('unexpected save error'),10);
 queue.request();t.mock.timers.tick(10);await settle();queue.request();t.mock.timers.tick(10);await settle();assert.equal(writes,1);
 release();await settle();assert.equal(saved,0,'older result must not mark new edits saved');t.mock.timers.tick(10);await settle();assert.equal(writes,2);assert.equal(saved,1);
});
test('explicit flush propagates failures without silently proceeding',async()=>{
 let writes=0,errors=0;const queue=new RecoveryAutosave(async()=>{writes++;if(writes===1)throw Error('disk');return true;},()=>{},()=>errors++);
 await assert.rejects(queue.flush(),/disk/);assert.equal(errors,1);await queue.flush();assert.equal(writes,2);
 const blocked=new RecoveryAutosave(async()=>false,()=>{},()=>{});await assert.rejects(blocked.flush(),/当前编辑/);
});
test('explicit flush during a pending write waits and then captures the latest state',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let release!:()=>void,version=1;const captured:number[]=[];
 const queue=new RecoveryAutosave(async()=>{captured.push(version);if(captured.length===1)await new Promise<void>(r=>release=r);return true;},()=>{},()=>{},10);
 queue.request();t.mock.timers.tick(10);await settle();version=2;queue.request();let done=false;
 const flush=queue.flush().then(()=>done=true);await settle();assert.equal(done,false);assert.deepEqual(captured,[1]);
 release();await flush;assert.deepEqual(captured,[1,2]);assert.equal(done,true);
});
