import { ToolHandler } from "./registry.js";
import { SkillLoader } from "../skills/loader.js";

function buildSkillToolDescription(loader: SkillLoader) {
  return [
    "加载技能以获得领域知识。在任务与某个 skill 的描述匹配时，必须先加载对应 `SKILL.md` 再继续执行。",
    "",
    loader.renderSkillsSection(),
    "",
    "加载后只遵循与当前任务相关的部分，不要把无关 skill 正文带入当前回合。",
  ].join("\n");
}

export function createSkillTool(loader: SkillLoader): ToolHandler {
  const definition = {
    name: "Skill",
    description: buildSkillToolDescription(loader),
    parameters: {
      type: "object",
      properties: {
        skill: { type: "string", description: "技能名称" },
      },
      required: ["skill"],
    },
  };

  return {
    definition,
    async execute(args, ctx, toolCallId) {
      const name = String(args.skill ?? "").trim();
      let content = loader.getSkillContent(name);
      if (!content) {
        loader.reloadSkills();
        definition.description = buildSkillToolDescription(loader);
        content = loader.getSkillContent(name);
      }
      if (!content) {
        const available = loader.listSkills().join(", ") || "无";
        return {
          toolCallId,
          content: `错误：未知 Skill '${name}'。可用技能：${available}`,
        };
      }

      return {
        toolCallId,
        content: `<skill-loaded name="${name}">
${content}
</skill-loaded>

请遵循上述 Skill 的指引完成用户任务。`,
      };
    },
  };
}
