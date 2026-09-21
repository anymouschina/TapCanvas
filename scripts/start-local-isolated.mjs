import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps/hono-api/package.json'));
const dotenv = require('dotenv');
const env = { ...process.env, ...dotenv.parse(fs.readFileSync(path.join(root, 'apps/hono-api/.env'))) };
const database = new URL(env.DATABASE_URL);
const redis = new URL(env.REDIS_URL);
if (database.pathname === '/tapcanvas' || redis.pathname === '' || redis.pathname === '/0') {
  throw new Error('Isolated startup requires a separate DATABASE_URL database and nonzero Redis database.');
}
if (!env.DSH_HOME || !env.TAPCANVAS_API_INTERNAL_BASE || !env.AGENTS_BRIDGE_BASE_URL) {
  throw new Error('DSH_HOME, TAPCANVAS_API_INTERNAL_BASE and AGENTS_BRIDGE_BASE_URL must be configured.');
}
const stateDir = path.join(root, '.data/local-stack');
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const pidFile = path.join(stateDir, 'pids.json');
const pids = fs.existsSync(pidFile) ? JSON.parse(fs.readFileSync(pidFile, 'utf8')) : {};
function running(pid) {
  if (!Number.isSafeInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}
function listener(port) {
  try { return Number(execFileSync('lsof', ['-t', '-iTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim()); }
  catch { return null; }
}
function owned(pid) {
  const cwd = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
  return cwd.split('\n').some(line => line === 'n' + root || line.startsWith('n' + root + '/'));
}
function launch(name, command, args, cwd, port, serviceEnv = env) {
  const existing = port ? listener(port) : pids[name];
  if (existing && running(existing)) {
    if (!owned(existing)) throw new Error(name + ' is occupied by another workspace: ' + existing);
    console.log(name + ': reusing ' + existing);
    return;
  }
  const log = fs.openSync(path.join(stateDir, name + '.log'), 'a', 0o600);
  const child = spawn(command, args, { cwd, env: serviceEnv, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  pids[name] = child.pid;
  fs.writeFileSync(pidFile, JSON.stringify(pids, null, 2), { mode: 0o600 });
  console.log(name + ': started ' + child.pid);
}
async function health(url) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Service did not become healthy: ' + url + '; see ' + stateDir);
}
const gatewayDatabase = new URL(env.NEW_API_SQL_DSN);
if (gatewayDatabase.pathname === '/tapcanvas_new_api' || gatewayDatabase.pathname === database.pathname) {
  throw new Error('Isolated gateway requires its own NEW_API_SQL_DSN database.');
}
const gatewayRedis = new URL(env.NEW_API_REDIS_CONN_STRING);
if (!gatewayRedis.pathname || gatewayRedis.pathname === '/0' || gatewayRedis.href === redis.href) {
  throw new Error('Isolated gateway requires a separate Redis database.');
}
const gatewayUrl = new URL(env.NEW_API_INTERNAL_BASE_URL);
const gatewayEnv = {
  ...env,
  SQL_DSN: env.NEW_API_SQL_DSN,
  UPSTREAM_CATALOG_CHANNEL_ID: env.NEW_API_UPSTREAM_CATALOG_CHANNEL_ID,
  REDIS_CONN_STRING: env.NEW_API_REDIS_CONN_STRING,
  PORT: gatewayUrl.port,
  TAPCANVAS_INTERNAL_TOKEN: env.NEW_API_INTERNAL_TOKEN,
  TAPCANVAS_INTERNAL_TOKEN_REQUIRED: 'true',
  SESSION_SECRET: env.NEW_API_SESSION_SECRET,
  CRYPTO_SECRET: env.NEW_API_CRYPTO_SECRET,
  TAPCANVAS_ROOT_USERNAME: env.NEW_API_ROOT_USERNAME || 'admin',
  TAPCANVAS_ROOT_PASSWORD: env.NEW_API_ROOT_PASSWORD || '123456',
  NODE_NAME: 'tapcanvas-dsh-new-api',
};
launch('new-api', path.join(stateDir, 'new-api'), [], root, Number(gatewayUrl.port), gatewayEnv);
await health(new URL('/api/status', gatewayUrl).href);
launch('bridge', process.execPath, ['--input-type=module', '-e', "import {startHarnessHttpServer} from './apps/agents-cli/dist/bridge/http-server.js'; const server=await startHarnessHttpServer({host:'127.0.0.1',port:8799,workspaceRoot:process.cwd(),token:process.env.AGENTS_BRIDGE_TOKEN});console.log('DSH bridge',server.url);"], root, 8799);
launch('api', 'pnpm', ['dev:stable'], path.join(root, 'apps/hono-api'), 8788);
await Promise.all([health('http://127.0.0.1:8799/health'), health('http://127.0.0.1:8788/health/version')]);
for (const name of ['async-image-worker', 'inprocess-worker', 'workflow-runtime-worker']) {
  launch(name, process.execPath, ['-r', 'ts-node/register/transpile-only', '-r', 'tsconfig-paths/register', 'scripts/' + name + '.ts'], path.join(root, 'apps/hono-api'), name === 'workflow-runtime-worker' ? 8790 : undefined);
}
launch('web', 'pnpm', ['--filter', '@tapcanvas/web', 'dev', '--host', '127.0.0.1', '--port', '5175', '--strictPort'], root, 5175);
await health('http://127.0.0.1:5175/api/health/version');
console.log('TapCanvas: http://localhost:5175; database=' + database.pathname.slice(1) + '; Redis=' + redis.pathname);
