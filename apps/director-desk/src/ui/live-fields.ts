import type { AppContext } from '../app-context.ts';
import { assertProject } from '../model.ts';
import { assertLockedEntitiesUnchanged } from '../editor/invariants.ts';
import { syncFloorElevations } from '../building/floors.ts';
import { syncStructureLinks } from '../building/structure-links.ts';

/** Keep the input mounted while previewing; commit one history entry on completion. */
export function bindLiveFields(ctx: AppContext, mutate: (key: string, value: string) => void) {
    let input: HTMLInputElement | undefined;
    const completed = new WeakSet<EventTarget>();
    const finish = (cancel = false) => {
        if (!input) return;
        const edited = input; input = undefined;completed.add(edited);
        try {
            if (cancel || !edited.value || !edited.checkValidity()) throw Error('输入已取消');
            assertLockedEntitiesUnchanged(ctx.history.pending!, ctx.project);
            assertProject(ctx.project);ctx.engine.externalModels.assertReady(ctx.project);
            ctx.history.commit(ctx.project);ctx.changed(false);
        } catch (error) {
            ctx.project = ctx.history.rollback() ?? ctx.project;
            ctx.engine.project=ctx.project;ctx.engine.sample(ctx.time);ctx.engine.refreshHelpers();ctx.renderPanels();
            if (!cancel) ctx.toast((error as Error).message, true);
        }
    };
    document.addEventListener('input', event => {
        const target=event.target;
        if (!(target instanceof HTMLInputElement) || !target.closest('#inspector-content') || target.type!=='number') return;
        const key=target.dataset.field;
        if (!key || !/^(pos\.|rot\.|scale\.|target\.|offset\.|handOffset\.|handRotation\.|camera\.(focal|targetHeight)$|height$)/.test(key)) return;
        if(key==='height' && ctx.current()?.kind==='crowd')return;
        completed.delete(target);
        if(ctx.busy || ctx.draft || ctx.current()?.locked || !target.value || !target.checkValidity())return;
        if(input && input!==target)finish();
        if(!input){if(ctx.history.pending)return;ctx.playing=false;ctx.history.begin(ctx.project);input=target;}
        try {
            mutate(key,target.value);
            syncFloorElevations(ctx.project,ctx.history.pending!);syncStructureLinks(ctx.project,ctx.history.pending!);
            ctx.engine.project=ctx.project;ctx.engine.sample(ctx.time);ctx.engine.refreshHelpers();
        } catch {finish(true);}
    },true);
    document.addEventListener('change',event=>{if(event.target===input){event.stopImmediatePropagation();finish();}else if(event.target && completed.has(event.target))event.stopImmediatePropagation();},true);
    document.addEventListener('focusout',event=>{if(event.target===input)finish();},true);
    document.addEventListener('keydown',event=>{if(!input)return;if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finish(true);}else if(event.key==='Enter'){event.preventDefault();finish();}},true);
    window.addEventListener('blur',()=>finish());
}
