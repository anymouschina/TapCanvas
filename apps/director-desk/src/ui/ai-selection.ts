import type { AppContext } from '../app-context.ts';
import { editorSelection } from '../editor/timeline-selection.ts';

/** Explicit UI intent; the task host reads the shared live selection once at task start. */
export function mountAISelection(ctx: AppContext, panel: HTMLElement, open: (value: boolean) => void) {
    const row = document.createElement('div'); row.className = 'ai-scope-row';
    row.innerHTML = '<span id="ai-scope-summary">范围：当前戏段</span><button id="ai-scope-toggle" type="button" aria-pressed="false">使用选中范围</button>';
    panel.querySelector('#ai-prompt')!.before(row);
    const button = row.querySelector<HTMLButtonElement>('button')!, summary = row.querySelector('span')!;
    let enabled = false, pending = false, sceneId: string | undefined;
    const sceneKey = () => JSON.stringify([ctx.scenes?.context.sessionId, ctx.scenes?.context.sceneId]);
    const refresh = () => {
        if(pending)return;
        if (enabled && sceneId !== sceneKey()) enabled = false;
        const scope = editorSelection(ctx.project, ctx.selected);
        const range = scope.timeRange ? `${scope.timeRange.start.toFixed(2)}–${scope.timeRange.end.toFixed(2)} 秒` : '';
        summary.textContent = enabled ? '仅调整：' + [scope.objects.slice(0,3).map(o => o.name).join('、') + (scope.objects.length>3 ? `等 ${scope.objects.length} 个对象` : ''), scope.clips.length ? `${scope.clips.length} 个片段` : '', range].filter(Boolean).join(' · ') : '范围：当前戏段';
        button.textContent = enabled ? '取消范围' : '使用选中范围'; button.setAttribute('aria-pressed', String(enabled));
    };
    const activate = () => { if(pending)return;enabled = true; sceneId = sceneKey(); refresh(); };
    button.onclick = () => { if (enabled) { enabled = false; refresh(); } else activate(); };
    document.querySelector('#timeline-content')!.addEventListener('editor-selection-change', refresh);
    document.querySelector('#timeline-to-ai')!.addEventListener('click', () => {
        activate(); open(true); panel.querySelector<HTMLButtonElement>('#ai-chat-toggle')!.click();
        panel.querySelector<HTMLTextAreaElement>('#ai-prompt')!.focus();
    });
    return { useSelection() { refresh(); pending=true;button.disabled=true;return enabled; }, endTask() { pending=false;button.disabled=false;refresh(); } };
}
