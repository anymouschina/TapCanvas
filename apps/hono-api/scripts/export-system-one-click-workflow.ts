import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { builtInOneClickWorkflowSql } from "../src/modules/agents/system-one-click-workflow";
import { builtInVideoProductionWorkflowSql } from "../src/modules/agents/system-video-production-workflow";

// Build-time export only. This command does not connect to a database.
const outputDirectory = resolve(__dirname, "../sql/releases");
mkdirSync(outputDirectory, { recursive: true });
const videoProduction = process.argv.includes("--video-production");
const outputPath = resolve(outputDirectory, videoProduction
  ? "20260920_video_production_v90.sql"
  : "20260908_one_click_video_nodes_v1.sql");
writeFileSync(outputPath, videoProduction ? builtInVideoProductionWorkflowSql() : builtInOneClickWorkflowSql());
console.log(outputPath);
