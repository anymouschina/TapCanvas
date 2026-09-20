import { spawnSync } from 'node:child_process';

// Local operator diagnostic. All canvas evidence enters through the official CLI.
const flags = new Map();
for (let i = 2; i < process.argv.length; i += 2) flags.set(process.argv[i], process.argv[i + 1]);
const profile = flags.get('--profile');
const executionId = flags.get('--execution-id');
const nodeId = flags.get('--node-id');
const container = flags.get('--container');
if (profile !== 'local' || !executionId || !nodeId || !container) {
  throw new Error('Requires --profile local --execution-id --node-id --container');
}
const read = spawnSync('tapcanvas', ['api', 'call', '--profile', profile, '--endpoint', 'executionNodeRuns', '--executionId', executionId], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
if (read.status !== 0) throw new Error('Official executionNodeRuns read failed');
const rows = JSON.parse(read.stdout).data;
if (!Array.isArray(rows)) throw new Error('Expected execution node runs array');
const run = rows.find(row => row.nodeId === nodeId);
const bindings = run?.outputRefs?.ports?.['asset-bindings'];
if (!Array.isArray(bindings?.items)) throw new Error('Selected node has no asset-bindings collection');
const resources = bindings.items.map(item => {
  const value = item.value;
  if (typeof value?.imageUrl !== 'string' || typeof value?.nodeId !== 'string') throw new Error('Image binding is incomplete');
  return { itemId: item.itemId, nodeId: value.nodeId, url: value.imageUrl };
});
const probeCode = String.raw`
const { loadImage } = require('/app/node_modules/@napi-rs/canvas');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
let input = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  for (const resource of JSON.parse(input)) {
    const startedAt = Date.now();
    const result = { itemId: resource.itemId, nodeId: resource.nodeId, transport: 'http', timeoutMs: 8000 };
    try {
      const response = await fetch(resource.url, { signal: AbortSignal.timeout(8000) });
      result.httpStatus = response.status;
      result.contentType = response.headers.get('content-type');
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      result.bytes = bytes.length;
      result.signatureHex = bytes.subarray(0, 16).toString('hex');
      result.sha256 = createHash('sha256').update(bytes).digest('hex');
      const verify = spawnSync('ffmpeg', ['-v','error','-i','pipe:0','-frames:v','1','-f','null','-'], { input: bytes, maxBuffer: 1024 * 1024 });
      result.ffmpegExitCode = verify.status;
      result.ffmpegError = verify.error?.code ?? verify.stderr?.toString().slice(0, 1200);
      if (result.signatureHex.startsWith('89504e470d0a1a0a')) {
        result.pngHeader = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bitDepth: bytes[24], colorType: bytes[25], interlace: bytes[28] };
        result.pngChunks = [];
        let offset = 8;
        while (offset + 12 <= bytes.length) {
          const length = bytes.readUInt32BE(offset);
          const type = bytes.toString('ascii', offset + 4, offset + 8);
          result.pngChunks.push({ type, length });
          offset += length + 12;
          if (result.pngChunks.length > 100) break;
        }
        result.pngParsedBytes = offset;
      }
      const image = await loadImage(bytes);
      result.width = image.width; result.height = image.height; result.decoded = true;
    } catch (error) {
      result.errorName = error.name;
      result.reason = String(error.message).replace(/https?:\/\/[^\s"']+/g, '[URL]');
      if (error.cause?.code) result.causeCode = error.cause.code;
    }
    result.elapsedMs = Date.now() - startedAt;
    process.stdout.write(JSON.stringify(result) + '\n');
  }
});`;
const probe = spawnSync('docker', ['exec', '-i', container, 'node', '-e', probeCode], {
  input: JSON.stringify(resources), encoding: 'utf8', maxBuffer: 1024 * 1024,
});
if (probe.status !== 0) throw new Error('Container image resource probe failed');
process.stdout.write(probe.stdout);
