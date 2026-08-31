#!/usr/bin/env node
/**
 * 订阅画布 SSE 事件流。
 * 连接 GET /public/flows/:flowId/events，实时打印节点/边变更。
 *
 * 用法：
 *   node apps/agents-cli/skills/tapcanvas-api/scripts/subscribe.mjs --flowId <id> [--timeout 60]
 *   node apps/agents-cli/skills/tapcanvas-api/scripts/subscribe.mjs --projectId <id> [--timeout 60]
 *   node apps/agents-cli/skills/tapcanvas-api/scripts/subscribe.mjs --chapterId <id> [--timeout 60]
 *   node apps/agents-cli/skills/tapcanvas-api/scripts/subscribe.mjs --executionId <id> [--after 0] [--timeout 60]
 *
 * 收到指定 event 后自动退出（用于脚本感知完成）：
 *   --waitFor "flow_updated"   收到任意包含该 event 的消息后退出
 *   --timeout 120              最多等待秒数（默认 120）
 */

import fs from "node:fs";
import path from "node:path";
import {
  profileRequestBaseUrl,
  resolveProfileCredentials,
} from "./profile-config.mjs";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const skillRoot = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(skillRoot, "config.json");

function readConfig(configPath) {
  const resolved = path.resolve(process.cwd(), configPath || defaultConfigPath);
  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    const value = JSON.parse(raw);
    return { path: resolved, value };
  } catch {
    throw new Error(`Config file is missing or invalid JSON: ${resolved}`);
  }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const cur = argv[i];
    if (!cur.startsWith("--")) continue;
    const key = cur.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) { out[key] = true; continue; }
    out[key] = next;
    i += 1;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = readConfig(args.config);
  const { profile, apiBaseUrl, apiKey, authToken } = resolveProfileCredentials({
    args,
    config: config.value,
    configPath: config.path,
    environment: process.env,
  });

  const flowId = String(args.flowId || "").trim();
  const projectId = String(args.projectId || "").trim();
  const chapterId = String(args.chapterId || "").trim();
  const executionId = String(args.executionId || "").trim();
  const scopeCount = [flowId, projectId, chapterId, executionId].filter(Boolean).length;
  if (scopeCount !== 1) {
    throw new Error("Exactly one of --flowId, --projectId, --chapterId, or --executionId is required");
  }

  const timeoutSec = Number(args.timeout ?? 120);
  const waitFor = typeof args.waitFor === "string" ? args.waitFor.trim() : null;
  const afterRaw = Number(args.after ?? 0);
  const after = Number.isFinite(afterRaw) && afterRaw >= 0 ? Math.floor(afterRaw) : 0;

  const publicBaseUrl = profileRequestBaseUrl({ profile, apiBaseUrl, access: "public" });
  const protectedBaseUrl = profileRequestBaseUrl({ profile, apiBaseUrl, access: "protected" });
  const url = flowId
    ? `${publicBaseUrl}/public/flows/${encodeURIComponent(flowId)}/events`
    : projectId
      ? `${protectedBaseUrl}/projects/${encodeURIComponent(projectId)}/canvas-events`
      : chapterId
        ? `${protectedBaseUrl}/chapters/${encodeURIComponent(chapterId)}/canvas-events`
        : `${protectedBaseUrl}/executions/${encodeURIComponent(executionId)}/events?after=${after}`;
  const auth = authToken
    ? (authToken.startsWith("Bearer ") ? authToken : `Bearer ${authToken}`)
    : `Bearer ${apiKey}`;

  process.stderr.write(`[subscribe] connecting to ${url}\n`);

  const ac = new AbortController();
  const timer = setTimeout(() => {
    process.stderr.write(`[subscribe] timeout after ${timeoutSec}s\n`);
    ac.abort();
  }, timeoutSec * 1000);

  try {
    const res = await fetch(url, {
      headers: { Authorization: auth, Accept: "text/event-stream" },
      signal: ac.signal,
    });

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      throw new Error(`SSE connect failed ${res.status}: ${text}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });

      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";

      for (const block of parts) {
        let event = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data = line.slice(5).trim();
        }

        const entry = { event, data: data ? (() => { try { return JSON.parse(data); } catch { return data; } })() : null };
        process.stdout.write(JSON.stringify(entry) + "\n");

        if (waitFor && event === waitFor) {
          process.stderr.write(`[subscribe] received "${waitFor}", exiting\n`);
          clearTimeout(timer);
          ac.abort();
          return;
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
