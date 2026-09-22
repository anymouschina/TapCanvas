// Explicitly run to acquire public test fixtures. Nothing here is included in the app payload.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve('test-assets/external');
await fs.mkdir(root, { recursive: true });
async function fetchBytes(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'DirectorDesk-Asset-Tests' } });
    if (!response.ok) throw new Error(`Fixture download failed: ${response.status} ${url}`);
    return Buffer.from(await response.arrayBuffer());
}
const repo = 'KhronosGroup/glTF-Sample-Assets';
const revision = JSON.parse((await fetchBytes(`https://api.github.com/repos/${repo}/commits/main`)).toString()).sha;
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Invalid upstream revision');
const base = `https://raw.githubusercontent.com/${repo}/${revision}`;
const files = [];
async function save(relative, url) {
    const target = path.resolve(root, relative);
    if (!target.startsWith(root + path.sep)) throw new Error('Fixture path escapes root');
    const bytes = await fetchBytes(url);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    files.push({ file: relative, url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    return bytes;
}
for (const name of ['CesiumMan', 'RiggedFigure', 'SheenChair']) {
    await save(`${name}/LICENSE.md`, `${base}/Models/${name}/LICENSE.md`);
    await save(`${name}/metadata.json`, `${base}/Models/${name}/metadata.json`);
    const bytes = await save(`${name}/${name}.glb`, `${base}/Models/${name}/glTF-Binary/${name}.glb`);
    if (bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length)
        throw new Error(`Invalid GLB: ${name}`);
    const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)).trim());
    const dependencies = [...(gltf.buffers ?? []), ...(gltf.images ?? [])].filter(x => x.uri && !x.uri.startsWith('data:'));
    if (dependencies.length) throw new Error(`Unexpected external GLB dependencies: ${name}`);
    console.log(`${name}: ${gltf.meshes?.length ?? 0} meshes, ${gltf.skins?.length ?? 0} skins, ${gltf.animations?.length ?? 0} animations`);
}
for (const file of ['CC-BY-4.0.txt', 'CC0-1.0.txt', 'LicenseRef-LegalMark-Cesium.txt'])
    await save(`licenses/${file}`, `${base}/LICENSES/${file}`);
await save('kenney_furniture-kit.zip', 'https://kenney.nl/media/pages/assets/furniture-kit/440e0608a4-1677580847/kenney_furniture-kit.zip');
await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({ downloadedAt: new Date().toISOString(), upstreamRevision: revision,
    scope: 'local-test-only; excluded from release', sources: ['https://github.com/KhronosGroup/glTF-Sample-Assets', 'https://kenney.nl/assets/furniture-kit'], files }, null, 2) + '\n');
await fs.writeFile(path.join(root, 'README.md'), '# External model test fixtures\n\nLocal test fixtures only. Not part of the installer or public example projects.\n\n- CesiumMan and RiggedFigure: CC-BY-4.0. See each model metadata for authors and attribution, and the accompanying license files. Cesium logos/trademarks have separate terms.\n- SheenChair model: CC0-1.0; accompanying metadata: CC-BY-4.0.\n- Kenney Furniture Kit: CC0-1.0; retain the included license on extraction.\n\n`manifest.json` records original URLs, pinned Khronos revision, sizes and SHA-256 checksums. Original assets are unchanged.\n');
console.log(`Saved ${files.length} downloaded files and provenance manifest to test-assets/external.`);
