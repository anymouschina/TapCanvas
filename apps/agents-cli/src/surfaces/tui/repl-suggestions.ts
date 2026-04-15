import { SkillLoader } from "../../core/skills/loader.js";

export type SkillSummary = {
  name: string;
  description: string;
};

export type SuggestionEntry = {
  kind: "command" | "skill";
  label: string;
  description: string;
  insertText: string;
};

export type SuggestionState = {
  active: boolean;
  allSkills: SkillSummary[];
  list: SuggestionEntry[];
  selected: number;
};

const MAX_VISIBLE_SUGGESTIONS = 10;

const LOCAL_COMMANDS: ReadonlyArray<SuggestionEntry> = [
  {
    kind: "command",
    label: "/help",
    description: "显示 TUI 快捷键与本地命令帮助",
    insertText: "/help",
  },
  {
    kind: "command",
    label: "/copy",
    description: "复制最后一条 assistant 回复到系统剪贴板",
    insertText: "/copy",
  },
  {
    kind: "command",
    label: "/clear",
    description: "清空当前终端显示",
    insertText: "/clear",
  },
  {
    kind: "command",
    label: "/skills",
    description: "查看技能输入提示",
    insertText: "/skills",
  },
  {
    kind: "command",
    label: "/status",
    description: "查看当前 profile、session 与 runtime 摘要",
    insertText: "/status",
  },
  {
    kind: "command",
    label: "/sessions",
    description: "列出最近可恢复的会话",
    insertText: "/sessions",
  },
  {
    kind: "command",
    label: "/resume",
    description: "恢复指定会话：/resume <id>",
    insertText: "/resume ",
  },
  {
    kind: "command",
    label: "/new",
    description: "切换到新会话：/new [id]",
    insertText: "/new ",
  },
];

export function refreshSkills(skills: SkillLoader): SkillSummary[] {
  skills.reloadSkills();
  return skills.listSkillSummaries();
}

export function buildSuggestions(input: string, allSkills: SkillSummary[]): SuggestionEntry[] {
  const normalized = input.trimStart();
  if (!normalized.startsWith("/")) return [];

  const commandPart = normalized.slice(1);
  const lower = commandPart.toLowerCase();
  if (lower.startsWith("skill ")) {
    const skillQuery = commandPart.slice(6).trim().toLowerCase();
    return allSkills
      .filter((item) => !skillQuery || item.name.toLowerCase().includes(skillQuery) || item.description.toLowerCase().includes(skillQuery))
      .slice(0, MAX_VISIBLE_SUGGESTIONS)
      .map((item) => ({
        kind: "skill",
        label: `/skill ${item.name}`,
        description: item.description,
        insertText: `/skill ${item.name} `,
      }));
  }

  const query = commandPart.trim().toLowerCase();
  const commandMatches = LOCAL_COMMANDS.filter(
    (item) =>
      !query ||
      item.label.slice(1).toLowerCase().includes(query) ||
      item.description.toLowerCase().includes(query),
  );
  const skillMatches = allSkills
    .filter((item) => !query || item.name.toLowerCase().includes(query) || item.description.toLowerCase().includes(query))
    .slice(0, MAX_VISIBLE_SUGGESTIONS - commandMatches.length)
    .map((item) => ({
      kind: "skill" as const,
      label: `/skill ${item.name}`,
      description: item.description,
      insertText: `/skill ${item.name} `,
    }));
  return [...commandMatches, ...skillMatches].slice(0, MAX_VISIBLE_SUGGESTIONS);
}

export function shouldApplySuggestionOnEnter(input: string, suggestions: SuggestionState): boolean {
  if (!suggestions.active || suggestions.list.length === 0) return false;
  const normalized = input.trim();
  if (normalized === "/" || normalized === "/skill" || normalized === "/skills") return true;
  if (/^\/[^\s]+$/u.test(normalized)) return true;
  if (/^\/skill\s+\S*$/iu.test(normalized)) return true;
  return false;
}
