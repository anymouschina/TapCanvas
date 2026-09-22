import test from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, validateProject } from '../src/model.ts';
import { applyOperations, changeSummary } from '../src/automation/edits.ts';
import { validateToolInput } from '../src/automation/validate.ts';
import { FULL_TOOL_DEFINITIONS, TOOL_DEFINITIONS, toolHelp, isDiscussionToolCall } from '../src/automation/contract.ts';

test('short discovery preserves every validation rule and exposes full advanced contracts on demand', () => {
    const rules = (value: any): any => Array.isArray(value) ? value.map(rules) : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'description').map(([key, v]) => [key, rules(v)])) : value;
    for (const tool of FULL_TOOL_DEFINITIONS) {
        const short = TOOL_DEFINITIONS.find(t => t.name === tool.name)!;
        assert.deepEqual(rules(short.inputSchema), rules(tool.inputSchema));
        assert.deepEqual(toolHelp([tool.name]).tools[0], tool);
    }
    assert.ok(JSON.stringify(TOOL_DEFINITIONS).length < JSON.stringify(FULL_TOOL_DEFINITIONS).length * .6);
    assert.equal(isDiscussionToolCall('director_help', { names: ['director_apply'] }), true);
    assert.throws(() => toolHelp(['unknown']), /未知/);
    assert.throws(() => validateToolInput('director_help', { names: [] }));
    assert.throws(() => validateToolInput('director_help', { names: ['a','b','c','d'] }));
});

test('AI atomic batch adds timed movement and rolls back on invalid second operation', () => {
    const before = demoProject(), serialized = JSON.stringify(before);
    const next = applyOperations(before, [{ operation: 'add', asset: 'woman', id: 'new-actor', patch: {
        path: { smooth: false, points: [{ time: 0, position: [0, 0, 0] }, { time: 5, position: [2, 1, 3] }] },
        clips: [{ id: 'walk', action: 'walk', start: 0, end: 5, speed: 1 }] } }]);
    assert.equal(next.entities.at(-1)?.gender, 'female'); assert.equal(next.entities.at(-1)?.path?.points[1].position[1], 1);
    assert.throws(() => applyOperations(before, [{ operation: 'add', asset: 'woman' }, { operation: 'update', id: 'missing', patch: { name: 'x' } }]), /不存在/);
    assert.equal(JSON.stringify(before), serialized);
});
test('AI cannot alter locked entities, duplicate IDs, or remove referenced cameras', () => {
    const p = demoProject(), e = p.entities[0]; e.locked = true;
    assert.throws(() => applyOperations(p, [{ operation: 'update', id: e.id, patch: { name: 'x' } }]), /锁定/);
    assert.throws(() => applyOperations(p, [{ operation: 'add', asset: 'woman', id: e.id }]));
    assert.throws(() => applyOperations(p, [{ operation: 'remove', id: p.cuts[0].cameraId }]), /引用/);
    assert.throws(() => applyOperations(p, [{ operation: 'add', asset: 'woman', patch: { locked: false } }]), /不允许/);
});
test('Tool contract rejects unknown keys, unbounded export, NaN and prototype fields', () => {
    assert.throws(() => validateToolInput('director_export', { kind: 'video', size: 8000 }), /取值/);
    assert.throws(() => validateToolInput('director_view', { time: NaN }), /有限/);
    assert.throws(() => validateToolInput('director_read', { key: 'private' }), /未知/);
    assert.throws(() => validateToolInput('director_apply', { revision: 1, requestId: 'x', operations: [{ operation: 'add', asset: 'woman', patch: JSON.parse('{"__proto__":{"x":1}}') }] }), /未知/);
    assert.throws(() => validateToolInput('director_apply', { revision: 1, requestId: 'x' }), /缺少/);
    validateToolInput('director_apply', { revision: 1, requestId: 'x', operations: [{ operation: 'add', asset: 'woman', position: [1, 2, 3] }] });
});


test('catalog parameter values route to the documented patch field with an actionable atomic error', () => {
    const before = demoProject(), saved = JSON.stringify(before);
    assert.throws(() => applyOperations(before, [
        { operation: 'add', asset: 'camera', id: 'new-camera' },
        { operation: 'add', asset: 'furniture-desk', id: 'desk', patch: { parameters: { width: 1.4 } } },
    ]), /operations\[1\].*patch.assetParameters/);
    assert.equal(JSON.stringify(before), saved);
    const next = applyOperations(before, [{ operation: 'add', asset: 'furniture-desk', id: 'desk', patch: { assetParameters: { width: 1.4, height: .75, depth: .7 } } }]);
    assert.equal(next.entities.at(-1)?.assetParameters?.width, 1.4);
    assert.equal(changeSummary(before, next).hasChanges, true);
    assert.equal(changeSummary(before, next).projectChanged, false, 'legacy flag describes top-level fields only');
    assert.throws(() => applyOperations(before, [{ operation: 'add', asset: 'stairs', patch: { assetParameters: { width: 2 } } }]), /使用 patch.parameters/);
});

test('camera patches preserve defaults and existing tracking while rejecting invalid fields atomically', () => {
    const original = demoProject(), saved = JSON.stringify(original);
    const actor = original.entities.find(e => e.kind === 'actor')!;
    const next = applyOperations(original, [{ operation: 'add', asset: 'camera', id: 'short-camera', patch: { camera: { focal: 70, targetId: actor.id, hiddenEntityIds: [actor.id] } } }]);
    const camera = next.entities.at(-1)!;
    assert.equal(camera.camera!.aim, 'target'); assert.equal(camera.camera!.mode, 'free');
    const edited = applyOperations(next, [{ operation: 'update', id: camera.id, patch: { camera: { focal: 50, hideWalls: ['north'] } } }]);
    assert.equal(edited.entities.at(-1)!.camera!.targetId, actor.id);
    assert.deepEqual(edited.entities.at(-1)!.camera!.hiddenEntityIds, [actor.id]);
    assert.deepEqual(edited.entities.at(-1)!.camera!.hideWalls, ['north']);
    for (const invalid of [{ focal: 0 }, null, { focusLength: 70 }]) assert.throws(() => applyOperations(original, [{ operation: 'add', asset: 'camera', patch: { camera: invalid } }]));
    assert.equal(JSON.stringify(original), saved);
    validateToolInput('director_apply', { revision: 1, requestId: 'commit', previewId: 'existing-preview' });
    for (const args of [{ previewId: '' }, { previewId: 'p', preview: true }, { previewId: 'p', operations: [{ operation: 'add', asset: 'person' }] }])
        assert.throws(() => validateToolInput('director_apply', { revision: 1, requestId: 'invalid', ...args }), /previewId/);
});

test('production notes give precise schema errors and roll back earlier edits; references can target same-batch actors', () => {
    const before = demoProject(), saved = JSON.stringify(before);
    const prefix = { operation: 'add', asset: 'woman', id: 'note-actor' };
    assert.throws(() => applyOperations(before, [{ operation: 'notes', patch: { story: 'must not silently clear production' } }]), /operations\[0\].*fixedPrompt/);
    for (const value of [[], 'story', { notes: [] }]) {
        assert.throws(() => applyOperations(before, [prefix, { operation: 'notes', value }]), /operations\[1\].*fixedPrompt/);
        assert.equal(JSON.stringify(before), saved);
    }
    const value = { fixedPrompt: '', sceneReferenceIds: [], notes: [{ id: 'note-1', start: 0, end: 3, actorId: 'note-actor', story: 'plot', emotion: '', dialogue: '', action: '' }] };
    const next = applyOperations(before, [{ operation: 'notes', value }, prefix]);
    assert.deepEqual(next.production, value);
    assert.deepEqual(validateProject(next).production, value);
    const invalid = structuredClone(value); delete (invalid.notes[0] as Partial<typeof value.notes[0]>).action;
    assert.throws(() => applyOperations(before, [prefix, { operation: 'notes', value: invalid }]), /operations\[1\].*notes\[0\].action/);
    assert.throws(() => validateProject({ ...next, production: invalid }), /notes\[0\].action/);
    invalid.notes[0].action = ''; invalid.notes[0].end = 0;
    assert.throws(() => applyOperations(before, [prefix, { operation: 'notes', value: invalid }]), /notes\[0\].end/);
    assert.throws(() => applyOperations(before, [{ operation: 'notes', value }]), /notes\[0\].actorId/);
});
