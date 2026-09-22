import type { Action } from '../model.ts';
import type { ActionPreview } from '../animation/action-preview.ts';
import { escape } from './common.ts';

export const actionPickerMarkup = (actions: [string,string][]) => `<button type="button" id="action-picker-toggle" class="wide" aria-expanded="false" aria-haspopup="dialog">选择动作… <span>⌄</span></button><div id="action-picker" popover="auto" role="dialog" aria-label="添加动作"><div class="action-picker-options">${actions.map(([id,name])=>`<button type="button" data-add-action="${id}">${escape(name)}</button>`).join('')}</div><div class="action-picker-preview"><div class="action-preview-canvas"></div><span id="action-preview-name">悬停预览动作</span></div></div>`;

export function bindActionPicker() {
    const trigger = document.querySelector<HTMLButtonElement>('#action-picker-toggle'), popup = document.querySelector<HTMLElement>('#action-picker');
    if (!trigger || !popup) return () => {};
    let preview: ActionPreview | undefined, generation = 0, selected: HTMLButtonElement | undefined;
    const stop = () => { generation++; preview?.dispose(); preview = undefined; };
    const choose = async (button: HTMLButtonElement) => {
        selected = button;
        popup.querySelector('#action-preview-name')!.textContent = button.textContent;
        const current = ++generation;
        try {
            if (!preview) {
                const { ActionPreview } = await import('../animation/action-preview.ts');
                if (current !== generation || !popup.isConnected || !popup.matches(':popover-open')) return;
                preview = new ActionPreview(popup.querySelector<HTMLElement>('.action-preview-canvas')!);
            }
            preview.set(button.dataset.addAction as Action);
        } catch { popup.querySelector('#action-preview-name')!.textContent = '预览暂不可用，仍可添加动作'; }
    };
    const place = () => {
        if (!popup.matches(':popover-open')) return;
        const rect = trigger.getBoundingClientRect();
        popup.style.left = Math.max(8,Math.min(rect.left,innerWidth-popup.offsetWidth-8))+'px';
        popup.style.top = Math.max(8,Math.min(rect.bottom+4,innerHeight-popup.offsetHeight-8))+'px';
    };
    trigger.onclick = () => { popup.togglePopover(); place(); };
    trigger.addEventListener('keydown', event => {
        if (event.key !== 'ArrowDown') return; event.preventDefault();
        popup.showPopover(); place(); popup.querySelector<HTMLButtonElement>('[data-add-action]')?.focus();
    });
    popup.addEventListener('toggle', () => {
        const open = popup.matches(':popover-open'); trigger.setAttribute('aria-expanded',String(open));
        if (open) { place(); void choose(popup.querySelector<HTMLButtonElement>('[data-add-action]')!); }
        else stop();
    });
    const hover = (event: Event) => { const b = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-add-action]'); if (b && b !== selected) void choose(b); };
    popup.addEventListener('pointerover',hover); popup.addEventListener('focusin',hover);
    popup.addEventListener('click', event => { if ((event.target as HTMLElement).closest('[data-add-action]')) { popup.hidePopover(); stop(); } });
    popup.addEventListener('keydown', event => {
        if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
        event.preventDefault(); const buttons = [...popup.querySelectorAll<HTMLButtonElement>('[data-add-action]')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        buttons[(index+(event.key === 'ArrowDown' ? 1 : -1)+buttons.length)%buttons.length]?.focus();
    });
    window.addEventListener('resize',place);
    return () => { stop(); window.removeEventListener('resize',place); };
}
