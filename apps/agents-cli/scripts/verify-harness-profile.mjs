import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dshPackagePath = require.resolve("@deepseek-ai/dsh/package.json");
const dshBin = path.join(path.dirname(dshPackagePath), "lib", "bin.js");
const patchPath = path.join(appRoot, "harness", "tapcanvas.patch.yml");
const temporaryHome = await mkdtemp(path.join(os.tmpdir(), "tapcanvas-dsh-profile-"));
const requestSkills = path.join(temporaryHome, "request-skills");
await mkdir(requestSkills);

const harness = new DeepSeekHarness({
  dshBin,
  profile: "sdk",
  patches: [patchPath],
  dshHome: temporaryHome,
  processCwd: appRoot,
  cwd: appRoot,
  provider: "tapcanvas",
  model: "profile-verification",
  initializeTimeoutMs: 30_000,
  env: {
    ...process.env,
    DSH_HOME: temporaryHome,
    DSH_TELEMETRY_DISABLED: "1",
    DSH_BUNDLED_SKILL_DIR: path.join(appRoot, "skills"),
    TAPCANVAS_DSH_REQUEST_SKILLS_DIR: requestSkills,
    TAPCANVAS_DSH_SYSTEM_PROMPT: "Profile initialization verification only.",
    TAPCANVAS_DSH_API_KEY: "not-used-during-initialization",
    TAPCANVAS_DSH_API_BASE_URL: "http://127.0.0.1:1/v1",
    TAPCANVAS_DSH_API_STYLE: "openai-completions",
    TAPCANVAS_DSH_MODEL: "profile-verification",
    TAPCANVAS_DSH_CONTEXT_WINDOW: "32768",
    TAPCANVAS_DSH_MAX_OUTPUT_TOKENS: "4096",
    TAPCANVAS_DSH_MCP_ENABLED: "false",
    TAPCANVAS_DSH_MCP_TOKEN: "disabled",
    TAPCANVAS_DSH_MCP_URL: "http://127.0.0.1:1/internal/mcp/disabled",
  },
});

try {
  await harness.start();
  process.stdout.write("[deepseek-harness] sdk profile handshake succeeded\n");
} finally {
  await harness.close();
  await rm(temporaryHome, { recursive: true, force: true });
}
