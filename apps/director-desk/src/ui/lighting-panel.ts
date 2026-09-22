import { easingChoice, easingChoices, chosenEasing, keyEasing } from './easing-options.ts';
import { inspectorToolLayout } from './inspector-tool-layout.ts';
import type { AppContext } from '../app-context.ts';
import { defaultLighting, LIGHT_TYPES } from '../lighting/model.ts';
import type { Entity } from '../model.ts';
import { lightingPreset, LIGHTING_PRESETS } from '../lighting/presets.ts';
import { numberAt, setNumberKey, type AnimatedNumber } from '../animation/channels.ts';
import { options } from './common.ts';
import './camera-effects-panel.css';
export function createLightingPanel(ctx: AppContext) {
    let owner = '', tab = 'main', channel = 'ambient', keyIndex = 0;
    const el = (name: string) => document.getElementById('lighting-' + name) as HTMLInputElement;
    const n = (name: string) => Number(el(name).value);
    const select = (name: string, label: string, list: [string, string][], value: string) => `<label>${label}<select id="lighting-${name}">${options(list, value)}</select></label>`;
    const num = (name: string, label: string, value: number, min = 0, max = 100000, step = '.1') => `<label>${label}<input id="lighting-${name}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"/></label>`;
    const color = (name: string, label: string, value: string) => `<label>${label}<input id="lighting-${name}" type="color" value="${value}"/></label>`;
    const pair = (a: string, b: string) => `<div class="cinema-pair">${a}${b}</div>`;
    const keep = (previous: AnimatedNumber | undefined, next: number, fallback = 0) => next === numberAt(previous, ctx.time, fallback) ? previous ?? fallback : next;
    let footer = '';
    const render = () => ctx.renderInspector();
    function content(target?: Entity) {
        const nextOwner = target?.id ?? '';
        if (owner !== nextOwner) { owner = nextOwner; tab = 'main'; channel = ''; keyIndex = 0; }
        const entity = ctx.project.entities.find(e => e.id === owner && e.light), light = entity?.light;
        if (!light) owner = '';
        const scene = ctx.project.lighting ?? defaultLighting(), disabled = entity?.locked ? 'disabled' : '';
        const fields = light ? [['intensity', '灯光强度'], ['temperature', '色温'], ['color', '灯光颜色']] : [['ambient', '环境亮度'], ['exposure', '曝光'], ['sunIntensity', '太阳光强度']];
        if (!fields.some(([id]) => id === channel)) channel = fields[0][0];
        let html = '';
        for (const [tab,label] of [['main','照明参数'],['shape',light?'范围与形状':'太阳光'],['atmosphere',light?'闪烁':'雾'],['keys','参数关键帧']]) {
        let body = '';
        if (tab === 'main' && !light) body = select('preset', '光影预设', [['', '选择预设'], ...Object.entries(LIGHTING_PRESETS)], '')
            + pair(num('ambient', '环境亮度', numberAt(scene.ambient, ctx.time), 0, 20), num('exposure', '曝光', numberAt(scene.exposure, ctx.time), .05, 10))
            + pair(color('background', '背景颜色', scene.background), color('ground', '环境下半球颜色', scene.groundColor))
            + select('quality', '阴影质量', [['off', '关闭阴影'], ['low', '低 · 512'], ['medium', '中 · 2048'], ['high', '高 · 4096']], scene.quality);
        if (tab === 'main' && light) body = pair(num('intensity', '灯光强度', numberAt(light.intensity, ctx.time)), color('color', '灯光颜色', entity!.color))
            + pair(select('temperature-on', '色温', [['false', '仅使用颜色'], ['true', '颜色叠加色温']], String(light.temperature !== undefined)), num('temperature', '色温 / K', numberAt(light.temperature, ctx.time, 6500), 1000, 15000, '100'))
            + pair(select('through-walls', '穿透墙体', entity!.asset === 'light-area' ? [['false', '面光无需穿墙']] : [['false', '关闭'], ['true', '开启']], String(light.throughWalls ?? false)), select('shadows', '投射阴影', entity!.asset === 'light-area' ? [['false', '面光不投影']] : [['true', '开启'], ['false', '关闭']], String(light.shadows)))
            + '<p>穿透内置墙顶和建筑外壳，人物、家具仍挡光。普通几何体和导入模型不自动当作墙体。</p>';
        if (tab === 'shape' && !light) body = select('default', '默认太阳光和补光', [['true', '开启'], ['false', '关闭 · 仅使用自建灯具']], String(scene.defaultLights))
            + pair(color('sun-color', '太阳光颜色', scene.sunColor ?? '#fff7e9'), num('sun-intensity', '太阳光强度', numberAt(scene.sunIntensity, ctx.time, 3.5), 0, 100))
            + '<p>太阳方向为从场景中心指向光源的向量。阴影覆盖会随当前场景的对象位置调整。</p>'
            + `<div class="cinema-pair">${(scene.sunDirection ?? [-3.7, 7, 4]).map((v, i) => num('direction-' + i, 'XYZ'[i], v, -1000, 1000)).join('')}</div>`;
        if (tab === 'shape' && light) body = num('range', '照射／阴影范围 / m', light.range, .1, 10000)
            + (entity!.asset === 'light-spot' ? pair(num('angle', '聚光半角 / 度', light.angle, 1, 89), num('penumbra', '聚光边缘柔化', light.penumbra, 0, 1, '.05')) : '')
            + (entity!.asset === 'light-area' ? pair(num('width', '面光宽度 / m', light.width, .01, 500), num('height', '面光高度 / m', light.height, .01, 500)) : '')
            + '<p>聚光角度用于聚光灯；面光尺寸用于面光源。面光源提供柔和照明，目前不投射阴影。</p>';
        if (tab === 'atmosphere' && !light) body = select('fog-on', '场景雾', [['false', '关闭'], ['true', '开启']], String(!!scene.fog))
            + pair(color('fog-color', '雾颜色', scene.fog?.color ?? scene.background), num('fog-density', '雾密度', numberAt(scene.fog?.density, ctx.time), 0, .5, '.001'))
            + '<p>雾随距离遮蔽远景，影响实际拍摄和导出。光束体积散射尚不包含在此效果中。</p>';
        if (tab === 'atmosphere' && light) body = select('flicker-on', '闪烁', [['false', '关闭'], ['true', '开启']], String(!!light.flicker))
            + pair(num('strength', '变化强度', light.flicker?.strength ?? .3, 0, 1, '.05'), num('frequency', '频率 / Hz', light.flicker?.frequency ?? 4, .1, 100))
            + num('seed', '变化种子', light.flicker?.seed ?? 1, -2147483648, 2147483647, '1');
        if (tab === 'keys') {
            const value = (light ?? scene as unknown) as Record<string, AnimatedNumber | undefined>;
            const animated = value[channel];
            const keys = channel === 'color' ? light?.colorKeys ?? [] : typeof animated === 'object' ? animated.keys : [];
            keyIndex = Math.min(keyIndex, Math.max(0, keys.length - 1)); const key = keys[keyIndex];
            body = select('channel', '动画参数', fields as [string, string][], channel)
                + select('key', '已有关键帧', keys.length ? keys.map((key, i) => [String(i), `${i + 1} · ${key.time.toFixed(3)} 秒`]) : [['0', '尚未记录']], String(keyIndex))
                + pair(num('time', '时间 / 秒', key?.time ?? ctx.time, 0, 1e6, '.001'), channel === 'color' ? color('key-color', '颜色', key && 'color' in key ? key.color : entity!.color) : num('value', '数值', key && 'value' in key ? key.value : numberAt(animated, ctx.time, channel === 'temperature' ? 6500 : 0)))
                + select('easing', '到达此帧的变化', easingChoices(key?.easing), easingChoice(key?.easing, 'smooth'))
                + pair('<button data-act="lighting-key-now">取当前时间</button>', `<button data-act="lighting-key-save" ${disabled}>记录 / 更新关键帧</button>`)
                + `<button data-act="lighting-key-remove" ${disabled || !keys.length ? 'disabled' : ''}>删除所选关键帧</button>`;
        }
        const layout = inspectorToolLayout(body);
        html += `<section class="inspector-parameter-group" data-light-section="${tab}"><h3>${label} ${layout.help}</h3><div class="cinema-panel inspector-cinema">${layout.body}<div class="inspector-tool-actions">${layout.footer}</div></div></section>`;
        }
        footer = !light ? `<select id="lighting-new-type" aria-label="新增灯光类型">${options(Object.entries(LIGHT_TYPES), 'light-spot')}</select><button data-act="lighting-add">添加灯光</button>` : '';
        return html;
    }
    function bind() {
        if (el('through-walls') && ctx.current()?.asset === 'light-area') el('through-walls').disabled = true;
        el('channel')?.addEventListener('change', () => { channel = el('channel').value; keyIndex = 0; render(); });
        el('key')?.addEventListener('change', () => { keyIndex = n('key'); render(); });
        document.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-light-section]:not([data-light-section="keys"]) input,[data-light-section]:not([data-light-section="keys"]) select').forEach(input => {
            if (input.id === 'lighting-new-type') return;
            input.addEventListener('change', () => { tab=input.closest<HTMLElement>('[data-light-section]')!.dataset.lightSection!;handle(input.id === 'lighting-preset' ? 'lighting-preset' : 'lighting-save'); });
        });
    }
    return { render: content, bind, handle, footer: () => footer };
    function handle(action: string) {
        if (!action.startsWith('lighting-') && action !== 'light-open') return false;
        if (action === 'lighting-add') { ctx.addAsset(el('new-type').value); owner = ctx.selected; tab = 'main'; render(); return true; }
        if (action === 'lighting-preset' && !el('preset').value) return true;
        if (action === 'lighting-key-now') { el('time').value = String(ctx.time); return true; }
        const entity = ctx.project.entities.find(e => e.id === owner && e.light), light = entity?.light;
        if (entity?.locked) { ctx.toast('请先解锁灯光'); return true; }
        ctx.change(() => {
            const scene = ctx.project.lighting ?? defaultLighting();
            if (!light) ctx.project.lighting = scene;
            if (action === 'lighting-preset') { ctx.project.lighting = lightingPreset(el('preset').value); return; }
            if (action.startsWith('lighting-key-')) {
                const target = (light ?? scene) as unknown as Record<string, AnimatedNumber>, time = Math.round(n('time') * ctx.project.fps) / ctx.project.fps;
                if (channel === 'color') {
                    const keys = light!.colorKeys ??= [];
                    if (action === 'lighting-key-remove') keys.splice(keyIndex, 1);
                    else { const key = { time, color: el('key-color').value, easing: chosenEasing(el('easing').value, keys[keyIndex]?.easing) }, index = keys.findIndex(k => k.time === time); if (index >= 0) keys[index] = key; else keys.push(key); keys.sort((a, b) => a.time - b.time); }
                } else if (action === 'lighting-key-remove') {
                    const value = target[channel]; if (typeof value === 'object') { const last = numberAt(value, ctx.time); value.keys.splice(keyIndex, 1); if (!value.keys.length) target[channel] = last; }
                } else target[channel] = setNumberKey(target[channel], time, n('value'), channel === 'temperature' ? 6500 : 0, chosenEasing(el('easing').value, keyEasing(target[channel], keyIndex)));
                ctx.project.duration = Math.max(ctx.project.duration, time); return;
            }
            if (tab === 'main') {
                if (light) { light.intensity = keep(light.intensity, n('intensity')); entity!.color = el('color').value; light.throughWalls = el('through-walls').value === 'true'; light.shadows = el('shadows').value === 'true'; if (el('temperature-on').value === 'true') light.temperature = keep(light.temperature, n('temperature'), 6500); else delete light.temperature; }
                else { scene.ambient = keep(scene.ambient, n('ambient')); scene.exposure = keep(scene.exposure, n('exposure')); scene.background = el('background').value; scene.groundColor = el('ground').value; scene.quality = el('quality').value as typeof scene.quality; }
            }
            if (tab === 'shape') {
                if (light) { for (const key of ['range', 'angle', 'penumbra', 'width', 'height'] as const) if(el(key)) light[key] = n(key); light.shadows = el('shadows').value === 'true'; }
                else { scene.defaultLights = el('default').value === 'true'; scene.sunColor = el('sun-color').value; scene.sunIntensity = keep(scene.sunIntensity, n('sun-intensity'), 3.5); scene.sunDirection = [n('direction-0'), n('direction-1'), n('direction-2')]; }
            }
            if (tab === 'atmosphere') {
                if (light) light.flicker = el('flicker-on').value === 'true' ? { ...light.flicker, strength: n('strength'), frequency: n('frequency'), seed: n('seed') } : null;
                else scene.fog = el('fog-on').value === 'true' ? { color: el('fog-color').value, density: keep(scene.fog?.density, n('fog-density')) } : null;
            }
        }, false);
        return true;
    }
}
