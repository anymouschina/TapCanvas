import type { AppContext } from '../app-context.ts';
import { structurePorts } from '../building/structure-ports.ts';
import { disconnectStructure, staticStructure } from '../building/structure-links.ts';
import { escape, options } from './common.ts';
import './native-animation-editor.css';

export function createStructureLinkPanel(ctx: AppContext) {
    let selected = '', parentId = '', parentPort = 'out', ownPort = 'in', parameter = 'offset.0';
    function render() {
        const e = ctx.project.entities.find(e => e.id === selected); if (!e) return;
        const targets = ctx.project.entities.filter(p => p.id !== e.id && staticStructure(p));
        if (!targets.some(p => p.id === parentId)) parentId = targets[0]?.id ?? '';
        const parent = targets.find(p => p.id === parentId), from = parent ? structurePorts(parent) : [], to = structurePorts(e);
        if (!from.some(p => p.id === parentPort)) parentPort = from[0]?.id ?? '';
        if (!to.some(p => p.id === ownPort)) ownPort = to[0]?.id ?? '';
        const parameters: [string, string][] = ['offset', 'rotation'].flatMap(f => ['X', 'Y', 'Z'].map((a, i) => [`${f}.${i}`, `${f === 'offset' ? '接缝偏移' : '相对旋转'} ${a} / ${f === 'offset' ? '米' : '度'}`] as [string, string]));
        const [field, index] = parameter.split('.'), value = e.structureLink?.[field as 'offset' | 'rotation'][Number(index)] ?? 0;
        const source = ctx.project.entities.find(p => p.id === e.structureLink?.parentId);
        ctx.showModal('模块连接', `<div class="native-editor" id="structure-link-editor"><label>连接到<select id="link-parent">${options(targets.length ? targets.map(p => [p.id, p.name]) : [['', '请先添加另一个静态建筑模块']], parentId)}</select></label><div class="native-values"><label>目标接口<select id="link-parent-port">${options(from.map(p => [p.id, p.name]), parentPort)}</select></label><label>本模块接口<select id="link-own-port">${options(to.map(p => [p.id, p.name]), ownPort)}</select></label></div><div class="native-values"><select id="link-parameter" aria-label="连接调整参数">${options(parameters, parameter)}</select><input id="link-value" aria-label="连接参数值" type="number" step="${field === 'offset' ? '.01' : '5'}" value="${Number((value * (field === 'rotation' ? 180 / Math.PI : 1)).toFixed(6))}" ${e.structureLink && !e.locked ? '' : 'disabled'}/></div><p class="panel-help">${source ? `当前连接：${escape(source.name)}。` : '当前独立摆放。'}连接后接口相对贴合，改尺寸或移动上游模块会带动下游；拖动本模块可调整接缝偏移。人物路线仍需到路径面板检查高度。</p></div>`, `<button data-act="link-detach" ${e.structureLink && !e.locked ? '' : 'disabled'}>解除连接 · 保留位置</button><button data-act="link-attach" ${parent && staticStructure(e) && !e.locked ? '' : 'disabled'}>对齐并连接</button><button data-act="close-modal">关闭</button>`);
        document.querySelector('#structure-link-editor')!.addEventListener('change', event => {
            const input = event.target as HTMLInputElement | HTMLSelectElement;
            if (input.id === 'link-parent') { parentId = input.value; render(); }
            else if (input.id === 'link-parent-port') parentPort = input.value;
            else if (input.id === 'link-own-port') ownPort = input.value;
            else if (input.id === 'link-parameter') { parameter = input.value; render(); }
            else if (input.id === 'link-value' && e.structureLink && !e.locked) {
                const [field, index] = parameter.split('.'), key = field as 'offset' | 'rotation', value = Number(input.value) * (key === 'rotation' ? Math.PI / 180 : 1);
                if (e.structureLink[key][Number(index)] === value) return;
                if (!ctx.change(() => { e.structureLink![key][Number(index)] = value; }, false)) render();
            }
        });
    }
    return { handle(action: string) {
        if (!['link-open', 'link-attach', 'link-detach'].includes(action)) return false;
        if (action === 'link-open') {
            const e = ctx.current(); if (!e || !structurePorts(e).length) return true;
            selected = e.id; parentId = e.structureLink?.parentId ?? ''; parentPort = e.structureLink?.parentPort ?? 'out'; ownPort = e.structureLink?.ownPort ?? 'in'; render();
        } else {
            const e = ctx.project.entities.find(e => e.id === selected); if (!e) return true;
            ctx.change(() => {
                if (action === 'link-detach') disconnectStructure(e);
                else e.structureLink = { parentId, parentPort, ownPort, offset: [0, 0, 0], rotation: [0, 0, 0] };
            }, false); render();
        }
        return true;
    } };
}
