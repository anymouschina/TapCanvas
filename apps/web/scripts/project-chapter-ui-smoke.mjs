import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const WEB_BASE = process.env.WEB_BASE || "http://127.0.0.1:5173";
const API_BASE = process.env.API_BASE || "http://localhost:8788";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const SMOKE_USER_ID = process.env.SMOKE_USER_ID || "codex-local";
const SMOKE_USER_LOGIN = process.env.SMOKE_USER_LOGIN || "codex_local";
const SCREENSHOT_PATH =
  process.env.SMOKE_SCREENSHOT_PATH || "/tmp/tapcanvas-project-chapter-ui-smoke.png";

function makeDevToken() {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: SMOKE_USER_ID,
      login: SMOKE_USER_LOGIN,
      name: "Project Chapter UI Smoke",
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
    "第1章 雨夜出殡",
    "李长安跟着灵堂队伍回村，开发商带着挖掘机压到老屋门口，场面一触即发。",
    "",
    "第2章 古书异响",
    "夜深后李长安翻开陌生古书，耳边忽然传来锣鼓与怪声，现实开始扭曲。",
    "",
    "第3章 土屋初醒",
    "他睁眼时已经站在破旧土屋里，月光从残缺屋顶落下，新的世界规则正在逼近。",
  ].join("\n");
}

async function closeTourIfNeeded(page) {
  const skip = page.getByRole("button", { name: "跳过" });
  if (await skip.count()) {
    const visible = await skip.first().isVisible().catch(() => false);
    if (visible) {
      await skip.first().click();
      await page.waitForTimeout(200);
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

async function waitForToastText(page, pattern) {
  const toast = page.locator("[data-notification], .mantine-Notification-root").filter({
    hasText: pattern,
  });
  await toast.first().waitFor({ state: "visible", timeout: 20_000 });
}

async function waitForShotCreation(page) {
  await page.waitForFunction(() => {
    const root = document.body?.innerText || "";
    return /镜头 0|Shot 1|1 个镜头|2 个镜头|3 个镜头/.test(root);
  }, undefined, { timeout: 45_000 });
}

async function waitForChapterWorkbenchActions(page) {
  await page.waitForFunction(() => {
    const root = document.body?.innerText || "";
    return root.includes("本章现在该做什么") || root.includes("当前镜头工作区");
  }, undefined, { timeout: 120_000 });
}

async function clickVisibleButtonByText(page, text) {
  await page.waitForFunction((targetText) => {
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
    return candidates.some((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      const shown = rect.width > 0 && rect.height > 0;
      return shown && (node.innerText || "").trim().includes(targetText);
    });
  }, text, { timeout: 20_000 });

  const clicked = await page.evaluate((targetText) => {
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
    const target = candidates.find((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      const shown = rect.width > 0 && rect.height > 0;
      return shown && (node.innerText || "").trim().includes(targetText);
    });
    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  }, text);

  if (!clicked) throw new Error(`visible button not found: ${text}`);
}

async function main() {
  const token = makeDevToken();
  const smokeUser = {
    sub: SMOKE_USER_ID,
    login: SMOKE_USER_LOGIN,
    name: "Project Chapter UI Smoke",
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
    viewport: { width: 1440, height: 1280 },
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
    },
    { smokeToken: token, user: smokeUser },
  );

  const projectName = `UI Smoke ${new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14)}`;

  try {
    await page.goto("/projects", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await closeTourIfNeeded(page);
    const createEntry = page
      .getByRole("button", { name: /上传原文(?:创建项目)?/ })
      .first();
    await createEntry.click();
    await page.getByPlaceholder("请输入项目名称").fill(projectName);
    await page.locator('input[type="file"]').last().setInputFiles({
      name: `${projectName}.txt`,
      mimeType: "text/plain",
      buffer: bookBuffer,
    });
    await page.getByRole("button", { name: "创建并进入章节" }).click();

    await waitForChapterUrl(page);
    const firstChapterUrl = page.url();
    const { projectId, chapterId } = parseChapterUrl(firstChapterUrl);

    await page.evaluate(
      ({ userId, targetProjectId, targetChapterId }) => {
        window.localStorage.setItem(
          `tapcanvas-chapter-tour:v2:${String(userId)}:${targetProjectId}:${targetChapterId}`,
          "1",
        );
      },
      { userId: SMOKE_USER_ID, targetProjectId: projectId, targetChapterId: chapterId },
    );
    await closeTourIfNeeded(page);

    const generateCurrentShotButton = page.getByRole("button", { name: "生成当前镜头" });
    const hasGenerateCurrentShotButton = (await generateCurrentShotButton.count()) > 0;

    await waitForChapterWorkbenchActions(page);
    await waitForShotCreation(page);

    await page.waitForTimeout(8000);
    await clickVisibleButtonByText(page, "归档章节");
    await waitForToastText(page, /章节已归档/);

    await clickVisibleButtonByText(page, "取消归档");
    await waitForToastText(page, /章节已恢复到草稿/);

    const chapterTwo = page.getByText("第 2 章", { exact: true }).first();
    await chapterTwo.scrollIntoViewIfNeeded();
    await chapterTwo.click();
    await page.waitForFunction(() => {
      return /\/chapters\/[^/]+/.test(window.location.pathname || "") &&
        (document.body?.innerText || "").includes("第2章");
    }, undefined, { timeout: 30_000 });

    await closeTourIfNeeded(page);
    await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

    console.log(
      JSON.stringify(
        {
          ok: true,
          webBase: WEB_BASE,
          apiBase: API_BASE,
          projectName,
          firstChapterUrl,
          finalUrl: page.url(),
          screenshotPath: SCREENSHOT_PATH,
          pageErrors,
          requestFailures: requestFailures.slice(-20),
          consoleMessages: consoleMessages.slice(-20),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const debugScreenshotPath = SCREENSHOT_PATH.replace(/\.png$/i, ".failure.png");
    const bodyText = await page.locator("body").innerText().catch(() => "");
    await page.screenshot({ path: debugScreenshotPath, fullPage: true }).catch(() => undefined);
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: String(error instanceof Error ? error.message : error),
          url: page.url(),
          screenshotPath: debugScreenshotPath,
          bodyText: bodyText.slice(0, 5000),
          pageErrors,
          requestFailures: requestFailures.slice(-30),
          consoleMessages: consoleMessages.slice(-30),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error("[project-chapter-ui-smoke] failed:", error);
  process.exit(1);
});
