import { describe, expect, it, vi } from 'vitest';
import { bindChapterAssetPartSchema } from '../../../../../packages/schemas/video-authoring-stages/chapter-asset-fanout.mjs';
import { projectRuntimeBoundJsonSchema } from '../../../../../packages/schemas/json-schema-runtime-bindings/index.mjs';
import { projectNodeAssetsFromCanvases } from '../material/material.project-node-assets';
import { createWorkflowProjectContext } from './execution.project-context';
import { readWorkflowProjectImageFacts } from './execution.project-image-candidates';
import { lookupWorkflowProjectImages } from './execution.project-asset-lookup';
import { bindRegisteredAssetReferenceSchema } from './execution.asset-reference-schema';
import { validateWorkflowToolArguments } from './execution.json-schema-validator';
import { workflowAgentPrompt } from './execution.agent-runner';
import { prepareChapterAssetCollection } from './execution.chapter-asset-preparation';
import { createWorkflowAssetResolver } from './execution.asset-resolver';
import { executeRegisteredWorkflowNode, type WorkflowAgentRunRequest } from './execution.node-executors';
import type { WorkflowToolInvocationRequest } from './execution.tool-runner';

function fixture() {
  const url = 'https://owned.example/identity.png';
  const assets = projectNodeAssetsFromCanvases([{ projectId: 'project', ownerType: 'project', ownerId: 'project',
    flowId: 'previous-chapter', canvasRevision: 1, createdAt: '2026-09-20', updatedAt: '2026-09-20',
    data: { nodes: ['original', 'copy'].map(id => ({ id, type: 'taskNode', data: { kind: 'image',
      label: 'Persisted name', imageUrl: url, referenceType: 'character', physicalIdentityKey: 'body:stable',
      prompt: 'Frozen observed identity facts', assetPurpose: 'identity_anchor' } })), edges: [] } }]);
  const context = createWorkflowProjectContext({ projectId: 'project', canvasId: 'current-chapter', principalId: 'owner',
    canvasData: { nodes: [], edges: [] }, assets, selectedAssetIds: [] });
  const lookup = lookupWorkflowProjectImages(context, { referenceType: 'character', physicalIdentityKey: 'body:stable' });
  const chosen = lookup.candidates[0]!;
  const plan = { objectRegistry: [{ objectId: 'object', kind: 'character', name: 'Current source name',
    physicalIdentityKey: chosen.physicalIdentityKey, referenceRole: 'identity', identityInvariant: 'Frozen identity',
    imageSource: { mode: 'reuse', assetIds: [chosen.assetId] } }], backgroundPlans: [] };
  const schema = bindRegisteredAssetReferenceSchema(bindChapterAssetPartSchema({ objectId: 'object', kind: 'character',
    name: 'Current source name' }), context);
  const request: WorkflowAgentRunRequest = { executionId: 'execution', executionFamilyId: 'family', nodeId: 'author',
    ownerId: 'owner', flowId: 'workflow', projectId: 'project', workflowKey: 'workflow', instruction: 'Plan the source assets',
    outputArtifactType: 'tapcanvas.chapter-asset-part/v1', outputEncoding: 'json_object',
    jsonObjectContract: { allowedFields: ['objectRegistry', 'backgroundPlans'], jsonSchema: schema },
    deliveryRequirement: 'Deliver the source asset registry', modelKey: 'configured-model', maxOutputTokens: 4096,
    inputs: {}, requiredSkills: [], mountedKnowledgeCardIds: [], disabledSkills: [], disabledKnowledgeCardIds: [],
    allowedTools: ['tapcanvas_workflow_execution_inspect'], forcedAgentRole: 'writer', resumeOnly: false,
    previousEvidence: null, projectContext: context };
  return { url, assets, context, lookup, chosen, plan, schema, request };
}

describe('unselected project asset reuse across authoring and execution', () => {
  it.each([undefined, 'compact_structured'] as const)('starts without an asset catalog and resolves a requested identity (%s)', promptMode => {
    const { context, lookup, chosen, plan, schema, request } = fixture();
    const before = JSON.stringify(context);
    const prompt = workflowAgentPrompt({ ...request, promptMode, projectContextPromptMode: 'identity_only' });
    const authorSchema = JSON.stringify(projectRuntimeBoundJsonSchema(schema));
    for (const asset of context.assetSnapshot) {
      expect(prompt).not.toContain(asset.assetId);
      expect(authorSchema).not.toContain(asset.assetId);
    }
    expect(prompt).not.toContain('body:stable');
    expect(prompt).toContain('asset_match');
    expect(lookup).toMatchObject({ status: 'matched', basis: { handleCount: 2, mediaCount: 1 },
      candidates: [{ assetId: chosen.assetId, physicalIdentityKey: 'body:stable', aliases: [expect.any(String)] }] });
    expect(prompt).not.toContain('Frozen observed identity facts');
    expect(readWorkflowProjectImageFacts(context, [chosen.assetId])[0]?.sourceFacts.prompt)
      .toBe('Frozen observed identity facts');
    expect(validateWorkflowToolArguments(schema, plan)).toEqual([]);
    expect(validateWorkflowToolArguments(schema, { ...plan, objectRegistry: [{ ...plan.objectRegistry[0],
      physicalIdentityKey: 'invented-body' }] }).length).toBeGreaterThan(0);
    expect(validateWorkflowToolArguments(schema, { ...plan, objectRegistry: [{ ...plan.objectRegistry[0],
      imageSource: { mode: 'reuse', assetIds: ['outside-project'] } }] }).length).toBeGreaterThan(0);
    expect(JSON.stringify(context)).toBe(before);
  });

  it('resolves the source version and projects a ready chapter reference without submitting paid generation', async () => {
    const { context, assets, chosen, plan, schema, url } = fixture();
    expect(validateWorkflowToolArguments(schema, plan)).toEqual([]);
    const collection = prepareChapterAssetCollection({ assets: plan, projectContext: context,
      executionId: 'execution', nodeId: 'prepare' });
    expect(collection.items).toHaveLength(1);
    const item = collection.items[0]!.value;
    expect(item).toMatchObject({ existingAssetId: chosen.assetId, existingProjectId: context.projectId,
      asset: { source: { mode: 'existing', sourceAssetId: chosen.assetId } } });
    const resolver = createWorkflowAssetResolver({ context, loadVisibleAssets: async () => assets });
    const resolveProjectAsset = vi.fn(async ({ assetId }: { assetId: string }) => resolver.resolveAssetResource(assetId, 'image'));
    const invokeTool = vi.fn(async (request: WorkflowToolInvocationRequest) => ({ toolName: request.toolName,
      content: '', data: { ready: true, nodeId: 'chapter-reference' }, execution: null }));
    const runImage = vi.fn();
    const runVideo = vi.fn();
    const result = await executeRegisteredWorkflowNode({ executionId: 'execution', executionFamilyId: 'family',
      ownerId: 'owner', flowId: 'workflow', projectId: context.projectId, workflowKey: 'workflow',
      node: { id: 'image', type: 'taskNode', kind: 'workflowStage', data: { workflowImageModelKey: 'configured-image',
        workflowImageReferenceAssetBindings: [],
        workflowImageAspectRatio: '16:9', workflowImageSize: '2K', workflowAtomicSpec: { version: 1,
          category: 'tool', operation: 'image', executorRef: 'tapcanvas.image.generate/v1', executionMode: 'once',
          inputPorts: ['asset-items'], outputPorts: ['image'] } } },
      inputs: { 'asset-items': [item] }, flowVersionData: { workflowProjectContext: context,
        workflowDeliveryScope: { projectId: context.projectId, flowId: 'current-chapter', chapterId: 'chapter' } },
    }, { runAgent: vi.fn(), runJavascript: vi.fn(), runImage, runVideo, resolveProjectAsset, invokeTool });
    if (!result.ok) throw new Error(`Expected exact reuse delivery: ${JSON.stringify(result)}`);
    expect(runImage).not.toHaveBeenCalled();
    expect(runVideo).not.toHaveBeenCalled();
    expect(resolveProjectAsset).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'owner',
      projectId: context.projectId, assetId: chosen.assetId, preferredKind: 'image' }));
    expect(invokeTool).toHaveBeenCalledWith(expect.objectContaining({ toolName: 'tapcanvas_asset_add_to_canvas',
      flowId: 'current-chapter', chapterId: 'chapter', args: expect.objectContaining({ assetId: chosen.assetId }) }));
    expect(result.outputRefs.ports.image).toMatchObject({ imageUrl: url, generatedAssetId: chosen.assetId,
      nodeId: 'chapter-reference', taskId: null });
    expect(result.outputRefs.evidence).toMatchObject({ providerStatus: 'reused', assetOrigin: 'existing_asset',
      assetReferenceProjection: { status: 'success', nodeId: 'chapter-reference' } });
    expect(result.outputRefs.artifacts[0]).toMatchObject({ identity: chosen.assetId, media: { kind: 'image', url } });
  });
});
