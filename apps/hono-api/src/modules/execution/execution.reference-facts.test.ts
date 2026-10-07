import { expect, it } from 'vitest';
import { chapterAssetPlanSchema } from '../../../../../packages/schemas/video-authoring-stages/schema.mjs';
import { FROZEN_REFERENCE_FACTS_KEYWORD, type ReferenceFactObservation } from '../../../../../packages/schemas/json-schema-relations/reference-facts.mjs';
import { bindRegisteredAssetReferenceSchema } from './execution.asset-reference-schema';
import { createWorkflowProjectContext } from './execution.project-context';
import { projectNodeAssetsFromCanvases } from '../material/material.project-node-assets';
import { validateWorkflowToolArguments } from './execution.json-schema-validator';
import { validateJsonSchemaStructure } from '../../../../agents-cli/src/bridge/json-schema-structural-validator';

const assets = projectNodeAssetsFromCanvases([{ projectId:'p',ownerType:'project',ownerId:'p',flowId:'c',canvasRevision:1,createdAt:'2026-09-20',updatedAt:'2026-09-20',
  data:{nodes:['same','different','unknown'].map(id=>({id,data:{kind:'image',imageUrl:`https://assets.test/${id}.png`}})),edges:[]} }]);
const initial = createWorkflowProjectContext({projectId:'p',canvasId:'c',principalId:'owner',canvasData:{nodes:[],edges:[]},assets});
const context = {...initial,assetSnapshot:initial.assetSnapshot.map(asset=>({...asset,sourceFacts:{...asset.sourceFacts,physicalIdentityKey:asset.nodeId==='same'?'identity-a':asset.nodeId==='different'?'identity-b':null}}))};
const ids = Object.fromEntries(context.assetSnapshot.map(asset=>[asset.nodeId,asset.assetId]));
const schema = bindRegisteredAssetReferenceSchema(chapterAssetPlanSchema,context);
const plan = {prompt:'character view',negativePrompt:'no labels',identityAnchors:['face'],prohibitedDrift:['identity'], identityBoardSpec: {
  layout: 'identity_board_four_view', faceViews: ['front', 'profile'], fullBodyViews: ['front', 'back'],
  crossViewConsistency: true, referenceRoleIsolation: true, neutralReferenceBackground: true,
  readableTextVisible: true, brandingVisible: false, neutralBaseState: true, canonicalNameVisible: false, ipSafeOriginal: true,
}};
const candidate = (imageSource:Record<string,unknown>) => ({objectRegistry:[{objectId:'character',kind:'character',name:'actor',physicalIdentityKey:'identity-a',referenceRole:'identity',identityInvariant:'same identity',imageSource}],
  backgroundPlans:[{objectId:'scene',plan:{assetId:'bg',displayName:'room',prompt:'room',negativePrompt:'no text',referenceAssetBindings:[]}}]});

it('both validators enforce known identity equality on reuse and identity generation inputs',()=>{
  const frozen = JSON.parse(JSON.stringify(schema)) as Record<string,unknown>;
  const table = frozen[FROZEN_REFERENCE_FACTS_KEYWORD] as Record<string,Record<string,unknown>>;
  expect(table.project_image?.[ids.same!]).toEqual({physicalIdentityKey:'identity-a'});
  expect(table.project_image?.[ids.unknown!]).toBeUndefined();
  expect(Object.keys(frozen).filter(key => key === FROZEN_REFERENCE_FACTS_KEYWORD)).toHaveLength(1);
  for (const id of [ids.same!,ids.different!]) for (const imageSource of [{mode:'reuse',assetIds:[id]},{mode:'generate',referenceAssetBindings:[{assetId:id,role:'identity'}],plan}]) {
    const value=candidate(imageSource);
    const hono=validateWorkflowToolArguments(frozen,value);
    const agent=validateJsonSchemaStructure({schema:frozen,value});
    expect(hono.length===0).toBe(id===ids.same);
    expect(agent.length===0).toBe(id===ids.same);
    if(id===ids.different) {
      expect(hono.some(issue=>issue.message.includes('identity-b')&&issue.message.includes('identity-a'))).toBe(true);
      expect(agent.some(issue=>issue.keyword==='x-referenceFactEquality'&&issue.path.includes('imageSource'))).toBe(true);
    }
  }
});

it('style/layout are not identity claims and unknown source identity is diagnostic only',()=>{
  for(const role of ['style','layout']) {
    const value=candidate({mode:'generate',referenceAssetBindings:[{assetId:ids.different!,role}],plan});
    expect(validateWorkflowToolArguments(schema,value)).toEqual([]);
    expect(validateJsonSchemaStructure({schema,value})).toEqual([]);
  }
  const value=candidate({mode:'reuse',assetIds:[ids.unknown!]});
  const honoObservations:ReferenceFactObservation[]=[];
  const agentObservations:ReferenceFactObservation[]=[];
  expect(validateWorkflowToolArguments(schema,value,honoObservations)).toEqual([]);
  expect(validateJsonSchemaStructure({schema,value,observations:agentObservations})).toEqual([]);
  expect(honoObservations).toEqual(agentObservations);
  expect(honoObservations).toHaveLength(1);
  expect(honoObservations[0]?.code).toBe('reference_fact_unknown');
});
