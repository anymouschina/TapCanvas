import type { AppContext } from '../app-context.ts';
import { uid, type Entity } from '../model.ts';
import { button, escape, options } from './common.ts';
import './native-animation-editor.css';

export function createNativeAnimationEditor(ctx: AppContext, refresh: () => void) {
    const content = document.querySelector<HTMLElement>('#inspector-content')!;
    let sourceIndex = 0, selected = '', parameter = 'speed';
    const infoFor = (e: Entity) => ctx.engine.externalModels.inspection(ctx.project.resources!.find(r => r.id === e.external!.resourceId)!);
    content.addEventListener('change', event => {
        const input = event.target as HTMLInputElement | HTMLSelectElement;
        if (!input.closest('.native-editor')) return;
        event.stopPropagation(); const e = ctx.current(); if (!e?.external) return;
        if (input.id === 'native-source') { sourceIndex = Number(input.value); return; }
        if (input.id === 'native-clip') { selected = input.value; refresh(); return; }
        if (input.id === 'native-parameter') { parameter = input.value; refresh(); return; }
        if (e.locked || input.id !== 'native-value') return;
        ctx.change(() => {
            const clip = e.clips.find(c => c.id === selected); if (!clip?.native) throw Error('请先选择原生动画片段');
            if (parameter === 'loop') clip.native.loop = input.value === 'true';
            else if (parameter === 'motion') {
                if (input.value === 'source') delete clip.native.motion;
                else {
                    const info = infoFor(e), node = e.external!.rig?.bones.hips ?? info.rigSuggestion.rig.bones.hips ?? info.nodes.find(n => n.positionAnimated)?.path ?? '0';
                    clip.native.motion = { mode: 'inPlace', node };
                }
            } else if (parameter === 'motionNode' && clip.native.motion) clip.native.motion.node = input.value;
            else if (parameter === 'start' || parameter === 'end' || parameter === 'speed' || parameter === 'offset') clip[parameter] = Number(input.value);
            ctx.extendDuration();
        }, false);
    });
    content.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-native-action]');
        if (!button) return; event.stopPropagation(); const e = ctx.current();
        if (!e?.external || e.locked || ctx.busy || ctx.draft || ctx.history.pending) return;
        ctx.change(() => {
            if (button.dataset.nativeAction === 'remove') { e.clips = e.clips.filter(c => c.id !== selected); return; }
            const source = infoFor(e).animations.find(a => a.index === sourceIndex);
            if (!source || source.duration <= 0 || !source.tracks) throw Error('此动画没有可播放内容');
            const duration = Math.max(1, Math.ceil(source.duration * ctx.project.fps)) / ctx.project.fps;
            let start = Math.max(0, Math.round(ctx.time * ctx.project.fps) / ctx.project.fps);
            for (const clip of [...e.clips].sort((a, b) => a.start - b.start)) {
                if (start + duration <= clip.start) break;
                if (start < clip.end) start = Math.ceil(clip.end * ctx.project.fps) / ctx.project.fps;
            }
            selected = uid(); e.clips.push({ id: selected, action: 'native', native: { index: source.index, loop: false }, start, end: start + duration, speed: 1 });
            e.clips.sort((a, b) => a.start - b.start); ctx.extendDuration();
        }, false);
    });
    return { render(e: Entity) {
        const info = infoFor(e), sources = info.animations.filter(a => Number.isFinite(a.duration) && a.duration > 0 && a.tracks > 0), clips = e.clips.filter(c => c.native);
        if (!sources.some(a => a.index === sourceIndex)) sourceIndex = sources[0]?.index ?? 0;
        if (!clips.some(c => c.id === selected)) selected = clips[0]?.id ?? '';
        const clip = clips.find(c => c.id === selected);
        const choose = (id: string, label: string, list: [string, string][], value: string) => `<select id="${id}" ${id === 'native-value' && (!clip || (parameter === 'motionNode' && !clip.native!.motion)) ? 'disabled' : ''} aria-label="${label}" title="${escape(list.find(([key]) => key === value)?.[1] ?? label)}">${options(list, value)}</select>`;
        const parameters: [string, string][] = [['speed', '播放速度'], ['start', '开始 / 秒'], ['end', '结束 / 秒'], ['offset', '素材起点 / 秒'], ['loop', '素材循环'], ['motion', '水平走位'], ['motionNode', '走位参考点']];
        const value = parameter === 'motion' ? choose('native-value', '水平走位控制', [['source', '保留素材位移'], ['inPlace', '路径控制 · 锁定参考点']], clip?.native?.motion?.mode ?? 'source')
            : parameter === 'motionNode' ? choose('native-value', '走位参考点', clip?.native?.motion ? info.nodes.map(n => [n.path, `${n.name || n.kind} · ${n.path}${n.positionAnimated ? ' · 含位置轨道' : ''}`]) : [['', '先开启路径控制']], clip?.native?.motion?.node ?? '')
            : parameter === 'loop' ? choose('native-value', '素材循环', [['false', '播放一次 · 末帧停留'], ['true', '循环播放']], String(clip?.native?.loop ?? false))
            : `<input id="native-value" type="number" aria-label="${parameters.find(([key]) => key === parameter)?.[1]}" min="${parameter === 'speed' ? '.01' : '0'}" step="${parameter === 'speed' ? '.1' : 1 / ctx.project.fps}" value="${clip?.[parameter as 'speed' | 'start' | 'end' | 'offset'] ?? 0}" ${clip ? '' : 'disabled'}/>`;
        return (info.bones.length ? button('user-motion-from-model', '收藏模型动作', '', 'wide subtle') : '') + `<div class="native-editor" title="水平走位可保留素材位移，或锁定参考点的水平位移并由路径调度。路径控制保留上下起伏与源旋转；参考点优先选运动根节点；选骨盆也会锁定其左右摆动。片段外恢复默认姿态，片段衔接尚无平滑过渡。"><div class="native-row">${choose('native-source', '模型自带动画', sources.map(a => [String(a.index), `${a.name} · ${a.duration.toFixed(2)} 秒`]), String(sourceIndex))}<button class="subtle" data-native-action="add" ${sources.length ? '' : 'disabled'} title="添加到播放头后的可用时段">添加</button></div><div class="native-row">${choose('native-clip', '已排动画片段', clips.length ? clips.map(c => [c.id, `${sources.find(a => a.index === c.native!.index)?.name ?? '原生动画'} · ${c.start.toFixed(2)}—${c.end.toFixed(2)} 秒`]) : [['', '尚未添加动画']], selected)}<button class="subtle" data-native-action="remove" ${clip ? '' : 'disabled'}>移除</button></div><div class="native-values">${choose('native-parameter', '调整动画参数', parameters, parameter)}${value}</div></div>`;
    } };
}
