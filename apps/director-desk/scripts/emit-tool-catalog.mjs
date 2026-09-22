// 把导演台自己的工具契约导出成 TapCanvas 后端可导入的目录。
//
// 工具的真源是导演台的 src/automation/contract.ts（名称）与 tool-summaries.ts（面向模型的短描述），
// 这里只做投影，不复制内容：后端凭这份目录把 director_* 工具声明给模型，参数契约仍由导演台
// 自己在执行时校验，避免两处 schema 各自漂移。
//
// 由 prebuild 自动执行，产物直接落在 apps/hono-api 内，供其静态导入。

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(appDir, '../hono-api/src/modules/task/director-desk-tool-catalog.generated.json');

const { TOOL_DEFINITIONS } = await import('../src/automation/contract.ts');
const { toolSummaries } = await import('../src/automation/tool-summaries.ts');

const tools = TOOL_DEFINITIONS.map((tool) => ({
  name: tool.name,
  summary: toolSummaries[tool.name] ?? tool.description,
}));

if (!tools.length) throw new Error('director-desk tool catalog is empty');

const payload = {
  source: 'apps/director-desk/src/automation/contract.ts',
  toolCount: tools.length,
  tools,
};
const text = JSON.stringify(payload, null, 2) + '\n';

const previous = await fs.readFile(destination, 'utf8').catch(() => '');
if (previous !== text) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, text);
}
console.log(`Exported ${tools.length} director-desk tools to hono-api.`);
