import type { AppContext } from '../app-context.ts';
import { normalizedColor, setEntityColor } from '../editor/entity-color.ts';
import { $, escape, options } from './common.ts';
import './color-palette.css';

const swatches = [
    ['雪白', '#ffffff'], ['浅灰', '#d5d5d0'], ['灰色', '#929292'], ['深灰', '#505050'], ['墨黑', '#202020'], ['暖白', '#eee5d5'],
    ['浅红', '#f3adad'], ['红色', '#d95656'], ['暗红', '#853b43'], ['浅橙', '#f6ceab'], ['橙色', '#e99c51'], ['棕色', '#8e6249'],
    ['浅黄', '#f4e8a2'], ['黄色', '#e6c755'], ['橄榄', '#99964c'], ['浅绿', '#b8dba6'], ['绿色', '#78ae78'], ['深绿', '#3e705b'],
    ['浅青', '#a5ded7'], ['青色', '#57aaa3'], ['深青', '#386e7e'], ['浅蓝', '#b2cee9'], ['蓝色', '#78a6d4'], ['深蓝', '#465c91'],
    ['浅紫', '#d4c1e7'], ['紫色', '#9b7fbd'], ['深紫', '#695180'], ['浅粉', '#ecc6d8'], ['粉色', '#ca89ae'], ['玫红', '#995573'],
];

export function createColorPalette(ctx: AppContext) {
    let owner = '';
    const key = () => `${ctx.scenes.context.sessionId}:${ctx.scenes.context.sceneId}:${ctx.selected}`;
    function render() {
        if (owner !== key()) { owner = ''; return; }
        const entity = ctx.current(); if (!entity || entity.locked) { owner = ''; return; }
        const host = document.createElement('div'); host.className = 'inline-color-palette';
        host.innerHTML = `<div class="color-swatches" role="group" aria-label="常用色板">${swatches.map(([name,value])=>`<button type="button" data-swatch="${value}" style="--swatch:${value}" title="${name}" aria-label="${name} ${value}" aria-pressed="${value === entity.color}"></button>`).join('')}</div>
          <div class="color-custom"><label class="field"><span>自定义颜色</span><input id="palette-picker" type="color" value="${entity.color}"/></label><label class="field"><span>HEX 色值</span><input id="palette-hex" value="${escape(entity.color)}" maxlength="7" spellcheck="false"/></label></div>
          ${entity.external ? `<label class="field"><span>模型材质</span><select id="palette-appearance">${options([['color','统一着色'],['original','原材质'],['white','白模']],entity.external.appearance)}</select></label>` : ''}
          <p id="palette-feedback" class="color-feedback" aria-live="polite">选择即生效，可撤销</p>`;
        $('#inspector-header').append(host);
        const commit = (color: string, appearance = 'color') => {
            if (ctx.busy || ctx.history.pending || ctx.draft || ctx.engine.exporting || owner !== key() || ctx.current()?.locked) return;
            try { const value = normalizedColor(color); ctx.change(()=>setEntityColor(ctx.current()!,value,appearance as 'color'|'original'|'white')); }
            catch (error) { host.querySelector('#palette-feedback')!.textContent = (error as Error).message; }
        };
        host.addEventListener('click', event => {
            event.stopPropagation();
            const color = (event.target as HTMLElement).closest<HTMLElement>('[data-swatch]')?.dataset.swatch;
            if (color) commit(color);
        });
        host.addEventListener('change', event => {
            event.stopPropagation(); const input = event.target as HTMLInputElement;
            if (input.id === 'palette-appearance') commit(entity.color,input.value);
            else if (input.id === 'palette-picker' || input.id === 'palette-hex') commit(input.value);
        });
        host.addEventListener('keydown', event => {
            if (event.key === 'Escape') { event.stopPropagation(); owner = ''; ctx.renderInspector(); }
            if (event.key === 'Enter' && (event.target as HTMLElement).id === 'palette-hex') { event.preventDefault(); commit((event.target as HTMLInputElement).value); }
        });
    }
    return { render, handle(action: string) {
        if (action !== 'color-open') return false;
        owner = owner === key() ? '' : key(); ctx.renderInspector(); return true;
    } };
}
