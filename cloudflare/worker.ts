export interface Env {
  ASSETS: Fetcher;
}

async function serveIndex(request: Request, env: Env) {
  const url = new URL(request.url);
  const indexUrl = new URL('/', url);
  return env.ASSETS.fetch(new Request(indexUrl, request));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const res = await env.ASSETS.fetch(request);
    if (
      res.status === 404 &&
      request.method === 'GET' &&
      !new URL(request.url).pathname.startsWith('/api/')
    ) {
      return serveIndex(request, env);
    }
    return res;
  },
};
