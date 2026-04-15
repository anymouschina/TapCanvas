import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const WEB_BASE = process.env.WEB_BASE || "http://127.0.0.1:5173";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const SMOKE_USER_ID = process.env.SMOKE_USER_ID || "codex-design";
const SMOKE_USER_LOGIN = process.env.SMOKE_USER_LOGIN || "codex_design";
const PROJECT_ID = String(process.env.PROJECT_ID || "").trim();
const CHAPTER_ID = String(process.env.CHAPTER_ID || "").trim();
const OUTPUT_DIR =
  process.env.SCREENSHOT_OUTPUT_DIR || "/tmp/tapcanvas-design-key-routes";

if (!PROJECT_ID || !CHAPTER_ID) {
  throw new Error("PROJECT_ID and CHAPTER_ID are required.");
}

function makeDevToken() {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: SMOKE_USER_ID,
      login: SMOKE_USER_LOGIN,
      name: "Design Key Route Capture",
      role: "admin",
      guest: false,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600 * 24 * 7,
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(data)
    .digest("base64url");
  return `${data}.${signature}`;
}

async function closeTourIfNeeded(page) {
  const skip = page.getByRole("button", { name: "跳过" });
  if (await skip.count()) {
    const visible = await skip.first().isVisible().catch(() => false);
    if (visible) {
      await skip.first().click();
      await page.waitForTimeout(300);
    }
  }
}

async function captureTarget(target, name) {
  const outputPath = path.join(OUTPUT_DIR, name);
  await target.screenshot({ path: outputPath });
  return outputPath;
}

async function capturePage(page, name) {
  const outputPath = path.join(OUTPUT_DIR, name);
  await page.screenshot({ path: outputPath, fullPage: true });
  return outputPath;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const token = makeDevToken();
  const smokeUser = {
    sub: SMOKE_USER_ID,
    login: SMOKE_USER_LOGIN,
    name: "Design Key Route Capture",
    role: "admin",
    guest: false,
  };
  const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executablePath = await fs
    .access(chromePath)
    .then(() => chromePath)
    .catch(() => undefined);

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: executablePath ? ["--no-sandbox", "--disable-gpu"] : undefined,
  });

  const context = await browser.newContext({
    baseURL: WEB_BASE,
    viewport: { width: 1480, height: 1280 },
  });
  const page = await context.newPage();

  await page.addInitScript(
    ({ smokeToken, user }) => {
      window.localStorage.setItem("tap_token", smokeToken);
      window.localStorage.setItem("tap_user", JSON.stringify(user));
      document.cookie = `tap_token=${encodeURIComponent(smokeToken)}; Path=/; SameSite=Lax`;
      window.localStorage.setItem(
        `tapcanvas-project-manager-tour:v2:${String(user.sub)}`,
        "1",
      );
      window.localStorage.setItem("tapcanvas.aiChat.layoutPreference.v1", JSON.stringify({
        dockRight: true,
        mode: "expanded",
      }));
    },
    { smokeToken: token, user: smokeUser },
  );

  const outputs = {};

  try {
    await page.goto("/studio", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await closeTourIfNeeded(page);
    await page.locator(".react-flow").first().waitFor({ state: "visible", timeout: 60_000 });
    outputs.studio = await capturePage(page, "studio.png");

    await page.goto("/projects", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await closeTourIfNeeded(page);
    await page.locator('[data-tour="project-manager-path"]').waitFor({ state: "visible", timeout: 60_000 });
    outputs.projectManager = await capturePage(page, "project-manager.png");

    await page.getByRole("button", { name: "记忆库" }).first().click();
    await page.locator(".tc-pm-assets__overview-card").waitFor({ state: "visible", timeout: 60_000 });
    outputs.assetViewer = await capturePage(page, "asset-viewer.png");
    await page.keyboard.press("Escape");

    await page.goto(
      `/projects/${encodeURIComponent(PROJECT_ID)}/chapters/${encodeURIComponent(CHAPTER_ID)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    await closeTourIfNeeded(page);
    await page.locator('[data-tour="chapter-current-stage"]').waitFor({ state: "visible", timeout: 60_000 });
    outputs.chapterWorkbench = await capturePage(page, "chapter-workbench.png");

    await page.goto(
      `/studio?projectId=${encodeURIComponent(PROJECT_ID)}&ownerType=chapter&ownerId=${encodeURIComponent(CHAPTER_ID)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    const chatButton = page.getByLabel("展开 AI 对话").first();
    if (await chatButton.count()) {
      await chatButton.click();
    }
    await page.locator(".tc-ai-chat__card").first().waitFor({ state: "visible", timeout: 60_000 });
    outputs.aiChat = await captureTarget(page.locator(".tc-ai-chat__card").first(), "ai-chat.png");

    console.log(JSON.stringify({ ok: true, outputDir: OUTPUT_DIR, screenshots: outputs }, null, 2));
  } catch (error) {
    const debugPath = path.join(OUTPUT_DIR, "debug-failure.png");
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => undefined);
    console.log(JSON.stringify({
      ok: false,
      outputDir: OUTPUT_DIR,
      screenshots: outputs,
      error: error instanceof Error ? error.message : String(error),
      debugPath,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
