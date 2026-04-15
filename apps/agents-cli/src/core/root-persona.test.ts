import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProfileSystemOverride,
  DEFAULT_ROOT_PERSONA_INTRO,
} from "./root-persona.js";

test("default root persona intro keeps agents-cli positioned as a general assistant", () => {
  assert.match(DEFAULT_ROOT_PERSONA_INTRO, /不是单一的 code agent/);
  assert.match(DEFAULT_ROOT_PERSONA_INTRO, /通用型智能体助手与编排器/);
  assert.match(DEFAULT_ROOT_PERSONA_INTRO, /代码实现只是你的能力之一/);
});

test("general profile override keeps strict non-code constraints without changing root identity", () => {
  const general = buildProfileSystemOverride("general");
  assert.match(general, /通用助手模式/);
  assert.match(general, /不要执行 shell 命令/);
  assert.match(general, /不要把自己收窄成 code agent/);
});

test("code profile override enables tools without collapsing persona into a coding agent", () => {
  const code = buildProfileSystemOverride("code");
  assert.match(code, /执行增强模式/);
  assert.match(code, /默认人格仍是通用助手|保持通用型智能体助手身份/);
  assert.match(code, /不要默认把所有问题都收窄为代码问题/);
});
