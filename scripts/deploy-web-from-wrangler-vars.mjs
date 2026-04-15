#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const WRANGLER_TOML = 'wrangler.toml';
const REQUIRED_VITE_VARS = ['VITE_API_BASE', 'VITE_GITHUB_CLIENT_ID', 'VITE_GITHUB_REDIRECT_URI'];

function parseTomlVars(text) {
  const lines = text.split(/\r?\n/);
  let inVarsSection = false;
  const vars = {};

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('[') && line.endsWith(']')) {
      inVarsSection = line === '[vars]';
      continue;
    }
    if (!inVarsSection) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!match) continue;

    const key = match[1];
    const rhs = match[2].trim();
    let value = rhs;

    if (rhs.startsWith('"') || rhs.startsWith("'")) {
      const quote = rhs[0];
      const end = rhs.lastIndexOf(quote);
      value = end > 0 ? rhs.slice(1, end) : rhs.slice(1);
      if (quote === '"') {
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    } else {
      value = rhs.split(/\s+#/)[0].trim();
    }

    vars[key] = value;
  }

  return vars;
}

function run(cmd, args, env) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env,
    shell: false,
  });
  if (typeof result.status !== 'number' || result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const toml = readFileSync(WRANGLER_TOML, 'utf8');
const allVars = parseTomlVars(toml);

for (const key of REQUIRED_VITE_VARS) {
  if (!allVars[key] || !String(allVars[key]).trim()) {
    console.error(`[deploy:web:wrangler-vars] Missing required wrangler var: ${key}`);
    process.exit(1);
  }
}

const env = { ...process.env, ...allVars };

run('pnpm', ['--filter', '@tapcanvas/web', 'build'], env);

if (process.argv.includes('--build-only')) {
  console.log('[deploy:web:wrangler-vars] Build completed (--build-only).');
  process.exit(0);
}

run('npx', ['wrangler', 'deploy'], env);
