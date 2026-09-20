import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectRegisteredAssetPlans } from './index.mjs';
const fixture = () => ({objectRegistry:[{objectId:'p',kind:'prop',name:'物件',physicalIdentityKey:null}],assetPlans:[{objectId:'p',prompt:'物件参考',negativePrompt:'无文字'}]});
test('non-character identity fields return repair evidence without changing candidate', () => {
  const value=fixture(); value.assetPlans[0].identityBoardSpec={layout:'identity_board_four_view'};
  const original=structuredClone(value);
  assert.match(inspectRegisteredAssetPlans(value), /identityBoardSpec belongs only to character/);
  assert.deepEqual(value,original);
  delete value.assetPlans[0].identityBoardSpec;
  assert.equal(inspectRegisteredAssetPlans(value),null);
});
test('registry bindings and duplicates are exact structural identities',()=>{
  const value=fixture();value.assetPlans[0].objectId='missing';
  assert.match(inspectRegisteredAssetPlans(value),/exact objectRegistry/);
  value.assetPlans[0].objectId='p';value.objectRegistry.push({...value.objectRegistry[0]});
  assert.match(inspectRegisteredAssetPlans(value),/duplicates/);
});
test('unrelated artifacts are unaffected',()=>assert.equal(inspectRegisteredAssetPlans({shots:[]}),null));
