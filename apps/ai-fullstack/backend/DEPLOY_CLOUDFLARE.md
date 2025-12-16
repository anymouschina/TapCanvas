# Deploy to Cloudflare (Workers + Containers)

This directory (`apps/ai-fullstack/backend`) is a FastAPI service packaged as a Cloudflare **Container** and exposed via a Cloudflare **Worker + Durable Object** proxy.

## Prereqs

- Cloudflare account with **Containers (Beta)** enabled
- Wrangler installed (`npx wrangler --version`)
- Logged in: `npx wrangler login`

## Configure

1. Copy config:
   - `cp wrangler.example.jsonc wrangler.jsonc`
2. Set secrets (recommended; do not hardcode API keys in `vars`):
   - `npx wrangler secret put GEMINI_API_KEY`
   - `npx wrangler secret put OPENAI_API_KEY`
   - Optional: `npx wrangler secret put OPENAI_BASE_URL`
3. If you already have a local `.env`, mirror it into Cloudflare:
   - Non-secret values go in `wrangler.jsonc` `"vars"`.
   - Secret values (like `OPENAI_API_KEY`) must be set via `wrangler secret put`.

## Deploy

From this directory:

```bash
npx wrangler login
npx wrangler deploy
```

Wrangler will build the container from `Dockerfile`, upload it, and deploy the Worker defined by `worker/index.ts`.

If you see an `EPERM` error about Wrangler writing logs/config under `~/Library/Preferences/.wrangler`, run with a writable config dir:

```bash
XDG_CONFIG_HOME="$PWD/.xdg" npx wrangler deploy
```

If your environment blocks Wrangler log writes, you can combine both:

```bash
XDG_CONFIG_HOME="$PWD/.xdg" npx wrangler login
XDG_CONFIG_HOME="$PWD/.xdg" npx wrangler deploy
```

## Verify

- Health: `GET /health` → `ok`
- Prompt API: `POST /api/prompt/generate`

## Troubleshooting

### `pip ... Read timed out` during container build

This usually means the build environment has slow/unstable access to `pypi.org` / `files.pythonhosted.org`.

- The `Dockerfile` already increases pip timeouts/retries; if it still fails, you have two supported options:

1) **Set the mirror in `Dockerfile`** (simplest)

Edit `Dockerfile` and change the default `ARG PIP_INDEX_URL=...` (and optionally `PIP_TRUSTED_HOST`), then run `npx wrangler deploy` again.

2) **Prebuild the image locally, then push and reference it**

Wrangler `deploy` does not support Docker `--build-arg`. Instead, build with Docker yourself, push to Cloudflare's managed registry, then set `wrangler.jsonc` to use the pushed image.

```bash
# One-command helper (recommended)
chmod +x scripts/cloudchamber-build-push.sh
chmod +x scripts/build-wheelhouse.sh

# Optional (recommended): build a local wheel cache (avoids network/proxy during docker build)
USE_WHEELHOUSE=1 \
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn \
IMAGE_TAG=ai-fullstack-backend:mirror \
./scripts/cloudchamber-build-push.sh
```

If your mirror has intermittent TLS issues, rerun with the official index (or set it as fallback):

```bash
PYTHON_BIN=python3.11 \
USE_WHEELHOUSE=1 \
PIP_INDEX_URL=https://pypi.org/simple \
IMAGE_TAG=ai-fullstack-backend:mirror \
./scripts/cloudchamber-build-push.sh
```

Note: `vendor/wheels` may contain a mix of `*.whl` and source archives (e.g. `*.tar.gz`) for packages that don't publish Linux wheels; the Docker build will still install from these files without hitting the network.

### Recommended build pattern (like the neighboring project)

This repo now includes a pinned `requirements.txt` and the `Dockerfile` installs dependencies from it before copying application code. This keeps the dependency install layer cached between deploys (matching the `CACHED` behavior you saw in the other project).

Then update `wrangler.jsonc` container `image` from `./Dockerfile` to `registry.cloudchamber.cfdata.org/ai-fullstack-backend:mirror`, and deploy with `npx wrangler deploy`.

### `ProxyError('Cannot connect to proxy' ... Connection refused)` during build

This usually means pip is picking up a proxy (often `127.0.0.1:xxxx`) from injected build env/config, which is unreachable inside the build container.

- The `Dockerfile` runs pip under `env -i` + `pip --isolated` to prevent any injected proxy variables (common with Colima/Docker Desktop) from affecting downloads. Rebuild after pulling latest changes.

### Why another project deploys fine

If your other project shows the dependency install step as `CACHED` during `docker build`, it may not be running pip at all on subsequent deploys (only copying code layers). In this repo, the image build installs the local package (`pip install .`), which typically invalidates the dependency layer more often and triggers real network downloads—so any proxy/network instability becomes visible here.
