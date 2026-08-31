import path from "node:path";
import fsSync from "node:fs";
import type { AppContext } from "../../types";
import { readNewApiRelay, relayCriticChat } from "./agents-llm-proxy";
import { STORYBOARD_GOVERNANCE_MODEL_KEY } from "./agents.model-keys";
import {
  listProfiles,
  type DomainProfileDto,
} from "../storyboard/profile-library.service";
import { resolvePersonaRootCandidates } from "../task/chat-persona-prompt";

// 分类逻辑的单一真相源是 agents-cli 的 tapcanvas-intent-classifier/SKILL.md。
// 服务端不重写判据，只把它作为 system instruction 喂给模型（与 analyze-image /
// shot-table-critic 一样在 hono 侧走 relay，但 AI 逻辑仍只活在 skill 文件里）。
const CLASSIFIER_SKILL_REL = path.join(
  "skills",
  "tapcanvas-intent-classifier",
  "SKILL.md",
);

function resolveClassifierSkillPath(): string | null {
  const candidates: string[] = [];
  const push = (p: string) => {
    if (!candidates.includes(p)) candidates.push(p);
  };
  const ws = process.env.AGENTS_WORKSPACE_ROOT?.trim();
  if (ws) push(path.join(ws, CLASSIFIER_SKILL_REL));
  for (const root of resolvePersonaRootCandidates(process.cwd())) {
    push(path.join(root, CLASSIFIER_SKILL_REL));
    push(path.join(root, "apps", "agents-cli", CLASSIFIER_SKILL_REL));
  }
  push(
    path.resolve(
      __dirname,
      "..",
      "..",
      "..",
      "..",
      "..",
      "apps",
      "agents-cli",
      CLASSIFIER_SKILL_REL,
    ),
  );
  for (const c of candidates) {
    if (fsSync.existsSync(c)) return c;
  }
  return null;
}

// 阈值：低于此置信度回退 default（与 SKILL.md 内约定一致）。
const CONFIDENCE_FLOOR = 0.55;

function parseJsonLoose(text: string): Record<string, unknown> | null {
  if (!text) return null;
  let s = text.trim();
  // 去掉 ```json ... ``` 代码围栏
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  // 取第一个 { 到最后一个 }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(s.slice(start, end + 1));
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * POST /agents/intent/classify-video
 *
 * 入参：{ briefText?, imageUrls?[], groupId?, projectId? }
 * 出参：{ profileId, confidence(0-1), signals, rationale }
 *
 * 任何失败（profiles 加载不了 / 模型不可用 / JSON 解析失败 / id 非法 / 置信度过低）
 * 一律回退 default（HTTP 200），让前端确认卡照常展示、用户可手动选档——绝不 500 卡住创作。
 */
export async function handleIntentClassifyVideo(
  c: AppContext,
): Promise<Response> {
  const userId = c.get("userId");
  if (!userId) return c.json({ error: "Unauthorized" }, 401);

  const body = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<
    string,
    unknown
  >;
  const briefText =
    typeof body.briefText === "string" ? body.briefText.trim() : "";
  const imageUrls = [
    ...new Set(
      (Array.isArray(body.imageUrls) ? body.imageUrls : [])
        .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
        .map((u) => u.trim()),
    ),
  ].slice(0, 2); // 控成本/延迟：最多对 2 个不同图片地址做分类取证

  const fallback = (rationale: string) =>
    c.json(
      { profileId: "default", confidence: 0, signals: {}, rationale },
      200,
    );

  if (!briefText && imageUrls.length === 0) {
    return fallback("无文本也无图片，回退默认（用户可手动选档）。");
  }

  let profiles: DomainProfileDto[] = [];
  try {
    profiles = await listProfiles();
  } catch {
    profiles = [];
  }
  const validIds = new Set(profiles.map((p) => p.id));

  const skillPath = resolveClassifierSkillPath();
  let skillInstruction = "";
  if (skillPath) {
    try {
      skillInstruction = fsSync.readFileSync(skillPath, "utf8");
    } catch {
      skillInstruction = "";
    }
  }

  const candidateSummary = profiles.length
    ? profiles
        .map(
          (p) =>
            `- ${p.id}（${p.name}）styleTone=${p.styleTone || "(空)"} signals=${JSON.stringify(
              p.signals || {},
            )}`,
        )
        .join("\n")
    : "(profiles.json 未加载——请回退 default)";

  // 组内图理解与小T analyze_image 共用唯一多模态模型。动态 import 规避静态环。
  let imageNotes = "";
  if (imageUrls.length) {
    try {
      const { buildPublicVisionTaskRequest, runPublicTask } = await import(
        "../apiKey/apiKey.routes"
      );
      const notes: string[] = [];
      for (const url of imageUrls) {
        try {
          const request = buildPublicVisionTaskRequest(
            {} as Parameters<typeof buildPublicVisionTaskRequest>[0],
            {
              imageUrl: url,
              imageData: null,
              prompt:
                "用一句话描述：主体/产品是什么、画风(写实/动画/胶片)、是否真人、构图与镜头特征。用于视频领域分类。",
            },
          );
          const { result } = await runPublicTask(c, userId, { request });
          const t = (result?.raw as { text?: unknown } | null | undefined)?.text;
          if (typeof t === "string" && t.trim()) notes.push(t.trim());
        } catch {
          // 单张失败跳过
        }
      }
      if (notes.length) {
        imageNotes = notes.map((n, i) => `图${i + 1}: ${n}`).join("\n");
      }
    } catch {
      // vision 不可用：仅凭文本分类
    }
  }

  const system =
    skillInstruction ||
    "你是视频领域意图分类器。读用户诉求与组内图描述，从候选领域档案里选最贴合的一个，输出 JSON。不确定就回 default。";
  const user = [
    "【候选领域档案（profileId 必须取自这里）】",
    candidateSummary,
    "",
    "【用户创意/诉求】",
    briefText || "(无文本，仅凭图片描述)",
    imageNotes ? "\n【组内图理解】\n" + imageNotes : "",
    "",
    `只输出一个 JSON 对象：{"profileId":"...","confidence":0-1,"signals":{...},"rationale":"中文，简述判据"}。` +
      `profileId 必须是候选 id 之一；两档势均力敌或置信度 < ${CONFIDENCE_FLOOR} 时回 default。不要 markdown 包裹。`,
  ].join("\n");

  const relay = readNewApiRelay(c);
  if (!relay) {
    return fallback("内部 relay 未配置，回退默认（用户可手动选档）。");
  }
  let text = "";
  try {
    text = await relayCriticChat(relay, {
      model: STORYBOARD_GOVERNANCE_MODEL_KEY,
      system,
      user,
      maxTokens: 600,
      timeoutMs: 45_000,
    });
  } catch (err) {
    console.error("[intent-classify] relay failed:", err);
    return fallback("意图分类模型不可用，回退默认（用户可手动选档）。");
  }

  const parsed = parseJsonLoose(text);
  if (!parsed) return fallback("分类结果解析失败，回退默认。");

  let profileId =
    typeof parsed.profileId === "string" ? parsed.profileId.trim() : "default";
  if (validIds.size > 0 && !validIds.has(profileId)) profileId = "default";

  let confidence =
    typeof parsed.confidence === "number" ? parsed.confidence : 0;
  confidence = Math.max(0, Math.min(1, confidence));
  if (confidence < CONFIDENCE_FLOOR) profileId = "default";

  const rationale =
    typeof parsed.rationale === "string" && parsed.rationale.trim()
      ? parsed.rationale.trim()
      : "(无理由)";
  const signals =
    parsed.signals && typeof parsed.signals === "object" && !Array.isArray(parsed.signals)
      ? (parsed.signals as Record<string, unknown>)
      : {};

  return c.json({ profileId, confidence, signals, rationale }, 200);
}
