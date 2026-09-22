import type { Project } from '../model.ts';
import type { EditorHistory, ResourceOwner } from '../storage.ts';
import { SceneSession, type SceneContext, type SceneTransaction, type SceneView } from './sequence-session.ts';
import { readSceneDocument, type SceneDocument } from './sequence-project.ts';

/** Adapts existing single-scene editor transactions to one authoritative production history. */
export class SceneWorkspace implements EditorHistory {
    #session: SceneSession;
    #transaction: SceneTransaction | null = null;
    #before: Project | null = null;
    #view: () => SceneView;
    restoredView: SceneView | undefined;
    constructor(project: Project, view: () => SceneView) { this.#session = new SceneSession(project); this.#view = view; }
    get context() { return this.#session.context; }
    get pending() { return this.#before; }
    get restoredSelection() { return this.restoredView?.selected; }
    get undoLabel() { return this.#session.undoLabel; }
    get redoLabel() { return this.#session.redoLabel; }
    // Consumers only need lengths and retained source IDs; never clone binary packages here.
    get undoStack(): ResourceOwner[] { return this.#owners(this.#session.undoCount); }
    get redoStack(): ResourceOwner[] { return this.#owners(this.#session.redoCount); }
    #owners(count: number): ResourceOwner[] {
        return Array.from({ length: count }, (_, i) => i ? {} : { resources: this.#session.retainedResourceIds().map(id => ({ id })) });
    }
    list() { return this.#session.sceneList(); }
    resourceScenes(id: string) { return this.#session.resourceScenes(id); }
    document() { return this.#session.exportDocument(); }
    project() { return this.#session.project(); }
    projectFor(id: string) { return this.#session.project(id); }
    switchScene(id: string, context: SceneContext) {
        this.rememberView(); this.#session.switchScene(id, context);
        this.restoredView = this.#session.view(); return this.project();
    }
    rememberView() { this.#session.setView(this.#view()); }
    begin(project: Project) {
        if (this.pending) return;
        this.rememberView(); this.#transaction = this.#session.begin(this.context, project); this.#before = this.#transaction.project; this.restoredView = undefined;
    }
    commit(project: Project) {
        if (!this.#transaction) return;
        this.#session.commit(this.#transaction, project); this.#transaction = null; this.#before = null;
    }
    rollback(): Project | null {
        if (!this.#transaction) return null;
        this.#session.rollback(this.#transaction); const before = this.#before;
        this.restoredView = this.#session.view(); this.#transaction = null; this.#before = null; return before;
    }
    undo(_project: Project) { this.rememberView(); if (!this.#session.undo()) return null; this.restoredView = this.#session.view(); return this.project(); }
    redo(_project: Project) { this.rememberView(); if (!this.#session.redo()) return null; this.restoredView = this.#session.view(); return this.project(); }
    replace(document: SceneDocument, context: SceneContext, label: string, resetViews = false) {
        this.rememberView(); this.#session.replace(document, context, label, resetViews); this.restoredView = this.#session.view(); return this.project();
    }
    /** Initial recovery and the development fixture hook start a fresh session, not a user edit. */
    reset(input: unknown) {
        if (this.pending) throw Error('请先完成当前编辑');
        this.#session = new SceneSession(readSceneDocument(input)); this.restoredView = this.#session.view(); return this.project();
    }
}
