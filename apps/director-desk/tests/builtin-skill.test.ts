import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { BUILTIN_SKILL, readBuiltinSkill } from '../src/automation/skill.ts';
import { isDiscussionToolCall } from '../src/automation/contract.ts';
import { createToolService } from '../src/automation/service.ts';
import type { AppContext } from '../src/app-context.ts';

const require = createRequire(import.meta.url);
const { referenceFiles, publicFiles }: { referenceFiles: string[]; publicFiles: string[] } = require('../scripts/builtin-skill-files.cjs');

test('bundled skill is fresh and versioned by content rather than the application release', async () => {
    const files = ['skills/director-desk/SKILL.md', ...referenceFiles.map(file => 'skills/director-desk/' + file),
        'src/automation/contract.ts', 'src/automation/tool-summaries.ts', 'src/media/help.ts', 'src/automation/read-sections.ts'];
    const contents = await Promise.all(files.map(file => fs.readFile(file, 'utf8').then(s => s.replace(/\r\n/g, '\n'))));
    assert.equal(BUILTIN_SKILL.version, 'sha256:' + createHash('sha256').update(JSON.stringify(contents)).digest('hex'));
    assert.equal(BUILTIN_SKILL.instructions, await fs.readFile('skills/director-desk/references/online-workflow.md', 'utf8').then(s => s.replace(/\r\n/g, '\n')));
    assert.deepEqual(Object.keys(BUILTIN_SKILL.references), referenceFiles);
    const first = readBuiltinSkill();
    assert.equal(first.unchanged, false); assert.ok(first.instructions);
    assert.deepEqual(readBuiltinSkill(first.version), { name: first.name, version: first.version, unchanged: true, files: first.files });
    assert.equal(readBuiltinSkill('older-skill').instructions, first.instructions);
    assert.equal(readBuiltinSkill().instructions, first.instructions, 'one caller reading never suppresses another caller');
    assert.equal(isDiscussionToolCall('director_skill', {}), true);
});

test('explicit built-in paths read only the requested reference even when the core version is known', async () => {
    const first = readBuiltinSkill();
    assert.deepEqual(first.files, ['SKILL.md', ...referenceFiles]);
    for (const file of referenceFiles) {
        const result = readBuiltinSkill(first.version, file);
        assert.equal(result.unchanged, false); assert.equal(result.path, file);
        assert.equal(result.instructions, await fs.readFile('skills/director-desk/' + file, 'utf8').then(s => s.replace(/\r\n/g, '\n')));
        assert.equal(Object.hasOwn(result, 'references'), false, 'Do not return every attachment with a focused read');
    }
    assert.equal(readBuiltinSkill(first.version, 'SKILL.md').instructions, first.instructions);
    for (const file of ['', '../SKILL.md', 'references/../SKILL.md', '/SKILL.md', 'C:/secret', 'references\\camera.md', 'references/Camera.md', '__proto__', 'constructor', 'scripts/project-tool.mjs'])
        assert.throws(() => readBuiltinSkill(first.version, file), /没有这个文件/, file);
    assert.equal(readBuiltinSkill().instructions, first.instructions, 'Reference reads never set global learned state');
});

test('web director_skill exposes the same allowlisted references and keeps custom skills desktop-only', async () => {
    const service = createToolService({} as AppContext);
    const listed = await service.call('director_skill', { action: 'list' });
    assert.equal(listed.ok, true);
    const skills = (listed.data as { skills: { files: string[] }[] }).skills;
    assert.deepEqual(skills[0].files, readBuiltinSkill().files);
    for (const path of ['SKILL.md', ...referenceFiles]) {
        const result = await service.call('director_skill', { path, knownVersion: BUILTIN_SKILL.version });
        assert.equal(result.ok, true, result.error ?? 'skill request failed');
        assert.deepEqual(result.data, readBuiltinSkill(BUILTIN_SKILL.version, path));
    }
    assert.equal((await service.call('director_skill', { path: '../private.txt' })).ok, false);
    assert.equal((await service.call('director_skill', { id: 'custom' })).ok, false);
    const unchanged = await service.call('director_skill', { knownVersion: BUILTIN_SKILL.version });
    assert.deepEqual(unchanged.data, readBuiltinSkill(BUILTIN_SKILL.version));
});

test('shareable skill payload lists explicit public references without directory globs', () => {
    assert.ok(referenceFiles.every(file => publicFiles.includes(file)));
    assert.equal(new Set(publicFiles).size, publicFiles.length);
    assert.ok(publicFiles.every(file => !/[?*]/.test(file)), 'The skill payload must not include directory globs');
});
