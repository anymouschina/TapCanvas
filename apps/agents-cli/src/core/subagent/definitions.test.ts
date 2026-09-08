import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadAgentDefinitions } from "./definitions.js";

test("agent definitions preserve an explicitly no-tool specialist", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-no-tool-definition-"));
  const definitionFile = path.join(tempDir, "definitions.json");
  try {
    fs.writeFileSync(
      definitionFile,
      JSON.stringify([
        {
          name: "image_prompt_specialist",
          description: "Builds a prompt without tool access",
          prompt: "Return strict JSON.",
          tools: [],
        },
      ]),
      "utf8",
    );

    const definitions = loadAgentDefinitions([definitionFile]);
    assert.deepEqual(definitions.get("image_prompt_specialist")?.tools, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("agent definitions still reject a missing tools declaration", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agents-missing-tools-"));
  const definitionFile = path.join(tempDir, "definitions.json");
  try {
    fs.writeFileSync(
      definitionFile,
      JSON.stringify([
        {
          name: "invalid_specialist",
          description: "Missing capability declaration",
          prompt: "Return strict JSON.",
        },
      ]),
      "utf8",
    );

    assert.equal(loadAgentDefinitions([definitionFile]).has("invalid_specialist"), false);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
