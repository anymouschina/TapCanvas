# Deployment notes

`parse-video` is a Go HTTP service. It is not a browser dependency: the Hono API calls `GET /api/v1/parse?url=…`, then streams the resolved media into TapCanvas object storage.

Both `apps/hono-api/docker-compose.yml` and `apps/hono-api/docker-compose.prod.yml` define a private `parse-video` service on the Compose network. It is not published to the host. The API receives `PARSE_VIDEO_BASE_URL=http://parse-video:8080` plus optional `PARSE_VIDEO_USERNAME`, `PARSE_VIDEO_PASSWORD`, and `PARSE_VIDEO_TIMEOUT_MS`.

For production, build and publish the image from `apps/parse-video` and set `TAPCANVAS_PARSE_VIDEO_IMAGE` in the deployment environment. Keep the resolver credentials and platform cookie/proxy settings in the secret store. The API still owns authorization, object-storage hosting, asset registration, canvas persistence, and traceable failure reporting.

The development Compose file accepts `PARSE_VIDEO_GO_IMAGE` so deployments behind Docker Hub egress restrictions can point the builder at an internal Go base-image mirror.

The service has no database and can be scaled independently. If it is unavailable, imports fail explicitly with a parse-video service error; the API does not substitute browser scraping or a second hidden downloader.
