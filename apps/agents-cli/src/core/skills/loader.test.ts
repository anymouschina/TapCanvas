import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { SkillLoader } from "./loader.js";

test("renderSkillsSection exposes metadata, file paths, and trigger rules", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-skill-loader-"));
  const skillsDir = path.join(tempDir, "skills", "tapcanvas-prompt-specialists");
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillsDir, "SKILL.md"),
    [
      "---",
      "name: tapcanvas-prompt-specialists",
      "description: 定义图片与视频 specialist 的职责边界。",
      "---",
      "",
      "# TapCanvas Prompt Specialists",
      "",
      "仅在视觉提示词任务中使用。",
    ].join("\n"),
    "utf-8",
  );

  const loader = new SkillLoader(path.join(tempDir, "skills"));
  const rendered = loader.renderSkillsSection();

  assert.match(rendered, /## Skills/);
  assert.match(rendered, /### Available skills/);
  assert.match(rendered, /tapcanvas-prompt-specialists: 定义图片与视频 specialist 的职责边界。/);
  assert.match(rendered, /file: .*tapcanvas-prompt-specialists\/SKILL\.md/);
  assert.match(rendered, /Trigger rules: If the user names a skill/);
  assert.match(rendered, /After deciding to use a skill, open its `SKILL\.md`/);
});

test("renderSkillsSection includes run-specific required skills hint when provided", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-skill-loader-required-"));
  const skillsDir = path.join(tempDir, "skills", "agents-team");
  fs.mkdirSync(skillsDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillsDir, "SKILL.md"),
    [
      "---",
      "name: agents-team",
      "description: 开启多代理协作。",
      "---",
      "",
      "# agents-team",
      "",
      "启用 spawn_agent。",
    ].join("\n"),
    "utf-8",
  );

  const loader = new SkillLoader(path.join(tempDir, "skills"));
  const rendered = loader.renderSkillsSection({ requiredSkills: ["agents-team"] });

  assert.match(rendered, /Run-specific constraint: This run explicitly prioritizes these skills first: agents-team\./);
});
