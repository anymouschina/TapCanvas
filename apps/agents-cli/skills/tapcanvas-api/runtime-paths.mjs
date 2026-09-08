import path from "node:path";
import { fileURLToPath } from "node:url";

export function resolveSkillRoot(moduleUrl) {
  return path.resolve(path.dirname(fileURLToPath(moduleUrl)), "..");
}
