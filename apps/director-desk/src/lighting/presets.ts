import { defaultLighting, type LightingConfig } from './model.ts';
export const LIGHTING_PRESETS = { daylight: '日间', dusk: '黄昏', moonlight: '月夜', 'interior-warm': '室内暖光', 'interior-cool': '室内冷光', silhouette: '逆光剪影' } as const;
export function lightingPreset(name: string): LightingConfig {
    const base = defaultLighting();
    if (!Object.hasOwn(LIGHTING_PRESETS, name)) throw Error('未知光影预设');
    const variants: Record<string, Partial<LightingConfig>> = {
        daylight: { sunDirection: [-3.7, 7, 4] },
        dusk: { ambient: .5, sunColor: '#ffaf70', sunIntensity: 3, sunDirection: [-6, 1.4, 3], background: '#b1a3a3', groundColor: '#71646a' },
        moonlight: { ambient: .12, sunColor: '#9bbaff', sunIntensity: .65, sunDirection: [-4, 6, -3], background: '#101b30', groundColor: '#192333', exposure: .9 },
        'interior-warm': { ambient: .6, sunColor: '#ffd2a0', sunIntensity: 2.4, sunDirection: [-2, 5, 2], background: '#544438', groundColor: '#77634e' },
        'interior-cool': { ambient: .55, sunColor: '#bad7ff', sunIntensity: 2.4, sunDirection: [2, 5, 1], background: '#3d4855', groundColor: '#535d6c' },
        silhouette: { ambient: .03, sunColor: '#ffdcad', sunIntensity: 5, sunDirection: [0, 2, -6], background: '#897568', groundColor: '#24201c' },
    };
    return { ...base, ...variants[name] };
}
