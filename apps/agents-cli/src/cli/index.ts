#!/usr/bin/env node
import { Command } from "commander";

import { startHarnessHttpServer } from "../bridge/http-server.js";

type ServeOptions = Readonly<{
  host: string;
  port: string;
  token?: string;
  bodyLimit: string;
}>;

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正整数，收到：${value}`);
  }
  return parsed;
}

const program = new Command();

program
  .name("tapcanvas-harness")
  .description("TapCanvas DeepSeek Harness bridge")
  .version("1.0.0");

program
  .command("serve")
  .description("启动 DeepSeek Harness HTTP/SSE bridge")
  .option("--host <host>", "监听地址", "127.0.0.1")
  .option("--port <port>", "监听端口", "8799")
  .option("--token <token>", "Bridge 鉴权 Token")
  .option("--body-limit <bytes>", "请求体大小限制（字节）", "8000000")
  .action(async (options: ServeOptions) => {
    const server = await startHarnessHttpServer({
      host: options.host,
      port: positiveInteger(options.port, "port"),
      workspaceRoot: process.env.AGENTS_WORKSPACE_ROOT?.trim() || process.cwd(),
      ...(options.token?.trim() ? { token: options.token.trim() } : {}),
      bodyLimitBytes: positiveInteger(options.bodyLimit, "body-limit"),
    });

    process.stdout.write(`[deepseek-harness] bridge listening on ${server.url}\n`);

    let closing = false;
    const close = async (signal: NodeJS.Signals): Promise<void> => {
      if (closing) return;
      closing = true;
      process.stdout.write(`[deepseek-harness] received ${signal}, closing bridge\n`);
      await server.close();
    };
    process.once("SIGINT", () => void close("SIGINT"));
    process.once("SIGTERM", () => void close("SIGTERM"));
  });

await program.parseAsync(process.argv);
