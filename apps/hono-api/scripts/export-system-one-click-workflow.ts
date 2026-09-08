import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { builtInOneClickWorkflowSql } from "../src/modules/agents/system-one-click-workflow";

// Build-time export only. This command does not connect to a database.
const outputDirectory = resolve(__dirname, "../sql/releases");
mkdirSync(outputDirectory, { recursive: true });
const outputPath = resolve(outputDirectory, "20260908_one_click_video_nodes_v1.sql");
writeFileSync(outputPath, builtInOneClickWorkflowSql());
console.log(outputPath);
