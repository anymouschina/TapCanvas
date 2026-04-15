import fs from "node:fs/promises";
import path from "node:path";

function readRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const outputDir = readRequiredEnv("LOCAL_TASK_OUTPUT_DIR");
const manifestPath = readRequiredEnv("LOCAL_TASK_MANIFEST_PATH");

await fs.mkdir(outputDir, { recursive: true });
const manifestRaw = await fs.readFile(manifestPath, "utf-8");
const manifest = JSON.parse(manifestRaw);

const frameOne = path.join(outputDir, "frame-001.png");
const frameTwo = path.join(outputDir, "frame-002.png");
const payload = JSON.stringify(
  {
    kind: "local-task-generator-smoke",
    runId: manifest.runId,
    chunkIndex: manifest.chunkIndex,
    objective: manifest.objective,
  },
  null,
  2,
);

await fs.writeFile(frameOne, `${payload}\nframe=1\n`, "utf-8");
await fs.writeFile(frameTwo, `${payload}\nframe=2\n`, "utf-8");

process.stdout.write(
  JSON.stringify(
    {
      ok: true,
      outputDir,
      files: [frameOne, frameTwo],
    },
    null,
    2,
  ) + "\n",
);
