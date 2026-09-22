import { easingChoice, easingChoices, chosenEasing, keyEasing } from './easing-options.ts';
import { inspectorToolLayout } from './inspector-tool-layout.ts';
import type { Entity } from '../model.ts';
import type { AppContext } from '../app-context.ts';
import { CAMERA_PRESETS, applyCameraMotion } from '../cinematography/motion-presets.ts';
import { CAMERA_CHANNELS, SHAKE_PRESETS, type CameraChannel, type CameraEffects } from '../cinematography/camera-effects.ts';
import { EASINGS, numberAt, setNumberKey, type Easing } from '../animation/channels.ts';
import { options } from './common.ts';
import './camera-effects-panel.css';

export function createCameraEffectsPanel(ctx: AppContext) {
    let owner = '', channel: CameraChannel = 'focal', selectedKey = 0;
    const el = (name: string) => document.getElementById('cinema-' + name) as HTMLInputElement;
    const n = (name: string) => Number(el(name).value);
    const select = (name: string, label: string, list: [string, string][], value: string) => `<label>${label}<select id="cinema-${name}">${options(list, value)}</select></label>`;
    const input = (name: string, label: string, value: number, min: number, max: number, step = '.1') => `<label>${label}<input id="cinema-${name}" type="number" min="${min}" max="${max}" step="${step}" value="${value}"/></label>`;
    let footer = '';
    const render = () => ctx.renderInspector();
    function content(entity: Entity) {
        owner = entity.id;
        const e = ctx.project.entities.find(e => e.id === owner); if (!e?.camera) return '';
        const c = e.camera, effects = c.effects ?? {}, disabled = e.locked ? 'disabled' : '';
        let html = '';
        for (const [tab,label] of [['preset','运镜预设'],['channels','参数关键帧'],['shake','手持晃动'],['lens','镜头效果']]) {
        let body = '';
        if (tab === 'preset') body = select('preset', '运镜预设', Object.entries(CAMERA_PRESETS), 'arc-push')
            + `<div class="cinema-pair">${input('preset-start', '开始 / 秒', ctx.time, 0, 1e6)}${input('duration', '时长 / 秒', 5, .01, 1e6)}</div>`
            + `<div class="cinema-pair">${input('amplitude', '移动幅度 / m', 2, .01, 1000)}${input('angle', '转动角度 / 度', 70, -720, 720)}</div>`
            + `<div class="cinema-pair">${select('side', '方向', [['1', '向右'], ['-1', '向左']], '1')}${select('preset-ease', '速度节奏', Object.entries(EASINGS), 'smooth')}</div>`
            + '<p>路径预设替换原路径；倾斜、构图、甩镜改对应参数。生成后可继续编辑。</p>'
            + `<button data-act="cinema-generate" ${disabled}>应用预设</button>`;
        if (tab === 'channels') {
            const spec = CAMERA_CHANNELS[channel], value = effects.channels?.[channel], keys = typeof value === 'object' ? value.keys : [];
            selectedKey = Math.min(selectedKey, Math.max(0, keys.length - 1));
            const key = keys[selectedKey], time = key?.time ?? ctx.time, fallback = channel === 'focal' ? c.focal : spec.default;
            body = select('channel', '镜头参数', Object.entries(CAMERA_CHANNELS).map(([key, value]) => [key, value.label]), channel)
                + select('key', '已有关键帧', keys.length ? keys.map((k, i) => [String(i), `${i + 1} · ${k.time.toFixed(3)} 秒 · ${k.value.toFixed(3)}`]) : [['0', '恒定值 · 尚未记录关键帧']], String(selectedKey))
                + `<div class="cinema-pair">${input('time', '时间 / 秒', time, 0, 1e6, '.001')}${input('value', spec.label, key?.value ?? numberAt(value, time, fallback), spec.min, spec.max, '.01')}</div>`
                + select('ease', '到达此帧的变化', easingChoices(key?.easing), easingChoice(key?.easing, 'smooth'))
                + `<div class="cinema-pair"><button data-act="cinema-key-now">取当前时间</button><button data-act="cinema-key-save" ${disabled}>记录 / 更新关键帧</button><button data-act="cinema-key-remove" ${disabled || !keys.length ? 'disabled' : ''}>删除所选关键帧</button><button data-act="cinema-constant" ${disabled}>改为全程恒定值</button></div>`
                + '<p>画面中心为 0，三分位为 ±0.333。改变时间再保存会新增关键帧。</p>';
        }
        if (tab === 'shake') {
            const s = effects.shake;
            body = select('shake', '手持类型', [['none', '关闭'], ...Object.entries(SHAKE_PRESETS)], s?.preset ?? 'none')
                + `<div class="cinema-pair">${input('amount', '强度', s?.amount ?? 1, 0, 5)}${input('frequency', '频率倍率', s?.frequency ?? 1, .1, 10)}</div>`
                + `<div class="cinema-pair">${input('shake-start', '开始 / 秒', s?.start ?? ctx.time, 0, 1e6)}${input('end', '结束 / 秒', s?.end ?? Math.max(ctx.time + 1, ctx.project.duration), .01, 1e6)}</div>`
                + input('seed', '变化种子', s?.seed ?? 1, -2147483648, 2147483647, '1')
                + '<p>晃动叠加在机位路径或 POV 上，首尾渐入渐出。同一种子、同一时刻的画面固定，重播和导出一致。</p>'
                ;
        }
        if (tab === 'lens') body = select('distortion', '镜头畸变类型', [['barrel', '桶形'], ['pincushion', '枕形'], ['fisheye', '鱼眼']], effects.distortionType ?? 'barrel')
            + select('focus', '自动对焦目标', [['', '使用对焦距离参数'], ...ctx.project.entities.filter(e => e.kind !== 'camera').map(e => [e.id, e.name] as [string, string])], effects.focusTargetId ?? '')
            + input('lag', '跟随机位延迟 / 秒', effects.followLag ?? 0, 0, 5, '.05')
            + select('preview-quality', '预览精度 · 导出保持完整分辨率', [['full', '完整'], ['draft', '流畅 · 降低预览分辨率']], ctx.engine.previewQuality)
            + `<p>畸变强度与景深在「参数」调整。跟随延迟仅改变机位位置。${effects.dollyZoom ? `希区柯克变焦已开启，参考距离 ${effects.dollyZoom.distance.toFixed(2)} m；其焦距优先于焦距通道。` : '希区柯克变焦可从运镜预设生成。'}</p>`
            + `<div class="cinema-pair"><button data-act="cinema-dolly-clear" ${disabled || !effects.dollyZoom ? 'disabled' : ''}>关闭希区柯克变焦</button></div>`;
        const layout = inspectorToolLayout(body);
        html += `<section class="inspector-parameter-group" data-cinema-section="${tab}"><h3>${label} ${layout.help}</h3><div class="cinema-panel inspector-cinema">${layout.body}<div class="inspector-tool-actions">${layout.footer}</div></div></section>`;
        }
        footer = ''; return html;
    }
    function bind() {
        el('channel')?.addEventListener('change', () => { channel = el('channel').value as CameraChannel; selectedKey = 0; render(); });
        el('key')?.addEventListener('change', () => { selectedKey = Number(el('key').value); render(); });
        document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-cinema-section="lens"] input,[data-cinema-section="lens"] select,[data-cinema-section="shake"] input,[data-cinema-section="shake"] select').forEach(input => {
            const tab = input.closest<HTMLElement>('[data-cinema-section]')!.dataset.cinemaSection;
            if (input.id !== 'cinema-preview-quality') input.addEventListener('change', () => handle(tab === 'lens' ? 'cinema-lens-save' : 'cinema-shake-save'));
        });
        el('preview-quality')?.addEventListener('change', () => ctx.engine.setPreviewQuality(el('preview-quality').value as 'full' | 'draft'));
    }
    return { render: content, bind, handle, footer: () => footer };
    function handle(action: string) {
        if (!action.startsWith('cinema-')) return false;
        const e = ctx.project.entities.find(e => e.id === owner); if (!e?.camera) return true;
        if (action === 'cinema-key-now') { el('time').value = String(ctx.time); return true; }
        if (e.locked) { ctx.toast('请先解锁摄影机'); return true; }
        ctx.change(() => {
            const c = e.camera!, effects: CameraEffects = c.effects ??= {}, channels = effects.channels ??= {};
            const spec = CAMERA_CHANNELS[channel], fallback = channel === 'focal' ? c.focal : spec.default;
            if (action === 'cinema-generate') applyCameraMotion(ctx.project, owner, el('preset').value, n('preset-start'), n('duration'), { amplitude: n('amplitude'), angle: n('angle'), side: n('side'), easing: el('preset-ease').value as Easing });
            if (action === 'cinema-key-save') {
                const time = Math.round(n('time') * ctx.project.fps) / ctx.project.fps;
                channels[channel] = setNumberKey(channels[channel], time, n('value'), fallback, chosenEasing(el('ease').value, keyEasing(channels[channel], selectedKey)));
                ctx.project.duration = Math.max(ctx.project.duration, time);
            }
            if (action === 'cinema-constant') channels[channel] = n('value');
            if (action === 'cinema-key-remove') {
                const value = channels[channel];
                if (typeof value === 'object') { const last = numberAt(value, ctx.time, fallback); value.keys.splice(selectedKey, 1); if (!value.keys.length) channels[channel] = last; }
            }
            if (action === 'cinema-shake-save') effects.shake = el('shake').value === 'none' ? null : { preset: el('shake').value as keyof typeof SHAKE_PRESETS, amount: n('amount'), frequency: n('frequency'), seed: n('seed'), start: n('shake-start'), end: n('end') };
            if (action === 'cinema-lens-save') { effects.distortionType = el('distortion').value as CameraEffects['distortionType']; effects.focusTargetId = el('focus').value; effects.followLag = n('lag'); }
            if (action === 'cinema-dolly-clear') effects.dollyZoom = null;
        }, false);
        return true;
    }
}
