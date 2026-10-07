import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { load } from 'js-yaml';
import { BridgeRequestError, isJsonObject, type JsonObject } from './contracts.js';

export type SkillResource = Readonly<{ skill: string; resource: string; content: string }>;
const MAX_PRELOAD_CHARACTERS = 300_000;

function resourceList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} must be an array of nonempty resource paths`);
  }
  return value as string[];
}

/** Only opt-in metadata from explicitly required Skills is preloaded. */
export function declaredSkillResources(document: string, artifactType?: string): string[] {
  const lines = document.split(/\r?\n/u);
  if (lines[0] !== '---') return [];
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('Skill frontmatter has no closing delimiter');
  const metadata: unknown = load(lines.slice(1, end).join('\n'));
  if (!isJsonObject(metadata)) throw new Error('Skill frontmatter must be an object');
  const resources = resourceList(metadata['autoload-resources'], 'autoload-resources');
  const artifactPreload = isJsonObject(metadata.metadata) ? metadata.metadata['artifact-preload'] : undefined;
  if (artifactPreload !== undefined && !isJsonObject(artifactPreload)) {
    throw new Error('metadata.artifact-preload must be an object');
  }
  if (artifactType && isJsonObject(artifactPreload)) {
    resources.push(...resourceList(artifactPreload[artifactType], `metadata.artifact-preload.${artifactType}`));
  }
  return [...new Set(resources)];
}

export function outputArtifactType(context: JsonObject): string | undefined {
  const value = context.outputArtifactType;
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new BridgeRequestError('outputArtifactType must be a nonempty string', 'invalid_output_artifact_type');
  }
  return value;
}

function requireContained(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Skill resource escapes its directory: ${target}`);
  }
}

export async function loadRequiredSkillResources(input: Readonly<{
  directory: string; requiredSkills: readonly string[]; artifactType?: string;
}>): Promise<readonly SkillResource[]> {
  const units: SkillResource[] = [];
  let characters = 0;
  for (const skill of [...new Set(input.requiredSkills)]) {
    try {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(skill)) throw new Error('Invalid bundled Skill directory name');
      const root = await realpath(path.join(input.directory, skill));
      requireContained(await realpath(input.directory), root);
      const skillFile = await realpath(path.join(root, 'SKILL.md'));
      requireContained(root, skillFile);
      const document = await readFile(skillFile, 'utf8');
      for (const resource of declaredSkillResources(document, input.artifactType)) {
        const file = path.resolve(root, resource);
        requireContained(root, file);
        const canonicalFile = await realpath(file);
        requireContained(root, canonicalFile);
        const content = await readFile(canonicalFile, 'utf8');
        if (!content.trim()) throw new Error(`Required Skill resource is empty: ${resource}`);
        characters += content.length;
        if (characters > MAX_PRELOAD_CHARACTERS) throw new Error(`Skill preload exceeds ${MAX_PRELOAD_CHARACTERS} characters`);
        units.push({ skill, resource, content });
      }
    } catch (error: unknown) {
      throw new BridgeRequestError(`Skill preload failed for ${skill}: ${error instanceof Error ? error.message : String(error)}`,
        'skill_preload_failed');
    }
  }
  return units;
}

export function renderSkillResources(resources: readonly SkillResource[]): string {
  return resources.length === 0 ? '' : [
    '<required_skill_resources>',
    'These are exact resources declared by the required Skills for this artifact. They are already loaded; use their contracts without rereading the same content. Other Skill resources remain available on demand.',
    JSON.stringify(resources),
    '</required_skill_resources>',
  ].join('\n');
}
