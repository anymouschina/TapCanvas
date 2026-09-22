import { assertAnimated, assertEasing, numberAt, type AnimatedNumber, type Easing } from '../animation/channels.ts';
import type { Entity } from '../model.ts';
export const LIGHT_TYPES = { 'light-point': '点光源', 'light-spot': '聚光灯', 'light-area': '面光源', 'light-sun': '太阳光' } as const;
export interface LightConfig {
    intensity: AnimatedNumber;
    temperature?: AnimatedNumber;
    range: number; angle: number; penumbra: number; width: number; height: number; shadows: boolean;
    throughWalls?: boolean;
    colorKeys?: { time: number; color: string; easing?: Easing }[];
    flicker?: { strength: number; frequency: number; seed: number; start?: number } | null;
}
export interface LightingConfig {
    defaultLights: boolean;
    ambient: AnimatedNumber; exposure: AnimatedNumber;
    background: string; groundColor: string;
    quality: 'off' | 'low' | 'medium' | 'high';
    sunColor?: string; sunIntensity?: AnimatedNumber; sunDirection?: [number, number, number];
    fog?: { color: string; density: AnimatedNumber } | null;
}
export const defaultLighting = (): LightingConfig => ({ defaultLights: true, ambient: 2.5, exposure: 1.05, background: '#c6c8c6', groundColor: '#88847e', quality: 'medium' });
export const defaultLight = (asset: string): LightConfig => ({ intensity: asset === 'light-sun' || asset === 'light-area' ? 4 : 100, range: 20, angle: 40, penumbra: .3, width: 3, height: 2, shadows: asset !== 'light-area' });
const color = (c: unknown) => typeof c === 'string' && /^#[\da-f]{6}$/i.test(c);
export function assertLighting(value: LightingConfig | undefined) {
    if (value === undefined) return;
    if (!value || Object.keys(value).some(k => !['defaultLights', 'ambient', 'exposure', 'background', 'groundColor', 'quality', 'fog', 'sunColor', 'sunIntensity', 'sunDirection'].includes(k)) || typeof value.defaultLights !== 'boolean' || !color(value.background) || !color(value.groundColor) || !['off', 'low', 'medium', 'high'].includes(value.quality)) throw Error('场景光影设置错误');
    if (value.sunColor !== undefined && !color(value.sunColor)) throw Error('太阳光颜色错误');
    if (value.sunIntensity !== undefined) assertAnimated(value.sunIntensity, 0, 100, '太阳光强度');
    if (value.sunDirection !== undefined && (!Array.isArray(value.sunDirection) || value.sunDirection.length !== 3 || !value.sunDirection.every(Number.isFinite) || Math.hypot(...value.sunDirection) < .01)) throw Error('太阳光方向需为非零向量');
    assertAnimated(value.ambient, 0, 20, '环境亮度'); assertAnimated(value.exposure, .05, 10, '曝光');
    if (value.fog != null) {
        if (Object.keys(value.fog).some(k => !['color', 'density'].includes(k)) || !color(value.fog.color)) throw Error('雾颜色错误');
        assertAnimated(value.fog.density, 0, .5, '雾密度');
    }
}
export function assertLightEntity(entity: Entity) {
    const light = entity.light, known = Object.hasOwn(LIGHT_TYPES, entity.asset);
    if (!known) { if (light !== undefined) throw Error('仅灯光资产支持 light 参数'); return; }
    if (entity.kind !== 'prop' || !light || Object.keys(light).some(k => !['intensity', 'temperature', 'range', 'angle', 'penumbra', 'width', 'height', 'shadows', 'throughWalls', 'colorKeys', 'flicker'].includes(k)) || typeof light.shadows !== 'boolean' || light.throughWalls !== undefined && typeof light.throughWalls !== 'boolean') throw Error('灯光参数错误');
    assertAnimated(light.intensity, 0, 100000, '灯光强度');
    if (light.temperature !== undefined) assertAnimated(light.temperature, 1000, 15000, '色温');
    for (const [key, min, max] of [['range', .1, 10000], ['angle', 1, 89], ['penumbra', 0, 1], ['width', .01, 500], ['height', .01, 500]] as const) if (!Number.isFinite(light[key]) || light[key] < min || light[key] > max) throw Error('灯光尺寸或范围错误：' + key);
    if (entity.asset === 'light-area' && light.shadows) throw Error('面光源不支持投影，请关闭 shadows 或改用聚光灯');
    if (light.colorKeys !== undefined) {
        if (!Array.isArray(light.colorKeys)) throw Error('灯光颜色关键帧错误');
        light.colorKeys.forEach((key, i) => {
            if (!key || Object.keys(key).some(k => !['time', 'color', 'easing'].includes(k)) || !Number.isFinite(key.time) || key.time < 0 || !color(key.color) || i > 0 && key.time <= light.colorKeys![i - 1].time) throw Error('灯光颜色关键帧需有效颜色与递增时间');
            assertEasing(key.easing);
        });
    }
    const f = light.flicker;
    if (f != null && (Object.keys(f).some(k => !['strength', 'frequency', 'seed', 'start'].includes(k)) || ![f.strength, f.frequency, f.seed].every(Number.isFinite) || f.strength < 0 || f.strength > 1 || f.frequency <= 0 || f.frequency > 100 || !Number.isInteger(f.seed) || f.start !== undefined && (!Number.isFinite(f.start) || f.start < 0))) throw Error('灯光闪烁参数错误');
}
export function lightIntensity(light: LightConfig, time: number) {
    const f = light.flicker, base = numberAt(light.intensity, time);
    if (!f) return base;
    time = Math.max(0, time - (f.start ?? 0));
    const pulse = .5 + .25 * Math.sin(time * f.frequency * 6.283 + f.seed) + .25 * Math.sin(time * f.frequency * 9.671 + f.seed * 2.17);
    return base * (1 - f.strength * pulse);
}
