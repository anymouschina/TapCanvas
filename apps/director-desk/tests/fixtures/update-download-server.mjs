import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

// Serves only synthetic test metadata and bytes, so updater tests need no website.
export function createUpdateFixtureServer(directory, installer) {
    if (path.basename(installer) !== installer) throw new Error('Invalid fixture filename');
    const files = new Map(['latest.yml', installer].map(name => ['/updates/win-x64/' + name, name]));
    return http.createServer(async (request, response) => {
        const name = files.get(new URL(request.url, 'http://localhost').pathname);
        if (!name || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404); response.end(); return; }
        try {
            const bytes = await fs.readFile(path.join(directory, name));
            response.writeHead(200, { 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
            response.end(request.method === 'HEAD' ? undefined : bytes);
        } catch { response.writeHead(404); response.end(); }
    });
}
