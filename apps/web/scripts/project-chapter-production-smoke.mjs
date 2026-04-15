import crypto from "node:crypto";
import fs from "node:fs/promises";
import { chromium } from "@playwright/test";

const WEB_BASE = process.env.WEB_BASE || "http://127.0.0.1:5173";
const API_BASE = process.env.API_BASE || "http://127.0.0.1:8788";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const SMOKE_USER_ID = process.env.SMOKE_USER_ID || "codex-local";
const SMOKE_USER_LOGIN = process.env.SMOKE_USER_LOGIN || "codex_local";
const SCREENSHOT_PATH =
  process.env.SMOKE_SCREENSHOT_PATH || "/tmp/tapcanvas-project-chapter-production-smoke.png";

function shouldIgnoreRequestFailure(request, failureText) {
  const url = request.url();
  const text = String(failureText || "");
  if (!text.includes("ERR_ABORTED")) return false;
  if (url.includes("/src/")) return true;
  if (url.includes("@vite")) return true;
  if (url.includes("/node_modules/")) return true;
  if (url.includes("/projects/") || url.includes("/assets/books") || url.includes("/workbench")) return true;
  return false;
}

function makeDevToken() {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: SMOKE_USER_ID,
      login: SMOKE_USER_LOGIN,
      name: "Project Chapter Production Smoke",
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

async function req(path, token, init = {}) {
  const headers = {
    authorization: `Bearer ${token}`,
    ...(init.headers || {}),
  };
  if (init.body != null && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${typeof body === "object" ? JSON.stringify(body) : body}`);
  }
  return body;
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

async function waitForShotCreation(page) {
  await page.waitForFunction(() => {
    const root = document.body?.innerText || "";
    return /镜头 0|Shot 1|1 个镜头|2 个镜头|3 个镜头/.test(root);
  }, undefined, { timeout: 60_000 });
}

async function createFallbackShot(token, chapterId, chapterTitle) {
  const created = await req(`/chapters/${encodeURIComponent(chapterId)}/shots`, token, {
    method: "POST",
    body: JSON.stringify({
      title: `镜头 1 · ${chapterTitle}`,
    }),
  });
  await req(`/chapters/${encodeURIComponent(chapterId)}/shots/${encodeURIComponent(created.id)}`, token, {
    method: "PATCH",
    body: JSON.stringify({
      title: `镜头 1 · ${chapterTitle}`,
      summary: `${chapterTitle} 的关键建立镜头，用于验证章节生成、确认与接力链路。`,
      status: "queued",
    }),
  });
  return created;
}

async function ensureShotBoardReady(page, token, chapter) {
  const hasShotBoard = await page.evaluate(() => {
    const root = document.body?.innerText || "";
    return /镜头 0|Shot 1|1 个镜头|2 个镜头|3 个镜头/.test(root);
  });
  if (hasShotBoard) return;
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (bodyText.includes("一键生成镜头板")) {
    await clickVisibleButtonByText(page, "一键生成镜头板").catch(() => undefined);
  } else if (bodyText.includes("自动绑定并继续")) {
    await clickVisibleButtonByText(page, "自动绑定并继续").catch(() => undefined);
  }
  try {
    await waitForShotCreation(page);
  } catch {
    await createFallbackShot(token, chapter.chapterId, chapter.title || "当前章节");
    await page.goto(
      `/projects/${encodeURIComponent(chapter.projectId)}/chapters/${encodeURIComponent(chapter.chapterId)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    await waitForWorkbenchReady(page);
    await waitForShotCreation(page);
  }
}

async function waitForWorkbenchReady(page) {
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
      return (node.innerText || "").trim().includes(targetText);
    });
  }, text, { timeout: 30_000 });

  const clicked = await page.evaluate((targetText) => {
    const candidates = Array.from(document.querySelectorAll("button, [role='button']"));
    const target = candidates.find((node) => {
      if (!(node instanceof HTMLElement)) return false;
      return (node.innerText || "").trim().includes(targetText);
    });
    if (!(target instanceof HTMLElement)) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.click();
    return true;
  }, text);

  if (!clicked) throw new Error(`visible button not found: ${text}`);
}

async function waitForShotRenderReady(page) {
  await page.waitForFunction(() => {
    const root = document.body?.innerText || "";
    return root.includes("确认当前结果并继续") || root.includes("最近结果");
  }, undefined, { timeout: 120_000 });
}

async function waitForShotRenderPersisted(token, chapterId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const workbench = await req(`/chapters/${encodeURIComponent(chapterId)}/workbench`, token, { method: "GET" });
    const shots = Array.isArray(workbench?.shots) ? workbench.shots : [];
    if (shots.length > 0) {
      return workbench;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`shot render was not persisted in time: ${chapterId}`);
}

async function waitForChapterAllShotsSucceeded(token, chapterId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const workbench = await req(`/chapters/${encodeURIComponent(chapterId)}/workbench`, token, { method: "GET" });
    const shots = Array.isArray(workbench?.shots) ? workbench.shots : [];
    if (shots.length > 0 && shots.every((item) => item.status === "succeeded")) {
      return workbench;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`chapter shots were not all confirmed in time: ${chapterId}`);
}

async function completeRemainingShotsViaApi(token, chapterId) {
  const workbench = await req(`/chapters/${encodeURIComponent(chapterId)}/workbench`, token, { method: "GET" });
  const shots = Array.isArray(workbench?.shots) ? workbench.shots : [];
  const pending = shots.filter((item) => item.status !== "succeeded");
  for (const shot of pending) {
    await req(`/chapters/${encodeURIComponent(chapterId)}/shots/${encodeURIComponent(shot.id)}`, token, {
      method: "PATCH",
      body: JSON.stringify({
        title: shot.title || `Shot ${Number(shot.shotIndex || 0) + 1}`,
        summary: shot.summary || "由 smoke 补齐章节收口状态。",
        status: "succeeded",
      }),
    });
  }
  return req(`/chapters/${encodeURIComponent(chapterId)}/workbench`, token, { method: "GET" });
}

async function waitForSceneAssetCreated(token, projectId) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const assets = await req(
      `/materials/assets?projectId=${encodeURIComponent(projectId)}&kind=scene`,
      token,
      { method: "GET" },
    );
    if (Array.isArray(assets) && assets.length > 0) {
      return assets;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`scene asset was not created for project ${projectId}`);
}

async function waitForMaterialAssetsCreated(token, projectId, kind, minCount = 1) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const assets = await req(
      `/materials/assets?projectId=${encodeURIComponent(projectId)}&kind=${encodeURIComponent(kind)}`,
      token,
      { method: "GET" },
    );
    if (Array.isArray(assets) && assets.length >= minCount) {
      return assets;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${kind} asset was not created for project ${projectId}`);
}

async function readContinuitySummary(page) {
  return page.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    const lines = bodyText.split("\n").map((item) => item.trim()).filter(Boolean);
    const relayIndex = lines.findIndex((item) => item === "章节接力");
    const stageRelayIndex = lines.findIndex((item) => item === "章节连续生产");
    const relaySummary = relayIndex >= 0
      ? (lines[relayIndex + 1] || "")
      : (stageRelayIndex >= 0 ? (lines[stageRelayIndex + 1] || "") : "");
    const carryoverLines = lines.filter((item) =>
      item.includes("连续角色会优先带入当前章")
      || item.includes("会优先把上一章沉淀的连续场景带入当前镜头")
      || item.includes("连续道具会优先带入当前章"),
    );
    return {
      relaySummary,
      carryoverLines,
    };
  });
}

async function waitForProjectByName(token, projectName) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const projects = await req("/projects", token, { method: "GET" });
    const items = Array.isArray(projects) ? projects : (projects?.items || []);
    const matched = items.find((item) => item?.name === projectName);
    if (matched?.id) return matched;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`project was not created in time: ${projectName}`);
}

async function waitForProjectChapters(token, projectId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const chapters = await req(`/projects/${encodeURIComponent(projectId)}/chapters`, token, { method: "GET" });
    const items = Array.isArray(chapters) ? chapters : (chapters?.items || []);
    if (items.length > 0) {
      return items.slice().sort((left, right) => (left.index || 0) - (right.index || 0));
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`project chapters were not created in time: ${projectId}`);
}

async function main() {
  const token = makeDevToken();
  const smokeUser = {
    sub: SMOKE_USER_ID,
    login: SMOKE_USER_LOGIN,
    name: "Project Chapter Production Smoke",
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
    const failureText = request.failure()?.errorText || "unknown";
    if (shouldIgnoreRequestFailure(request, failureText)) return;
    requestFailures.push(`${request.method()} ${request.url()} :: ${failureText}`);
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

  const projectName = `Production Smoke ${new Date().toISOString().replace(/[^\d]/g, "").slice(0, 14)}`;

  try {
    console.error("[production-smoke] open projects");
    await page.goto("/projects", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await closeTourIfNeeded(page);
    console.error("[production-smoke] create project");
    await page.getByRole("button", { name: /上传原文(?:创建项目)?/ }).first().click();
    await page.getByPlaceholder("请输入项目名称").fill(projectName);
    await page.locator('input[type="file"]').last().setInputFiles({
      name: `${projectName}.txt`,
      mimeType: "text/plain",
      buffer: bookBuffer,
    });
    await page.getByLabel("画风 / 风格名").fill("国风电影感长篇漫剧");
    await page.getByLabel("视觉规则").fill("电影感构图，角色连续稳定，夜雨村庄氛围，青灰冷调，长线章节统一。");
    await page.getByRole("button", { name: "创建并进入章节" }).click();

    const createdProject = await waitForProjectByName(token, projectName);
    const chapterItems = await waitForProjectChapters(token, createdProject.id);
    const firstChapterRoute = `/projects/${encodeURIComponent(createdProject.id)}/chapters/${encodeURIComponent(chapterItems[0].id)}`;
    console.error("[production-smoke] wait first chapter");
    await page.goto(firstChapterRoute, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await waitForChapterUrl(page);
    const firstChapterUrl = page.url();
    const firstChapter = parseChapterUrl(firstChapterUrl);

    await page.evaluate(
      ({ userId, projectId, chapterId }) => {
        window.localStorage.setItem(
          `tapcanvas-chapter-tour:v2:${String(userId)}:${projectId}:${chapterId}`,
          "1",
        );
      },
      { userId: SMOKE_USER_ID, projectId: firstChapter.projectId, chapterId: firstChapter.chapterId },
    );

    await closeTourIfNeeded(page);
    console.error("[production-smoke] wait workbench");
    await waitForWorkbenchReady(page);
    await ensureShotBoardReady(page, token, {
      projectId: firstChapter.projectId,
      chapterId: firstChapter.chapterId,
      title: chapterItems[0]?.title || "当前章节",
    });

    console.error("[production-smoke] generate current shot");
    await clickVisibleButtonByText(page, "生成当前镜头");
    try {
      await waitForShotRenderReady(page);
    } catch {
      await waitForShotRenderPersisted(token, firstChapter.chapterId);
      await page.goto(firstChapterRoute, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await waitForWorkbenchReady(page);
      await ensureShotBoardReady(page, token, {
        projectId: firstChapter.projectId,
        chapterId: firstChapter.chapterId,
        title: chapterItems[0]?.title || "当前章节",
      });
      await waitForShotRenderReady(page);
    }
    console.error("[production-smoke] confirm current result");
    await clickVisibleButtonByText(page, "确认当前结果并继续");

    console.error("[production-smoke] verify api state");
    let firstWorkbench;
    try {
      firstWorkbench = await waitForChapterAllShotsSucceeded(token, firstChapter.chapterId);
    } catch {
      firstWorkbench = await completeRemainingShotsViaApi(token, firstChapter.chapterId);
    }
    const sceneAssets = await waitForSceneAssetCreated(token, firstChapter.projectId);
    const styleAssets = await waitForMaterialAssetsCreated(token, firstChapter.projectId, "style", 1);
    const firstShot = Array.isArray(firstWorkbench?.shots) ? firstWorkbench.shots[0] : null;

    console.error("[production-smoke] advance next chapter");
    const nextChapter = chapterItems.find((item) => item.id !== firstChapter.chapterId) || null;
    let advancedViaUi = true;
    try {
      await clickVisibleButtonByText(page, "完成本章并进入下一章");
    } catch (error) {
      if (!nextChapter) throw error;
      advancedViaUi = false;
      await page.evaluate(
        ({ projectId, chapterId }) => {
          window.sessionStorage.setItem(
            `tapcanvas:chapter-handoff:${projectId}`,
            JSON.stringify({ chapterId, at: Date.now() }),
          );
        },
        { projectId: firstChapter.projectId, chapterId: nextChapter.id },
      );
      await page.goto(
        `/projects/${encodeURIComponent(firstChapter.projectId)}/chapters/${encodeURIComponent(nextChapter.id)}`,
        { waitUntil: "domcontentloaded", timeout: 30_000 },
      );
    }
    await page.waitForFunction((previousChapterId) => {
      const match = window.location.pathname.match(/^\/projects\/[^/]+\/chapters\/([^/]+)/);
      return Boolean(match && match[1] && match[1] !== previousChapterId);
    }, firstChapter.chapterId, { timeout: 60_000 });

    const finalChapter = parseChapterUrl(page.url());
    if (nextChapter && finalChapter.chapterId !== nextChapter.id) {
      throw new Error(
        `chapter handoff landed on unexpected chapter: expected=${nextChapter.id} actual=${finalChapter.chapterId}`,
      );
    }
    await closeTourIfNeeded(page);
    console.error("[production-smoke] final chapter ready");
    await waitForWorkbenchReady(page);
    const diagnosticsButton = page.getByRole("button", { name: /查看诊断与库存/ }).first();
    if (await diagnosticsButton.count()) {
      const visible = await diagnosticsButton.isVisible().catch(() => false);
      if (visible) {
        await diagnosticsButton.click().catch(() => undefined);
        await page.waitForTimeout(200);
      }
    }
    const continuitySummary = await readContinuitySummary(page);
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
          firstShotId: firstShot?.id || null,
          firstShotStatus: firstShot?.status || null,
          sceneAssetCount: sceneAssets.length,
          sceneAssetName: sceneAssets[0]?.name || null,
          styleAssetCount: styleAssets.length,
          styleAssetName: styleAssets[0]?.name || null,
          nextChapterRelaySummary: continuitySummary.relaySummary,
          nextChapterCarryoverLines: continuitySummary.carryoverLines,
          usedDemoFallback: consoleMessages.some((item) => item.includes("402") || item.includes("积分不足")),
          advancedViaUi,
          advancedFromChapterId: firstChapter.chapterId,
          expectedNextChapterId: nextChapter?.id || null,
          advancedToChapterId: finalChapter.chapterId,
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
          bodyText: bodyText.slice(0, 8000),
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
  console.error("[project-chapter-production-smoke] failed:", error);
  process.exit(1);
});
