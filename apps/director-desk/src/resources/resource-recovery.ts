import { assertProject, clone, validateProject, type Project } from '../model.ts';
import { modelPath, packModelFiles, unpackModelFiles, type ModelPackage, type ModelSourceFile } from './model-package.ts';
import { assertResourceHeader, modelResourceId, type ModelResource } from './project-resources.ts';
import { resourceUsage } from './resource-usage.ts';
import { assertSceneDocument, readSceneDocument, type SceneDocument } from '../scenes/sequence-project.ts';

export interface ResourceProblem {
    id: string; name: string; reason: string; entry: string | null;
    entities: { id: string; name: string }[];
    motionClips: { entityId: string; clipId: string }[];
}
/** Invalid bytes never leave this draft as a Project. Only finish() exposes validated data. */
export class ResourceRecovery<T extends Project | SceneDocument = Project> {
    #candidate: T;
    #problems: ResourceProblem[];
    private constructor(candidate: T, problems: ResourceProblem[]) { this.#candidate = candidate; this.#problems = problems; }
    get problems(): ResourceProblem[] { return clone(this.#problems); }
    static async inspect(input: unknown): Promise<ResourceRecovery> {
        return ResourceRecovery.inspectCandidate<Project>(input, false);
    }
    static async inspectDocument(input: unknown): Promise<ResourceRecovery<SceneDocument> | ResourceRecovery<Project>> {
        return (input as { version?: unknown })?.version === 3
            ? ResourceRecovery.inspectCandidate<SceneDocument>(input, true) : ResourceRecovery.inspect(input);
    }
    private static async inspectCandidate<P extends Project | SceneDocument>(input: unknown, document: boolean): Promise<ResourceRecovery<P>> {
        // This cast only permits inspection. The private structural probe below validates all
        // non-resource fields; its dummy package is never loaded, serialized or returned.
        const candidate = clone(input) as P;
        const assert = (value: unknown) => document ? assertSceneDocument(value) : assertProject(value);
        if (!candidate || (candidate.resources !== undefined && !Array.isArray(candidate.resources))) {
            assert(candidate); throw Error('无法读取工程结构');
        }
        if (document && !Array.isArray((candidate as SceneDocument).scenes)) { assert(candidate); throw Error('无法读取戏段结构'); }
        const scenes = document ? (candidate as SceneDocument).scenes.flatMap(scene => [{ name: scene?.name, state: scene?.state },
            ...(scene?.origin ? [{ name: `${scene.name} 的接拍来源`, state: scene.origin.state }] : [])]) : [{ name: '', state: candidate as Project }];
        if (!Array.isArray(scenes) || scenes.some(scene => !Array.isArray(scene.state?.entities))) { assert(candidate); throw Error('无法读取戏段结构'); }
        const ids = new Set<string>();
        for (const resource of candidate.resources ?? []) {
            assertResourceHeader(resource);
            if (ids.has(resource.id)) throw Error('模型资源标识重复');
            ids.add(resource.id);
        }
        for (const entity of scenes.flatMap(scene => scene.state.entities)) {
            const references = [entity?.external?.resourceId, ...(Array.isArray(entity?.clips) ? entity.clips.map(c => c?.retarget?.resourceId) : [])];
            for (const id of references) if (id !== undefined) {
                if (typeof id !== 'string' || !/^model-[0-9a-f]{64}$/.test(id)) throw Error('模型资源引用标识无效');
                ids.add(id);
            }
        }
        const problems: ResourceProblem[] = [];
        for (const id of ids) {
            const resource = candidate.resources?.find(r => r.id === id);
            let reason = '';
            try {
                if (!resource) throw Error('工程未包含此资源');
                unpackModelFiles(resource.package);
                if (await modelResourceId(resource.package) !== id) throw Error('资源内容与原标识不一致');
            } catch (error) { reason = error instanceof Error ? error.message : String(error); }
            if (!reason) continue;
            let entry: string | null = null;
            try { entry = modelPath(resource?.package?.entry as string); } catch { /* Missing entry is reported, never guessed. */ }
            problems.push({ id, name: resource?.name ?? '缺失模型', reason, entry, entities: [], motionClips: [] });
        }
        if (!problems.length) { assert(candidate); return new ResourceRecovery(candidate, []); }
        const probe = clone(candidate);
        const dummy = packModelFiles('structure-check.gltf', [{ path: 'structure-check.gltf', bytes: new TextEncoder().encode('{"asset":{"version":"2.0"}}') }]);
        for (const { id } of problems) {
            const resource = candidate.resources?.find(r => r.id === id);
            probe.resources ??= [];
            const index = probe.resources.findIndex(r => r.id === id);
            const placeholder = resource ? { ...resource, package: dummy } : { id, name: '', package: dummy, copyright: '', license: '', source: '' };
            if (index < 0) probe.resources.push(placeholder); else probe.resources[index] = placeholder;
        }
        assert(probe);
        for (const scene of scenes) {
            const project = { ...scene.state, resources: probe.resources } as Project;
            const uses = resourceUsage(project);
            for (const problem of problems) {
                const usage = uses.find(r => r.id === problem.id)!;
                problem.entities.push(...usage.entityIds.map(id => ({ id, name: (scene.name ? `${scene.name} / ` : '') + project.entities.find(e => e.id === id)!.name })));
                problem.motionClips.push(...usage.motionClips);
            }
        }
        return new ResourceRecovery(candidate, problems);
    }
    /** Restore exact content identity; even valid but different models must not inherit old node/bone paths. */
    async restore(id: string, resource: ModelResource): Promise<void> {
        if (!this.#problems.some(p => p.id === id)) throw Error('此资源无需恢复');
        const owned = clone(resource);
        assertResourceHeader(owned); unpackModelFiles(owned.package);
        if (owned.id !== id || await modelResourceId(owned.package) !== id) throw Error('文件与原资源不匹配，请选择原始模型及关联文件，或包含原资源的完整工程');
        const resources = this.#candidate.resources ??= [], index = resources.findIndex(r => r.id === id);
        // Preserve the damaged project's user annotations; a wholly absent resource uses donor metadata.
        if (index < 0) resources.push(owned); else resources[index] = { ...resources[index], package: owned.package };
        this.#problems = this.#problems.filter(p => p.id !== id);
    }
    async restoreFiles(id: string, entry: string, files: readonly ModelSourceFile[]): Promise<void> {
        const problem = this.#problems.find(p => p.id === id); if (!problem) throw Error('此资源无需恢复');
        let data = packModelFiles(entry, files);
        // Folder selection may introduce a different root directory. Keep relative dependencies
        // and the original package path, so identical bytes retain their content identity.
        if (problem.entry && data.entry !== problem.entry) data = relocatePackage(data, problem.entry);
        await this.restore(id, { id, package: data, name: problem.entry ?? entry, copyright: '', license: '', source: '' });
    }
    finish(): T {
        if (this.#problems.length) throw Error(`还有 ${this.#problems.length} 项模型资源需要恢复`);
        return (this.#candidate.version === 3 ? readSceneDocument(this.#candidate) : validateProject(this.#candidate)) as T;
    }
}

function relocatePackage(data: ModelPackage, targetEntry: string): ModelPackage {
    const sourceParts = data.entry.split('/'), targetParts = targetEntry.split('/');
    const sourceName = sourceParts.pop()!, targetName = targetParts.pop()!;
    const paths = unpackModelFiles(data);
    const files = [...paths].map(([path, bytes]) => {
        if (path === data.entry) return { path: targetEntry, bytes };
        const parts = path.split('/'); let shared = 0;
        while (shared < sourceParts.length && shared < parts.length && sourceParts[shared] === parts[shared]) shared++;
        return { path: modelPath([...targetParts, ...Array(sourceParts.length - shared).fill('..'), ...parts.slice(shared)].join('/')), bytes };
    });
    if (sourceName.split('.').at(-1)?.toLowerCase() !== targetName.split('.').at(-1)?.toLowerCase()) throw Error('补回文件的模型格式与原文件不同');
    return packModelFiles(targetEntry, files);
}
