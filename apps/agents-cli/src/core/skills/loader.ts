import fs from "node:fs";
import path from "node:path";

export type Skill = {
  name: string;
  description: string;
  body: string;
  dir: string;
  path: string;
};

type SkillSummary = {
  name: string;
  description: string;
  path: string;
};

export class SkillLoader {
  private skills = new Map<string, Skill>();
  private readonly skillDirs: string[];

  constructor(skillsDirs: string | string[]) {
    this.skillDirs = Array.from(
      new Set(
        (Array.isArray(skillsDirs) ? skillsDirs : [skillsDirs])
          .map((dir) => path.resolve(String(dir || "").trim()))
          .filter(Boolean)
      )
    );
    this.loadSkills();
  }

  reloadSkills() {
    this.skills.clear();
    this.loadSkills();
  }

  private parseSkillMd(content: string, skillPath: string): Skill | null {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!match) return null;
    const [, frontmatter, body] = match;
    const meta = parseFrontmatter(frontmatter);
    const name = typeof meta.name === "string" ? meta.name.trim() : "";
    const descriptionRaw = typeof meta.description === "string" ? meta.description : "";
    const description = normalizeDescription(descriptionRaw);
    if (!name || !description) return null;
    return {
      name,
      description,
      body: body.trim(),
      dir: path.dirname(skillPath),
      path: skillPath,
    };
  }

  private loadSkills() {
    for (const skillsDir of this.skillDirs) {
      if (!fs.existsSync(skillsDir)) continue;
      const dirs = fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const dir of dirs) {
        const skillPath = path.join(skillsDir, dir, "SKILL.md");
        try {
          if (!fs.existsSync(skillPath)) continue;
          const content = fs.readFileSync(skillPath, "utf-8");
          const skill = this.parseSkillMd(content, skillPath);
          if (skill) {
            this.skills.set(skill.name, skill);
          }
        } catch {
          // Ignore transient read errors (e.g. file being edited).
        }
      }
    }
  }

  listSkills() {
    return Array.from(this.skills.keys());
  }

  listSkillSummaries() {
    return Array.from(this.skills.values())
      .map((skill) => ({ name: skill.name, description: skill.description, path: skill.path }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getDescriptions() {
    if (this.skills.size === 0) return "（暂无可用技能）";
    return Array.from(this.skills.values())
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join("\n");
  }

  getDescriptionsFor(names: string[]) {
    const wanted = Array.from(
      new Set(
        (Array.isArray(names) ? names : [])
          .map((name) => String(name || "").trim())
          .filter(Boolean)
      )
    );
    if (wanted.length === 0) return this.getDescriptions();
    const lines = wanted
      .map((name) => {
        const skill = this.skills.get(name);
        if (!skill) return "";
        return `- ${skill.name}: ${skill.description}`;
      })
      .filter(Boolean);
    return lines.length ? lines.join("\n") : this.getDescriptions();
  }

  renderSkillsSection(options?: { requiredSkills?: string[] }) {
    const summaries = this.resolveRenderableSkillSummaries();
    if (summaries.length === 0) return "## Skills\n当前会话没有可用 skills。";
    const requiredSkills = Array.from(
      new Set(
        (Array.isArray(options?.requiredSkills) ? options?.requiredSkills : [])
          .map((name) => String(name || "").trim())
          .filter(Boolean)
      )
    );
    const lines: string[] = [];
    lines.push("## Skills");
    lines.push(
      "A skill is a set of local instructions to follow that is stored in a `SKILL.md` file. Below is the list of skills that can be used. Each entry includes a name, description, and file path so you can open the source for full instructions when using a specific skill."
    );
    lines.push("### Available skills");
    summaries.forEach((skill) => {
      lines.push(`- ${skill.name}: ${skill.description} (file: ${normalizeSkillPath(skill.path)})`);
    });
    lines.push("### How to use skills");
    lines.push("- Discovery: The list above is the skills available in this session (name + description + file path). Skill bodies live on disk at the listed paths.");
    lines.push("- Trigger rules: If the user names a skill (with `$SkillName` or plain text) OR the task clearly matches a skill's description shown above, you must use that skill for that turn. Multiple mentions mean use them all. Do not carry skills across turns unless re-mentioned.");
    lines.push("- Missing/blocked: If a named skill isn't in the list or the path can't be read, say so briefly and continue with the best fallback.");
    lines.push("- How to use a skill (progressive disclosure):");
    lines.push("  1) After deciding to use a skill, open its `SKILL.md`. Read only enough to follow the workflow.");
    lines.push("  2) When `SKILL.md` references relative paths (e.g., `scripts/foo.py`), resolve them relative to the skill directory listed above first, and only consider other paths if needed.");
    lines.push("  3) If `SKILL.md` points to extra folders such as `references/`, load only the specific files needed for the request; don't bulk-load everything.");
    lines.push("  4) If `scripts/` exist, prefer running or patching them instead of retyping large code blocks.");
    lines.push("  5) If `assets/` or templates exist, reuse them instead of recreating from scratch.");
    lines.push("- Coordination and sequencing:");
    lines.push("  - If multiple skills apply, choose the minimal set that covers the request and state the order you'll use them.");
    lines.push("  - Announce which skill(s) you're using and why (one short line). If you skip an obvious skill, say why.");
    lines.push("- Context hygiene:");
    lines.push("  - Keep context small: summarize long sections instead of pasting them; only load extra files when needed.");
    lines.push("  - Avoid deep reference-chasing: prefer opening only files directly linked from `SKILL.md` unless you're blocked.");
    lines.push("  - When variants exist (frameworks, providers, domains), pick only the relevant reference file(s) and note that choice.");
    lines.push("- Safety and fallback: If a skill can't be applied cleanly (missing files, unclear instructions), state the issue, pick the next-best approach, and continue.");
    if (requiredSkills.length > 0) {
      lines.push(`- Run-specific constraint: This run explicitly prioritizes these skills first: ${requiredSkills.join(", ")}.`);
    }
    return lines.join("\n");
  }

  getSkillContent(name: string) {
    const skill = this.skills.get(name);
    if (!skill) return null;
    let content = `# Skill: ${skill.name}\n\n${skill.body}`;
    const resources: string[] = [];
    for (const [folder, label] of [
      ["scripts", "脚本（scripts）"],
      ["references", "参考（references）"],
      ["assets", "资源（assets）"],
    ] as const) {
      const folderPath = path.join(skill.dir, folder);
      if (!fs.existsSync(folderPath)) continue;
      const files = fs.readdirSync(folderPath);
      if (files.length > 0) {
        resources.push(`${label}: ${files.join(", ")}`);
      }
    }
    if (resources.length > 0) {
      content += `\n\n**该技能目录可用资源（${skill.dir}）：**\n`;
      content += resources.map((r) => `- ${r}`).join("\n");
    }
    return content;
  }

  private resolveRenderableSkillSummaries(): SkillSummary[] {
    return Array.from(this.skills.values())
      .map((skill) => ({
        name: skill.name,
        description: skill.description,
        path: skill.path,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

function normalizeSkillPath(skillPath: string): string {
  return String(skillPath || "").replace(/\\/g, "/");
}

function unquote(value: string): string {
  return value
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1");
}

function parseFrontmatter(frontmatter: string): Record<string, string> {
  const lines = String(frontmatter || "")
    .replace(/\r\n/g, "\n")
    .split("\n");

  const meta: Record<string, string> = {};
  let blockKey: string | null = null;
  let blockStyle: "literal" | "folded" | null = null;
  let blockIndent: number | null = null;
  let blockLines: string[] = [];

  const flushBlock = () => {
    if (!blockKey) return;
    const raw = blockLines.join("\n");
    meta[blockKey] = blockStyle === "folded" ? raw.replace(/\n+/g, "\n") : raw;
    blockKey = null;
    blockStyle = null;
    blockIndent = null;
    blockLines = [];
  };

  for (const rawLine of lines) {
    const line = rawLine ?? "";
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    const isKeyLine = !!keyMatch && !/^\s/.test(line);

    if (isKeyLine) {
      flushBlock();
      const key = String(keyMatch?.[1] || "").trim();
      const valueRaw = String(keyMatch?.[2] || "");
      const value = unquote(valueRaw);
      if (!key) continue;

      const block = value.trim();
      const isLiteral = block === "|" || block === "|-" || block === "|+";
      const isFolded = block === ">" || block === ">-" || block === ">+";
      if (isLiteral || isFolded) {
        blockKey = key;
        blockStyle = isFolded ? "folded" : "literal";
        continue;
      }

      meta[key] = value;
      continue;
    }

    if (blockKey) {
      if (line.trim() === "") {
        blockLines.push("");
        continue;
      }

      const indentMatch = line.match(/^(\s+)/);
      const indent = indentMatch ? indentMatch[1].length : 0;
      if (blockIndent === null) blockIndent = indent;
      const start = Math.min(blockIndent, line.length);
      blockLines.push(line.slice(start));
    }
  }

  flushBlock();
  return meta;
}

function normalizeDescription(raw: string): string {
  const trimmed = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!trimmed) return "";
  return trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
}
