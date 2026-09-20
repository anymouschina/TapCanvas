import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Build-time compilation of the same pure definition used by the editor.
// No browser, database, user flow or media service is involved.
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../apps/hono-api/package.json', import.meta.url));
const { build } = require('esbuild');
const result = await build({
  entryPoints: [path.join(root, 'apps/web/src/canvas/videoWorkflowDefinition.ts')],
  bundle: true, write: false, platform: 'node', format: 'esm',
  alias: {
    '@tapcanvas/video-orchestrator-protocol': path.join(root, 'packages/schemas/video-orchestrator-protocol/index.ts'),
    '@tapcanvas/workflow-kernel-protocol': path.join(root, 'packages/schemas/workflow-kernel-protocol/index.ts'),
  },
});
const definition = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const version = definition.VIDEO_ATOMIC_CANVAS_DEFINITION_VERSION;
const workflowInstanceId = `builtin-video-production-v${version}`;
const workflowGroupId = `${workflowInstanceId}:group`;
const patch = definition.buildVideoWorkflowCanvasDefinitionPatch({
  workflowInstanceId, workflowGroupId, executionScope: 'media_delivery',
  executionVariant: 'full_video', existingNodes: [], existingEdges: [],
});
const groupPatch = patch.patchNodeData.find(node => node.id === workflowGroupId);
const triggerPatch = patch.patchNodeData.find(node => node.id === `${workflowInstanceId}:manual-trigger`);
if (!groupPatch || !triggerPatch || !patch.createNodes?.length) throw new Error('Canonical workflow definition is incomplete');
const summary = '一键成片：根据当前项目、章节与真实画布素材，由智能体完成剧情规划、共享资产规划、逐段视觉设计与提示词，沿持久 Workflow IR 生成视频并交付最终成片。onlyVideoNodes=true 时只准备并保存视频节点和真实引用，不提交视频生成或合成。媒体模型与规格来自调用者显式选择或当前账户配置；缺失时显式要求补充。按字长机械拆分不属于此工作流。';
const groupWidth = Math.max(...patch.createNodes.map(node => node.position.x + definition.NODE_WIDTH)) + 40;
const groupHeight = Math.max(...patch.createNodes.map(node => node.position.y + definition.NODE_HEIGHT)) + 40;
const graph = {
  nodes: [
    { id: workflowGroupId, type: 'groupNode', position: { x: 0, y: 0 }, style: { width: groupWidth, height: groupHeight }, data: { ...groupPatch.data, label: `一键成片 v${version}` } },
    { id: triggerPatch.id, type: 'taskNode', parentId: workflowGroupId, position: { x: 40, y: 80 }, data: { ...triggerPatch.data, kind: 'workflowTrigger', label: '一键成片', status: 'idle', workflowCapabilityDescription: summary } },
    ...patch.createNodes,
  ],
  edges: patch.createEdges,
  viewport: { x: 0, y: 0, zoom: 1 },
  workflowCanvasDefinitionVersion: version,
  workflowCanvasDefinitionFingerprint: definition.VIDEO_ATOMIC_CANVAS_DEFINITION_FINGERPRINT,
};
const output = path.join(root, 'apps/hono-api/src/modules/agents/system-video-production-workflow.graph.json');
const serialized = JSON.stringify(graph, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await readFile(output, 'utf8') !== serialized) throw new Error('System video workflow differs from the editor; run scripts/export-system-video-workflow.mjs');
} else {
  await writeFile(output, serialized);
}
console.log(`System video workflow v${version}: ${graph.nodes.length} nodes, ${graph.edges.length} edges (${process.argv.includes('--check') ? 'verified' : 'exported'})`);
