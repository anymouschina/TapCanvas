import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { resolveSkillRoot } from "./runtime-paths.mjs";

test("resolveSkillRoot resolves the tapcanvas-api directory from a file URL", () => {
  const expectedSkillRoot = path.dirname(fileURLToPath(import.meta.url));
  const callScriptUrl = new URL("./scripts/call.mjs", import.meta.url);

  assert.equal(resolveSkillRoot(callScriptUrl), expectedSkillRoot);
});
