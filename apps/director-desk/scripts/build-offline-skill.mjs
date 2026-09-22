import { build } from 'esbuild';
import fs from 'node:fs/promises';
import './build-builtin-skill.mjs';
await fs.mkdir('skills/director-desk/scripts', { recursive: true });
await build({ entryPoints: ['scripts/offline-project-entry.ts'], outfile: 'skills/director-desk/scripts/project-tool.mjs', bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: true, sourcemap: false });
console.log('Built standalone project creation and validation tool from the editor model.');
