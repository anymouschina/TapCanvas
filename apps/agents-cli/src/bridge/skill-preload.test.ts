import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BridgeRequestError, parseAgentsChatRequest } from './contracts.js';
import { declaredSkillResources, loadRequiredSkillResources, outputArtifactType } from './skill-preload.js';

const document = [
  '---', 'name: craft', 'description: Example', 'autoload-resources:', '  - references/source.md',
  'metadata:', '  artifact-preload:', '    example.packet/v2:', '      - SKILL.md',
  '      - references/packet.md', '      - references/source.md', '---', '# Craft',
].join('\n');

test('matches exact opaque artifact metadata and deduplicates declarations in order', () => {
  assert.deepEqual(declaredSkillResources(document, 'example.packet/v2'),
    ['references/source.md', 'SKILL.md', 'references/packet.md']);
  assert.deepEqual(declaredSkillResources(document, 'example.packet/v1'), ['references/source.md']);
  assert.throws(() => declaredSkillResources('---\nautoload-resources: bad\n---'), /must be an array/u);
});

test('loads declared bodies only and rejects missing resources, empty text and symlink escapes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'harness-skills-'));
  try {
    const root = path.join(directory, 'craft');
    await mkdir(path.join(root, 'references'), { recursive: true });
    await writeFile(path.join(root, 'SKILL.md'), document);
    await writeFile(path.join(root, 'references/source.md'), 'Authoritative source');
    const base = { directory, requiredSkills: ['craft'] };
    assert.deepEqual((await loadRequiredSkillResources(base)).map((unit) => unit.content), ['Authoritative source']);
    await assert.rejects(loadRequiredSkillResources({ ...base, artifactType: 'example.packet/v2' }),
      (error: unknown) => error instanceof BridgeRequestError && error.code === 'skill_preload_failed');
    await writeFile(path.join(root, 'references/packet.md'), 'Exact packet contract');
    const units = await loadRequiredSkillResources({ ...base, artifactType: 'example.packet/v2' });
    assert.deepEqual(units.map((unit) => unit.resource), ['references/source.md', 'SKILL.md', 'references/packet.md']);
    await writeFile(path.join(root, 'references/source.md'), '');
    await assert.rejects(loadRequiredSkillResources(base), /resource is empty/u);
    await writeFile(path.join(directory, 'outside.md'), 'Do not load');
    await writeFile(path.join(root, 'SKILL.md'), '---\nautoload-resources:\n  - references/outside.md\n---');
    await symlink(path.join(directory, 'outside.md'), path.join(root, 'references/outside.md'));
    await assert.rejects(loadRequiredSkillResources(base), /escapes its directory/u);
    await writeFile(path.join(root, 'SKILL.md'), '---\nautoload-resources:\n  - ../outside.md\n---');
    await assert.rejects(loadRequiredSkillResources(base), /escapes its directory/u);
    await writeFile(path.join(root, 'SKILL.md'), '---\nautoload-resources:\n  - references/source.md\n---');
    await writeFile(path.join(root, 'references/source.md'), 'x'.repeat(300_001));
    await assert.rejects(loadRequiredSkillResources(base), /exceeds 300000 characters/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('projects frozen output artifact without injecting model credentials', () => {
  const request = parseAgentsChatRequest({ prompt: 'Author this artifact', systemPrompt: 'Use real facts',
    model: 'test-model', overrideApiBaseUrl: 'https://models.example/v1', overrideApiKey: 'secret',
    outputArtifactType: 'example.packet/v2' });
  assert.equal(outputArtifactType(request.turnContext), 'example.packet/v2');
  assert.equal(Object.hasOwn(request.turnContext, 'overrideApiKey'), false);
  assert.throws(() => outputArtifactType({ outputArtifactType: 3 }), /nonempty string/u);
});

test('bundled v135 Skills load complete contracts for the chapter and Clip artifacts', async () => {
  const directory = path.resolve('skills');
  const chapter = await loadRequiredSkillResources({ directory,
    requiredSkills: ['tapcanvas-screenwriter', 'tapcanvas-video-authoring-stages'],
    artifactType: 'tapcanvas.chapter-sequence/v4' });
  assert.ok(chapter.some((unit) => unit.skill === 'tapcanvas-screenwriter' && unit.resource === 'SKILL.md'));
  assert.ok(chapter.some((unit) => unit.resource === 'references/chapter-sequence.md'));
  const clip = await loadRequiredSkillResources({ directory,
    requiredSkills: ['tapcanvas-video-prompt-writer', 'tapcanvas-video-authoring-stages'],
    artifactType: 'tapcanvas.clip-production-packet/v2' });
  assert.ok(clip.some((unit) => unit.skill === 'tapcanvas-video-prompt-writer' && unit.resource === 'SKILL.md'));
  assert.ok(clip.some((unit) => unit.resource === 'references/clip-design-and-packet.md'));
});
