import { escape } from './common.ts';
import type { ExportScene, ExportSelection } from '../exporting/plan.ts';

/** Paged rows keep file naming usable without a scrollable operation panel. */
export function createExportScenePicker(scenes: ExportScene[], currentId: string, onChange: () => void) {
    const names = new Map(scenes.map(scene => [scene.id, scene.name]));
    const selected = new Set([currentId]);
    const pageSize = window.innerHeight < 720 ? 2 : 3;
    let page = Math.max(0, Math.floor(scenes.findIndex(scene => scene.id === currentId) / pageSize));
    let host: HTMLElement;
    function render() {
        host.innerHTML = `<div class="export-scene-toolbar"><strong>已选 ${selected.size} / ${scenes.length} 场</strong><button type="button" data-pick="all">全选</button><button type="button" data-pick="none">清空</button></div>
            <div class="export-scene-rows">${scenes.slice(page * pageSize, (page + 1) * pageSize).map(scene => `<div class="export-scene-row">
                <label class="export-scene-check"><input type="checkbox" data-scene-check="${escape(scene.id)}" ${selected.has(scene.id) ? 'checked' : ''}/><span title="${escape(scene.name)}">${escape(scene.name)}</span><small>${scene.duration}s · ${scene.aspect}</small></label>
                <input data-scene-name="${escape(scene.id)}" aria-label="${escape(scene.name)}的输出文件名" maxlength="100" value="${escape(names.get(scene.id)!)}" placeholder="输出文件名（不含扩展名）"/>
            </div>`).join('')}</div>
            <div class="export-scene-pages"><button type="button" data-pick="prev" ${page === 0 ? 'disabled' : ''}>上一页</button><span>${page + 1} / ${Math.ceil(scenes.length / pageSize)}</span><button type="button" data-pick="next" ${(page + 1) * pageSize >= scenes.length ? 'disabled' : ''}>下一页</button></div>`;
    }
    return {
        mount(element: HTMLElement) {
            host = element; render();
            host.addEventListener('click', event => {
                const action = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-pick]');
                if (!action || action.disabled) return;
                if (action.dataset.pick === 'all') scenes.forEach(scene => selected.add(scene.id));
                if (action.dataset.pick === 'none') selected.clear();
                if (action.dataset.pick === 'prev') page--;
                if (action.dataset.pick === 'next') page++;
                render(); onChange();
            });
            host.addEventListener('change', event => {
                const input = event.target as HTMLInputElement, id = input.dataset.sceneCheck;
                if (id) { if (input.checked) selected.add(id); else selected.delete(id); render(); onChange(); }
            });
            host.addEventListener('input', event => {
                const input = event.target as HTMLInputElement, id = input.dataset.sceneName;
                if (id) { names.set(id, input.value); onChange(); }
            });
        },
        selections(): ExportSelection[] { return scenes.filter(scene => selected.has(scene.id)).map(scene => ({ sceneId: scene.id, filename: names.get(scene.id)! })); },
        name(id: string) { return names.get(id) ?? ''; },
        rename(id: string, name: string) { names.set(id, name); },
        refresh: render,
    };
}
