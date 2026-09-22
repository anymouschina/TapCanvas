// Public upstream loader fixtures, local QA only. No redistribution/license grant is inferred for the models.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = 'test-assets/external/three-fbx', base = 'https://raw.githubusercontent.com/mrdoob/three.js/r185';
await fs.mkdir(root, { recursive: true });
const files = [];
for (const name of ['Samba Dancing.fbx', 'monkey_embedded_texture.fbx', 'README.md', 'LICENSE']) {
    const url = name === 'LICENSE' ? base + '/LICENSE' : base + '/examples/models/fbx/' + encodeURIComponent(name);
    const target = root + '/' + (name === 'README.md' ? 'UPSTREAM-README.md' : name);
    let bytes;
    try { bytes = await fs.readFile(target); }
    catch {
        const response = await fetch(url, { signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw Error('FBX fixture download failed: ' + response.status);
        bytes = Buffer.from(await response.arrayBuffer()); await fs.writeFile(target, bytes);
    }
    files.push({ file: target.slice(root.length + 1), url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await fs.writeFile(root + '/manifest.json', JSON.stringify({ downloadedAt: new Date().toISOString(), upstreamTag: 'r185', scope: 'local QA only; excluded from release',
    license: 'Repository code LICENSE and directory README retained. No model-specific redistribution grant established for these two FBX fixtures. Do not ship them.', files }, null, 2) + '\n');
console.log('FBX fixtures and source/license records ready: ' + files.length + ' files.');
