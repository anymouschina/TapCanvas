import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleWorkflowAssetRegistry,materializationItems} from './index.mjs';
const asset={assetId:'asset-1',mediaType:'image',source:{mode:'generate',generationSpecId:'spec-1',generationSpecVersion:'v1'}};
const binding=(objectId,consumerClipIds)=>({bindingId:`binding-${objectId}`,objectId,assetId:'asset-1',referenceRole:'identity',consumerClipIds});
test('one physical generation across multiple objects and clips',()=>{
 const a=binding('hero',['clip-1','clip-2']),b=binding('friend',['clip-2']);
 const registry=assembleWorkflowAssetRegistry([asset,structuredClone(asset)],[a,b]);
 assert.equal(registry.assets.length,1);assert.equal(materializationItems(registry).length,1);
 assert.deepEqual(materializationItems(registry)[0].bindings,[a,b]);
});
test('existing assets remain reuse records rather than new generation requests',()=>{
 const existing={...asset,source:{mode:'existing',sourceAssetId:'source-1',sourceVersionId:'version-1'}};
 assert.equal(materializationItems(assembleWorkflowAssetRegistry([existing],[binding('hero',[])]))[0].asset.source.mode,'existing');
});
test('conflicting immutable source and dangling bindings fail without altering evidence',()=>{
 assert.throws(()=>assembleWorkflowAssetRegistry([asset,{...asset,source:{...asset.source,generationSpecVersion:'v2'}}],[]),/conflicting/);
 assert.throws(()=>assembleWorkflowAssetRegistry([],[binding('hero',[])]),/unknown asset/);
 assert.equal(assembleWorkflowAssetRegistry([asset],[binding('hero',[]),binding('hero',[])]).bindings.length,1);
 assert.equal(asset.source.generationSpecVersion,'v1');
});

test('replayed bindings merge exact consumers without altering frozen inputs',()=>{
 const first=binding('hero',['clip-1']);
 const registry=assembleWorkflowAssetRegistry([asset],[first,binding('hero',['clip-2'])]);
 assert.deepEqual(registry.bindings[0].consumerClipIds,['clip-1','clip-2']);
 assert.deepEqual(first.consumerClipIds,['clip-1']);
 assert.throws(()=>assembleWorkflowAssetRegistry([asset],[first,{...first,objectId:'other'}]),/conflicting/);
});
test('invalid enum, missing source version, extra fields and duplicate consumers are explicit errors',()=>{
 for(const invalid of [{...asset,mediaType:'picture'},{...asset,source:{...asset.source,generationSpecVersion:''}},{...asset,role:'hero'}]) {
  assert.throws(()=>assembleWorkflowAssetRegistry([invalid],[]));
 }
 assert.throws(()=>assembleWorkflowAssetRegistry([asset],[{...binding('hero',[]),referenceRole:'character'}]));
 assert.throws(()=>assembleWorkflowAssetRegistry([asset],[binding('hero',['clip-1','clip-1'])]));
});
test('different assets and versions stay distinct; source aliasing must be resolved before assembly',()=>{
 const other={...asset,assetId:'asset-2',source:{...asset.source,generationSpecVersion:'v2'}};
 assert.equal(materializationItems(assembleWorkflowAssetRegistry([asset,other],[])).length,2);
 assert.throws(()=>assembleWorkflowAssetRegistry([asset,{...asset,assetId:'alias'}],[]),/multiple asset identities/);
});
