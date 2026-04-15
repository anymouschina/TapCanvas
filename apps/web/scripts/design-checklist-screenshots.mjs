import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const WEB_BASE = process.env.WEB_BASE || "http://127.0.0.1:5173";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const SMOKE_USER_ID = process.env.SMOKE_USER_ID || "codex-design";
const SMOKE_USER_LOGIN = process.env.SMOKE_USER_LOGIN || "codex_design";
const OUTPUT_DIR =
  process.env.SCREENSHOT_OUTPUT_DIR || "/tmp/tapcanvas-design-checklist";

function makeDevToken() {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: SMOKE_USER_ID,
      login: SMOKE_USER_LOGIN,
      name: "Design Checklist Smoke",
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

function buildBookText() {
  return [
    "第1章 雨夜回村",
    "李长安夜里回到被围住的老屋前，看见挖掘机和送葬队伍在雨里对峙。",
    "",
    "第2章 古书异响",
    "他回到灵堂翻开旧书，耳边响起锣鼓怪声，房间像舞台一样开始扭曲。",
    "",
    "第3章 土屋初醒",
    "再睁眼时他已经站在破旧土屋里，月光从残缺屋顶落下，新的世界规则压了过来。",
  ].join("\n");
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

async function waitForChapterUrl(page) {
  await page.waitForFunction(() => {
    return /^\/projects\/[^/]+\/chapters\/[^/]+(?:\/shots\/[^/]+)?\/?$/.test(
      window.location.pathname || "",
    );
  }, undefined, { timeout: 180_000 });
}

function parseChapterUrl(urlText) {
  const url = new URL(urlText);
  const match = url.pathname.match(
    /^\/projects\/([^/]+)\/chapters\/([^/]+)(?:\/shots\/([^/]+))?\/?$/,
  );
  if (!match) {
    throw new Error(`unexpected chapter url: ${urlText}`);
  }
  return {
    projectId: decodeURIComponent(match[1]),
    chapterId: decodeURIComponent(match[2]),
    shotId: match[3] ? decodeURIComponent(match[3]) : null,
  };
}

async function clickVisibleButtonByText(page, text) {
  await page.waitForFunction((targetText) => {
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
    return candidates.some((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 &&
        rect.height > 0 &&
        (node.innerText || "").trim().includes(targetText);
    });
  }, text, { timeout: 30_000 });

  const clicked = await page.evaluate((targetText) => {
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
    const target = candidates.find((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 &&
        rect.height > 0 &&
        (node.innerText || "").trim().includes(targetText);
    });
    if (!(target instanceof HTMLElement)) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.click();
    return true;
  }, text);

  if (!clicked) {
    throw new Error(`visible button not found: ${text}`);
  }
}

async function waitForText(page, text) {
  await page.waitForFunction((expectedText) => {
    return (document.body?.innerText || "").includes(expectedText);
  }, text, { timeout: 120_000 });
}

async function waitForShotCreation(page) {
  await page.waitForFunction(() => {
    const root = document.body?.innerText || "";
    return /镜头 0|Shot 1|1 个镜头|2 个镜头|3 个镜头/.test(root);
  }, undefined, { timeout: 60_000 });
}

async function waitForChapterWorkbenchActions(page) {
  await page.waitForFunction(() => {
    const root = document.body?.innerText || "";
    return root.includes("本章现在该做什么") || root.includes("当前镜头工作区");
  }, undefined, { timeout: 120_000 });
}

async function capture(page, fileName) {
  const outputPath = path.join(OUTPUT_DIR, fileName);
  await page.screenshot({ path: outputPath, fullPage: true });
  return outputPath;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const token = makeDevToken();
  const smokeUser = {
    sub: SMOKE_USER_ID,
    login: SMOKE_USER_LOGIN,
    name: "Design Checklist Smoke",
    role: "admin",
    guest: false,
  };
  const bookBuffer = Buffer.from(buildBookText(), "utf8");
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
  const consoleMessages = [];
  const pageErrors = [];
  const requestFailures = [];

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(String(error?.message || error));
  });
  page.on("requestfailed", (request) => {
    requestFailures.push(
      `${request.method()} ${request.url()} :: ${request.failure()?.errorText || "unknown"}`,
    );
  });

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

  const projectName = `Design Sweep ${new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14)}`;
  const outputs = {};

  try {
    await page.goto("/projects", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await closeTourIfNeeded(page);

    await page.getByRole("button", { name: /上传原文(?:创建项目)?/ }).first().click();
    await page.getByPlaceholder("请输入项目名称").fill(projectName);
    await page.locator('input[type="file"]').last().setInputFiles({
      name: `${projectName}.txt`,
      mimeType: "text/plain",
      buffer: bookBuffer,
    });
    await page.getByRole("button", { name: "创建并进入章节" }).click();

    await waitForChapterUrl(page);
    await closeTourIfNeeded(page);
    await waitForChapterWorkbenchActions(page);
    await waitForShotCreation(page);
    const chapterTwo = page.getByText("第 2 章", { exact: true }).first();
    if (await chapterTwo.count()) {
      await chapterTwo.scrollIntoViewIfNeeded();
      await chapterTwo.click();
      await page.waitForFunction(() => {
        return /\/chapters\/[^/]+/.test(window.location.pathname || "") &&
          (document.body?.innerText || "").includes("第2章");
      }, undefined, { timeout: 30_000 });
      await closeTourIfNeeded(page);
      await waitForChapterWorkbenchActions(page);
    }
    outputs.chapterWorkbench = await capture(page, "chapter-workbench.png");

    const chatExpandButton = page.getByLabel("展开 AI 对话").first();
    if (await chatExpandButton.count()) {
      await chatExpandButton.click();
    } else {
      await clickVisibleButtonByText(page, "AI 对话");
    }
    await waitForText(page, "AI 对话");
    outputs.aiChat = await capture(page, "ai-chat.png");

    const { projectId } = parseChapterUrl(page.url());

    await page.goto(`/projects/${encodeURIComponent(projectId)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await closeTourIfNeeded(page);
    await waitForText(page, "创建项目、查看共享资产，并继续最近章节。");
    outputs.projectManager = await capture(page, "project-manager.png");

    await clickVisibleButtonByText(page, "记忆库");
    await waitForText(page, "角色卡素材");
    outputs.assetViewer = await capture(page, "asset-viewer.png");
    await page.keyboard.press("Escape");

    await page.goto("/studio", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator(".react-flow").first().waitFor({ state: "visible", timeout: 60_000 });
    outputs.studio = await capture(page, "studio.png");

    console.log(
      JSON.stringify(
        {
          ok: true,
          outputDir: OUTPUT_DIR,
          screenshots: outputs,
          pageErrors,
          requestFailures: requestFailures.slice(-20),
          consoleMessages: consoleMessages.slice(-20),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const debugPath = path.join(OUTPUT_DIR, "debug-failure.png");
    await page.screenshot({ path: debugPath, fullPage: true }).catch(() => undefined);
    console.log(
      JSON.stringify(
        {
          ok: false,
          outputDir: OUTPUT_DIR,
          screenshots: outputs,
          error: error instanceof Error ? error.message : String(error),
          debugPath,
          pageErrors,
          requestFailures: requestFailures.slice(-20),
          consoleMessages: consoleMessages.slice(-20),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
