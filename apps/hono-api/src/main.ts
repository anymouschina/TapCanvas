import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";

import { AppModule } from "./app.module";
import { createTapCanvasApp } from "./app";
import { loadLocalEnvFiles } from "./platform/node/local-env";
import { createNodeWorkerEnv } from "./platform/node/node-env";
import { mountHonoToExpress } from "./platform/node/hono-express-adapter";
import { maybeAutostartAgentsBridge } from "./platform/node/agents-bridge-autostart";

async function bootstrap() {
	loadLocalEnvFiles();
	await maybeAutostartAgentsBridge();

	const app = await NestFactory.create<NestExpressApplication>(AppModule, {
		// Let Hono parse request bodies (avoid Express bodyParser consuming the stream).
		bodyParser: false,
	});

	const honoApp = await createTapCanvasApp();
	const env = await createNodeWorkerEnv();

	const express = app.getHttpAdapter().getInstance();
	mountHonoToExpress(express, honoApp, env);

	const portRaw = Number(process.env.PORT || 8788);
	const port = Number.isFinite(portRaw) ? portRaw : 8788;
	await app.listen(port, "0.0.0.0");
	// eslint-disable-next-line no-console
	console.log(`[api] listening on http://localhost:${port}`);
}

void bootstrap();
