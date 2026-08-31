import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";

import { resolvePersonaRootCandidates } from "../task/chat-persona-prompt";

// styleTone 必须是 tapcanvas-video-workflow/SKILL.md 硬约束的三档之一；
// default 档留空 ("") 表示回退到现状的 LLM 自由判定。
export type ProfileStyleTone = "clean-real" | "cinematic" | "anime";

export type DomainProfileSignals = {
  keywords?: string[];
  hasNarration?: boolean;
  isProduct?: boolean;
  visualCues?: string[];
};

export type DomainProfileDto = {
  id: string;
  name: string;
  signals?: DomainProfileSignals;
  /** clean-real | cinematic | anime；default 档为空串 = 回退现状自由判定。 */
  styleTone: ProfileStyleTone | "";
  recipeBias: string[];
  aspect?: string;
  durationDefault?: number;
  /** 指向 profiles/<id>.md 详情（stageOverrides 文案）。 */
  stageOverridesRef?: string;
  qaCriteria: string[];
};

/**
 * 兜底空覆盖档。getProfile('default') 在文件缺失/未显式声明时也返回它，
 * 行为等价于现状（无 styleTone 锁定、无 recipeBias、无 stageOverrides）。
 */
export const DEFAULT_PROFILE: DomainProfileDto = {
  id: "default",
  name: "兜底",
  styleTone: "",
  recipeBias: [],
  qaCriteria: [],
};

// profiles.json lives inside the agents-cli skill dir:
//   <agents-cli root>/skills/tapcanvas-video-workflow/profiles/profiles.json
const PROFILES_FROM_AGENTS_CLI = path.join(
  "skills",
  "tapcanvas-video-workflow",
  "profiles",
  "profiles.json",
);

/**
 * Resolve profiles.json across dev, test, and Docker runtimes.
 *
 * The domain-profile library is authored inside the agents-cli skill directory
 * (single source of truth, shared with the workflow skeleton), so we resolve it
 * relative to the same agents-cli roots the persona/skill loader uses
 * (`/workspace/apps/agents-cli`, `/workspace`, walk-up `apps/agents-cli`, …) —
 * see resolvePersonaRootCandidates. Returns the first candidate that exists.
 */
export function listProfilesJsonCandidates(): string[] {
  const candidates: string[] = [];
  const push = (p: string) => {
    if (!candidates.includes(p)) candidates.push(p);
  };

  // Docker stages skills under <AGENTS_WORKSPACE_ROOT>/skills.
  const workspaceRoot = process.env.AGENTS_WORKSPACE_ROOT?.trim();
  if (workspaceRoot) push(path.join(workspaceRoot, PROFILES_FROM_AGENTS_CLI));

  for (const root of resolvePersonaRootCandidates(process.cwd())) {
    // root may be an agents-cli dir (…/apps/agents-cli) or a parent (…/workspace).
    push(path.join(root, PROFILES_FROM_AGENTS_CLI));
    push(path.join(root, "apps", "agents-cli", PROFILES_FROM_AGENTS_CLI));
  }

  // Dev/test: anchor on this source file → 5 levels up reaches the monorepo root.
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
      PROFILES_FROM_AGENTS_CLI,
    ),
  );

  return candidates;
}

function resolveProfilesJsonPath(): string {
  const candidates = listProfilesJsonCandidates();
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) return candidate;
  }
  // None found: return the first candidate so the caller's read throws a clear ENOENT.
  return candidates[0] ?? PROFILES_FROM_AGENTS_CLI;
}

function toProfileDto(r: Record<string, unknown>): DomainProfileDto {
  return {
    id: String(r.id),
    name: String(r.name),
    signals: r.signals as DomainProfileDto["signals"],
    styleTone: (r.styleTone ? String(r.styleTone) : "") as DomainProfileDto["styleTone"],
    recipeBias: Array.isArray(r.recipeBias) ? r.recipeBias.map(String) : [],
    aspect: r.aspect ? String(r.aspect) : undefined,
    durationDefault:
      typeof r.durationDefault === "number" ? r.durationDefault : undefined,
    stageOverridesRef: r.stageOverridesRef
      ? String(r.stageOverridesRef)
      : undefined,
    qaCriteria: Array.isArray(r.qaCriteria) ? r.qaCriteria.map(String) : [],
  };
}

export async function listProfiles(): Promise<DomainProfileDto[]> {
  const raw = await fs.readFile(resolveProfilesJsonPath(), "utf8");
  const list = JSON.parse(raw) as Array<Record<string, unknown>>;
  return list.map(toProfileDto);
}

/**
 * Load a single profile by id.
 *
 * `getProfile('default')` never throws: if the default档 is not declared in
 * profiles.json (or the file is missing), it returns the empty override
 * DEFAULT_PROFILE so callers can always fall back to current behavior.
 * Unknown non-default ids resolve to `undefined`.
 */
export async function getProfile(
  id: string,
): Promise<DomainProfileDto | undefined> {
  if (id === "default") {
    try {
      const profiles = await listProfiles();
      return profiles.find((p) => p.id === "default") ?? DEFAULT_PROFILE;
    } catch {
      return DEFAULT_PROFILE;
    }
  }
  const profiles = await listProfiles();
  return profiles.find((p) => p.id === id);
}
