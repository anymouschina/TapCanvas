import type { AppContext } from '../app-context.ts';
import { clipLabel, uid, type Entity } from '../model.ts';
import { isBasicHumanAction } from '../animation/basic-human-motion.ts';
import { canRetarget, type RetargetAnimation } from '../resources/retarget-animation.ts';
import { rigStatus } from '../resources/rig-definition.ts';
import { button, escape, options } from './common.ts';
import './native-animation-editor.css';
import { BUILTIN_MOTION_RESOURCE_ID, motionPresets } from '../animation/motion-catalog.ts';
import { applyOperationsWithResources } from '../automation/edits.ts';
import { setPathLocomotion } from '../animation/locomotion.ts';
import { builtinFootPlant } from '../animation/motion-catalog.ts';
import { applyStrideEstimate } from '../animation/stride-fit.ts';

export function createRetargetAnimationEditor(ctx: AppContext, refresh: () => void) {
    const content = document.querySelector<HTMLElement>('#inspector-content')!;
    let chosen = '', selected = '', parameter = 'speed';
    const infoFor = (id: string) => ctx.engine.externalModels.inspection(ctx.project.resources!.find(r => r.id === id)!);
    function choices() {
        const result: { id: string; label: string; duration: number; data?: RetargetAnimation; presetId?: string }[] = motionPresets().map(p => ({ id: p.id, label: `${p.basicAction ? '基础' : '内置'} / ${p.name}`, duration: p.defaultDuration, presetId: p.id }));
        for (const resource of ctx.project.resources ?? []) {
            if (resource.id === BUILTIN_MOTION_RESOURCE_ID) continue;
            const info = infoFor(resource.id), actors = ctx.project.entities.filter(e => e.external?.resourceId === resource.id && rigStatus(e.external.rig).complete);
            const variants = actors.length ? actors.map(e => ({ id: e.id, name: e.name, data: e.external! }))
                : info.rigSuggestion.complete ? [{ id: resource.id, name: resource.name, data: { unitScale: 1, orientation: [0, 0, 0] as [number, number, number], rig: info.rigSuggestion.rig, defaultPose: undefined } }] : [];
            for (const variant of variants) for (const animation of info.animations) if (animation.duration > 0 && animation.tracks > 0) {
                result.push({ id: `${variant.id}:${animation.index}`, label: `${variant.name} / ${animation.name}`, duration: animation.duration,
                    data: { resourceId: resource.id, index: animation.index, loop: false, unitScale: variant.data.unitScale, orientation: variant.data.orientation,
                        rig: variant.data.rig!, ...(variant.data.defaultPose ? { referencePose: variant.data.defaultPose } : {}) } });
            }
        }
        return result;
    }
    async function addPreset(entityId: string, presetId: string, time: number) {
        const original = ctx.project, checkpoint = JSON.stringify(original);
        ctx.busy = true; ctx.playing = false; ctx.updateTimeUI();
        try {
            const after = await applyOperationsWithResources(original, [{ operation: 'motion', id: entityId, asset: presetId, time }]);
            await ctx.engine.externalModels.prepare(after);
            if (ctx.project !== original || JSON.stringify(ctx.project) !== checkpoint || ctx.draft || ctx.history.pending) throw Error('准备动作期间工程已变化，请重新添加');
            ctx.busy = false;
            const previous = new Set(original.entities.find(e => e.id === entityId)!.clips.map(c => c.id));
            selected = after.entities.find(e => e.id === entityId)!.clips.find(c => !previous.has(c.id))!.id;
            ctx.change(() => { ctx.project = after; });
        } catch (error) { ctx.toast((error as Error).message, true); }
        finally { ctx.busy = false; ctx.engine.externalModels.retain([ctx.project, ...ctx.history.undoStack, ...ctx.history.redoStack]); ctx.updateTimeUI(); }
    }
    content.addEventListener('change', event => {
        const input = event.target as HTMLInputElement | HTMLSelectElement;
        if (!input.closest('.retarget-editor')) return;
        event.stopPropagation(); const e = ctx.current(); if (!e) return;
        if (input.id === 'retarget-source') { chosen = input.value; return; }
        if (input.id === 'retarget-clip') { selected = input.value; refresh(); return; }
        if (input.id === 'retarget-parameter') { parameter = input.value; refresh(); return; }
        if (e.locked || input.id !== 'retarget-value') return;
        ctx.change(() => {
            const clip = e.clips.find(c => c.id === selected); if (!clip) throw Error('请先选择动作片段');
            if (!clip.retarget) {
                if (parameter === 'blend') e.actionBlend = Number(input.value);
                else if (parameter === 'start' || parameter === 'end' || parameter === 'speed' || parameter === 'offset') clip[parameter] = Number(input.value);
                ctx.extendDuration(); return;
            }
            const duration = infoFor(clip.retarget.resourceId).animations.find(a => a.index === clip.retarget!.index)!.duration;
            if (parameter === 'blend') { clip.retarget.blend = Number(input.value); return; }
            if (parameter === 'footPlant') {
                if (input.value === 'off') delete clip.retarget.footPlant;
                else {
                    const profile = builtinFootPlant(clip); if (!profile) throw Error('此素材尚无内置落脚区间，请先校准');
                    clip.retarget.footPlant ??= profile; clip.retarget.loop = true;
                    clip.retarget.motion ??= { mode: 'inPlace', node: clip.retarget.rig.bones.hips! };
                    clip.retarget.grounding ??= { mode: 'preventPenetration', maxCorrection: .2 };
                }
                return;
            }
            if (parameter === 'plantCorrection' && clip.retarget.footPlant) { clip.retarget.footPlant.maxCorrection = Number(input.value); return; }
            if (parameter === 'locomotion') setPathLocomotion(e, clip, duration, input.value === 'distance' ? clip.retarget.locomotion?.cycleDistance ?? Math.max(.01, e.height * .7) : undefined);
            else if (parameter === 'grounding') {
                if (input.value === 'off') { delete clip.retarget.grounding; delete clip.retarget.footPlant; }
                else clip.retarget.grounding ??= { mode: 'preventPenetration', maxCorrection: .2 };
            } else if (parameter === 'maxCorrection' && clip.retarget.grounding) clip.retarget.grounding.maxCorrection = Number(input.value);
            else if (parameter === 'maxPelvisLift' && clip.retarget.grounding) clip.retarget.grounding.maxPelvisLift = Number(input.value);
            else if (parameter === 'cycleDistance' && clip.retarget.locomotion) clip.retarget.locomotion.cycleDistance = Number(input.value);
            else if (parameter === 'loop') {
                if (input.value !== 'true' && clip.retarget.locomotion) setPathLocomotion(e, clip, duration);
                clip.retarget.loop = input.value === 'true';
                if (!clip.retarget.loop) delete clip.retarget.footPlant;
            }
            else if (parameter === 'motion') {
                if (input.value === 'source') { if (clip.retarget.locomotion) setPathLocomotion(e, clip, duration); delete clip.retarget.motion; delete clip.retarget.footPlant; }
                else clip.retarget.motion = { mode: 'inPlace', node: clip.retarget.rig.bones.hips! };
            } else if (parameter === 'motionNode' && clip.retarget.motion) clip.retarget.motion.node = input.value;
            else if (parameter === 'start' || parameter === 'end' || parameter === 'speed' || parameter === 'offset') clip[parameter] = Number(input.value);
            ctx.extendDuration();
        });
    });
    content.addEventListener('click', event => {
        const button = (event.target as HTMLElement).closest<HTMLElement>('[data-retarget-action]');
        if (!button) return; event.stopPropagation(); const e = ctx.current();
        if (!e || e.locked || ctx.busy || ctx.draft || ctx.history.pending) return;
        const choice = choices().find(c => c.id === chosen);
        if (button.dataset.retargetAction === 'calibrate') {
            try {
                const clip = e.clips.find(c => c.id === selected); if (!clip) throw Error('请先选择适配动作');
                const estimate = ctx.engine.externalModels.estimateStride(e, clip.id);
                if (ctx.change(() => applyStrideEstimate(e, clip, estimate))) ctx.toast(`每周期 ${estimate.cycleDistance!.toFixed(3)} 米，步频倍率已设为 1。${estimate.reasons.join('；')}${estimate.crowd ? '；群演以中等体型成员估算。' : ''}`);
            } catch (error) { ctx.toast((error as Error).message, true); }
            return;
        }
        if (button.dataset.retargetAction === 'add' && choice?.presetId) { void addPreset(e.id, choice.presetId, ctx.time); return; }
        ctx.change(() => {
            if (button.dataset.retargetAction === 'remove') { e.clips = e.clips.filter(c => c.id !== selected); return; }
            const source = choices().find(c => c.id === chosen); if (!source?.data) throw Error('请选择内置动作或带完整人形骨架的动作素材');
            const duration = Math.max(1, Math.ceil(source.duration * ctx.project.fps)) / ctx.project.fps;
            let start = Math.max(0, Math.round(ctx.time * ctx.project.fps) / ctx.project.fps);
            for (const clip of [...e.clips].sort((a, b) => a.start - b.start)) {
                if (start + duration <= clip.start) break;
                if (start < clip.end) start = Math.ceil(clip.end * ctx.project.fps) / ctx.project.fps;
            }
            selected = uid(); e.clips.push({ id: selected, action: 'retarget', retarget: structuredClone(source.data), start, end: start + duration, speed: 1 });
            e.clips.sort((a, b) => a.start - b.start); ctx.extendDuration();
        });
    });
    return { render(e: Entity) {
        if (!canRetarget(e)) return '<p class="panel-help">先在“骨架”中补齐人形映射，再使用其他模型的动作素材。</p>';
        const sources = choices(), clips = e.clips.filter(c => c.retarget || isBasicHumanAction(c.action));
        if (!sources.some(s => s.id === chosen)) chosen = sources[0]?.id ?? '';
        if (!clips.some(c => c.id === selected)) selected = clips[0]?.id ?? '';
        const clip = clips.find(c => c.id === selected), data = clip?.retarget, info = data ? infoFor(data.resourceId) : null;
        const plantProfile = clip ? builtinFootPlant(clip) : undefined;
        const choose = (id: string, label: string, list: [string, string][], value: string, disabled = false) => `<select id="${id}" aria-label="${label}" title="${escape(list.find(([key]) => key === value)?.[1] ?? label)}" ${disabled ? 'disabled' : ''}>${options(list, value)}</select>`;
        const parameters: [string, string][] = [['speed', data?.locomotion ? '步频倍率' : '播放速度'], ['start', '开始 / 秒'], ['end', '结束 / 秒'], ['offset', '素材起点 / 秒'], ['loop', '素材循环'], ['motion', '水平走位'], ['motionNode', '走位参考点'], ['locomotion', '迈步驱动'], ['cycleDistance', '每周期距离 / 米'], ['grounding', '足部防穿透'], ['maxCorrection', '修正范围 / 米'], ['maxPelvisLift', '身体上抬 / 米'], ['footPlant', '支撑脚锁定'], ['plantCorrection', '锁脚范围 / 米'], ['blend', '衔接 / 秒']];
        if (clip && !data) parameters.splice(0, parameters.length, ['speed', '播放速度'], ['start', '开始 / 秒'], ['end', '结束 / 秒'], ['offset', '动作起点 / 秒'], ...(e.external ? [['blend', '基础衔接 / 秒'] as [string, string]] : []));
        if (!parameters.some(([key]) => key === parameter)) parameter = 'speed';
        const value = parameter === 'loop' ? choose('retarget-value', '素材循环', [['false', '播放一次 · 末帧停留'], ['true', '循环播放']], String(data?.loop ?? false), !clip)
            : parameter === 'motion' ? choose('retarget-value', '水平走位控制', [['source', '保留素材位移'], ['inPlace', '路径控制 · 锁定参考点']], data?.motion?.mode ?? 'source', !clip)
            : parameter === 'motionNode' ? choose('retarget-value', '走位参考点', info?.nodes.map(n => [n.path, `${n.name || n.kind} · ${n.path}`]) ?? [['', '先添加动作']], data?.motion?.node ?? '', !data?.motion)
            : parameter === 'locomotion' ? choose('retarget-value', '迈步驱动', [['time', '按时间播放'], ['distance', '按路程迈步 · 停留时定格']], data?.locomotion?.mode ?? 'time', !clip)
            : parameter === 'cycleDistance' ? `<input id="retarget-value" type="number" aria-label="每周期距离 / 米" title="左右脚完整一周期的场景路程；初值按身高估算，需按素材和人物校准。步频倍率 1 时采用此距离。" min=".01" max="1000" step=".05" value="${(data?.locomotion?.cycleDistance ?? 1).toFixed(3)}" ${data?.locomotion ? '' : 'disabled'}/>`
            : parameter === 'grounding' ? choose('retarget-value', '足部防穿透', [['off', '关闭'], ['preventPenetration', '开启 · 上抬修正']], data?.grounding?.mode ?? 'off', !clip)
            : parameter === 'maxCorrection' ? `<input id="retarget-value" type="number" aria-label="修正范围 / 米" title="只在此范围内寻找承托面并上抬脚；不锁定脚底，不把抬起的脚压到地上。" min=".001" max="2" step=".01" value="${data?.grounding?.maxCorrection ?? .2}" ${data?.grounding ? '' : 'disabled'}/>`
            : parameter === 'maxPelvisLift' ? `<input id="retarget-value" type="number" aria-label="身体上抬 / 米" title="允许身体先承担的上抬额度，减少额外屈膝；剩余穿透再由双腿修正。0 关闭，不改写人物根站位或路径。" min="0" max="2" step=".01" value="${data?.grounding?.maxPelvisLift ?? 0}" ${data?.grounding ? '' : 'disabled'}/>`
            : parameter === 'footPlant' ? choose('retarget-value', '支撑脚锁定', [['off', '关闭'], ['stance', plantProfile || data?.footPlant ? '按落脚区间锁定' : '此素材需先校准落脚区间']], data?.footPlant?.mode ?? 'off', !plantProfile && !data?.footPlant)
            : parameter === 'plantCorrection' ? `<input id="retarget-value" type="number" aria-label="锁脚范围 / 米" title="最大水平修正量；腿长不足会报告受限，不拉长肢体。" min=".001" max="2" step=".01" value="${data?.footPlant?.maxCorrection ?? .25}" ${data?.footPlant ? '' : 'disabled'}/>`
            : parameter === 'blend' ? `<input id="retarget-value" type="number" aria-label="衔接 / 秒" title="0 关闭；开始后从上一姿态过渡，结束后向待机或下一动作过渡。下一素材的衔接设置优先；不改动片段或路径时长。" min="0" max="2" step=".05" value="${data ? data.blend ?? 0 : e.actionBlend ?? .2}" ${clip ? '' : 'disabled'}/>`
            : `<input id="retarget-value" type="number" aria-label="${parameters.find(([key]) => key === parameter)?.[1]}" min="${parameter === 'speed' ? '.01' : '0'}" step="${parameter === 'speed' ? '.1' : 1 / ctx.project.fps}" value="${clip?.[parameter as 'speed' | 'start' | 'end' | 'offset'] ?? 0}" ${clip ? '' : 'disabled'}/>`;
        const field = parameter === 'cycleDistance' ? `<div class="retarget-stride">${value}<button class="subtle" data-retarget-action="calibrate" aria-label="按动作校准步幅" title="按当前骨架和素材落脚位移估算完整周期；启用按路程迈步并将步频倍率设为 1，可继续手调。" ${plantProfile || data?.footPlant ? '' : 'disabled'}>校准</button></div>` : value;
        return button('user-motion-library', '用户动作库 / 导入动作', '', 'wide subtle') + `<div class="retarget-editor" title="从工程模型选择动作，按当前人物骨长适配。来源映射和校正会独立保存；修改来源人物不会联动本片段。路径控制保留源旋转和上下起伏；片段外恢复原动作规则；衔接可混合相邻素材、原生动画与基础动作姿态。足部防穿透向上修正；支撑脚锁定按校准区间约束水平接触点，腿长不足时仍需调整路线和步幅。"><div class="native-row">${choose('retarget-source', '动作素材来源', sources.length ? sources.map(s => [s.id, s.label]) : [['', '先导入带骨架和动画的模型']], chosen)}<button class="subtle" data-retarget-action="add" ${sources.length ? '' : 'disabled'}>添加</button></div><div class="native-row">${choose('retarget-clip', '已排适配动作', clips.length ? clips.map(c => [c.id, `${clipLabel(c)} · ${c.start.toFixed(2)}—${c.end.toFixed(2)} 秒`]) : [['', '尚未添加适配动作']], selected)}<button class="subtle" data-retarget-action="remove" ${clip ? '' : 'disabled'}>移除</button></div><div class="native-values">${choose('retarget-parameter', '调整素材参数', parameters, parameter)}${field}</div></div>`;
    } };
}
