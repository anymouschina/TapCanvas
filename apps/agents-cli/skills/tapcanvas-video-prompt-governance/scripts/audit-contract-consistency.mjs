import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../../../../..");
const contractPath = resolve(
  repositoryRoot,
  "apps/agents-cli/skills/tapcanvas-video-prompt-writer/references/authoring-contract-v1.json",
);

const contract = JSON.parse(await readFile(contractPath, "utf8"));
const contractMarker = `${contract.contractId}@${contract.version}`;
const errors = [];

const parseFrontmatter = (content) => {
  const normalized = String(content).replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return null;
  const end = normalized.indexOf("\n---\n", 4);
  if (end < 0) return null;
  const lines = normalized.slice(4, end).split("\n");
  const scalars = new Map();
  const lists = new Map();
  const metadataLists = new Map();
  let activeTopLevelList = null;
  let activeMetadataList = null;
  let inMetadata = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      activeTopLevelList = null;
      activeMetadataList = null;
      inMetadata = trimmed === "metadata:";
      const separator = trimmed.indexOf(":");
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (value) scalars.set(key, value);
      else if (key !== "metadata") {
        activeTopLevelList = key;
        lists.set(key, []);
      }
      continue;
    }

    if (inMetadata) {
      if (indent === 2) {
        activeMetadataList = null;
        const separator = trimmed.indexOf(":");
        if (separator < 1) continue;
        const key = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim();
        if (value) metadataLists.set(key, value.split(",").map((item) => item.trim()));
        else {
          activeMetadataList = key;
          metadataLists.set(key, []);
        }
        continue;
      }
      if (indent > 2 && trimmed.startsWith("- ") && activeMetadataList) {
        metadataLists.get(activeMetadataList).push(trimmed.slice(2).trim());
      }
      continue;
    }

    if (trimmed.startsWith("- ") && activeTopLevelList) {
      lists.get(activeTopLevelList).push(trimmed.slice(2).trim());
    }
  }
  return { scalars, lists, metadataLists };
};

if (!Array.isArray(contract.dimensions) || contract.dimensions.length === 0) {
  errors.push("authoring contract has no dimensions");
}

const dimensionIds = new Set();
for (const dimension of contract.dimensions ?? []) {
  const id = String(dimension?.id ?? "").trim();
  if (!id) errors.push("authoring contract contains a dimension without id");
  if (dimensionIds.has(id)) errors.push(`duplicate dimension id: ${id}`);
  dimensionIds.add(id);
  for (const key of ["owner", "writerInputs", "writerOutputs", "reviewerChecks", "extensionPolicy"]) {
    if (!(key in dimension)) errors.push(`dimension ${id || "<missing>"} misses ${key}`);
  }
}

for (const consumer of contract.consumers?.skills ?? []) {
  const absolutePath = resolve(repositoryRoot, consumer.path);
  const metadata = parseFrontmatter(await readFile(absolutePath, "utf8"));
  if (!metadata) {
    errors.push(`${consumer.path} has invalid frontmatter`);
    continue;
  }
  if (metadata.scalars.get("name") !== consumer.name) {
    errors.push(`${consumer.path} declares a different skill name`);
  }
  const declaredContracts = metadata.metadataLists.get("contracts") ?? [];
  if (!declaredContracts.includes(contractMarker)) {
    errors.push(`${consumer.name} does not declare contract ${contractMarker}`);
  }
}

const retiredPath = resolve(
  repositoryRoot,
  "apps/agents-cli/skills/tapcanvas-generate-video-nodes/SKILL.md",
);
const retiredMetadata = parseFrontmatter(await readFile(retiredPath, "utf8"));
if (
  !retiredMetadata ||
  retiredMetadata.scalars.get("retired") !== "true" ||
  retiredMetadata.scalars.get("disable-model-invocation") !== "true"
) {
  errors.push("retired generate-video-nodes skill is still model-invocable");
}

const roleConsumers = contract.consumers?.roles ?? [];
const definitionsPath = resolve(
  repositoryRoot,
  roleConsumers[0]?.path ?? "apps/agents-cli/agent-definitions/defaults.json",
);
const definitions = JSON.parse(await readFile(definitionsPath, "utf8"));
for (const roleConsumer of roleConsumers) {
  const role = definitions.find((definition) => definition.name === roleConsumer.name);
  const bundle = Array.isArray(role?.skillBundle) ? role.skillBundle : [];
  for (const requiredSkill of roleConsumer.requiredSkillBundle ?? []) {
    if (!bundle.includes(requiredSkill)) {
      errors.push(`${roleConsumer.name} role misses ${requiredSkill}`);
    }
  }
}
for (const binding of contract.consumers?.forbiddenRoleBindings ?? []) {
  for (const roleName of binding.roleNames ?? []) {
    const role = definitions.find((definition) => definition.name === roleName);
    const bundle = Array.isArray(role?.skillBundle) ? role.skillBundle : [];
    if (bundle.includes(binding.skill)) {
      errors.push(`${roleName} must not load ${binding.skill}`);
    }
  }
}

for (const relativePath of contract.consumers?.documentation ?? []) {
  await access(resolve(repositoryRoot, relativePath));
}

if (contract.evaluationPolicy?.semantic?.source !== "agents_judge") {
  errors.push("semantic evaluation source must be agents_judge");
}
if (contract.evaluationPolicy?.semantic?.runtimeGate !== false) {
  errors.push("semantic evaluation must not become a runtime gate");
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`[contract-audit] ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `[contract-audit] ${contractMarker} structurally consistent across ${(contract.consumers?.skills ?? []).length} skills, ${roleConsumers.length} roles, and ${contract.dimensions.length} dimensions. Semantic quality is delegated to agents_judge.\n`,
  );
}
