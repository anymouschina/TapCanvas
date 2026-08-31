import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";

import { resolvePersonaRootCandidates } from "../task/chat-persona-prompt";

export type StoryboardRecipeDto = {
  id: string;
  name: string;
  description: string;
  previewUrl: string;
  gridSpec?: { rows: number; cols: number };
  aspect?: string;
};

// recipes.json lives inside the agents-cli skill dir:
//   <agents-cli root>/skills/tapcanvas-storyboard-expert/references/recipes/recipes.json
const RECIPES_FROM_AGENTS_CLI = path.join(
  "skills",
  "tapcanvas-storyboard-expert",
  "references",
  "recipes",
  "recipes.json",
);

/**
 * Resolve recipes.json across dev, test, and Docker runtimes.
 *
 * The recipe library is authored inside the agents-cli skill directory, so we
 * resolve it relative to the same agents-cli roots the persona/skill loader uses
 * (`/workspace/apps/agents-cli`, `/workspace`, walk-up `apps/agents-cli`, …) —
 * see resolvePersonaRootCandidates. Returns the first candidate that exists.
 */
export function listRecipesJsonCandidates(): string[] {
  const candidates: string[] = [];
  const push = (p: string) => {
    if (!candidates.includes(p)) candidates.push(p);
  };

  // Docker stages skills under <AGENTS_WORKSPACE_ROOT>/skills.
  const workspaceRoot = process.env.AGENTS_WORKSPACE_ROOT?.trim();
  if (workspaceRoot) push(path.join(workspaceRoot, RECIPES_FROM_AGENTS_CLI));

  for (const root of resolvePersonaRootCandidates(process.cwd())) {
    // root may be an agents-cli dir (…/apps/agents-cli) or a parent (…/workspace).
    push(path.join(root, RECIPES_FROM_AGENTS_CLI));
    push(path.join(root, "apps", "agents-cli", RECIPES_FROM_AGENTS_CLI));
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
      RECIPES_FROM_AGENTS_CLI,
    ),
  );

  return candidates;
}

function resolveRecipesJsonPath(): string {
  const candidates = listRecipesJsonCandidates();
  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) return candidate;
  }
  // None found: return the first candidate so the caller's read throws a clear ENOENT.
  return candidates[0] ?? RECIPES_FROM_AGENTS_CLI;
}

export async function loadStoryboardRecipes(): Promise<StoryboardRecipeDto[]> {
  const raw = await fs.readFile(resolveRecipesJsonPath(), "utf8");
  const list = JSON.parse(raw) as Array<Record<string, unknown>>;
  return list.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    description: String(r.description),
    previewUrl: String(r.previewUrl),
    gridSpec: r.gridSpec as StoryboardRecipeDto["gridSpec"],
    aspect: r.aspect ? String(r.aspect) : undefined,
  }));
}
