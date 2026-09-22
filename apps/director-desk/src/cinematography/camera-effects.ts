import { Euler, MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { assertAnimated, numberAt, type AnimatedNumber } from '../animation/channels.ts';
import { setLensProjection } from './lens-projection.ts';
export const CAMERA_CHANNELS = {
    focal: { label: '焦距 / mm', min: 8, max: 300, default: 28 },
    roll: { label: '画面倾斜 / 度', min: -1080, max: 1080, default: 0 },
    pan: { label: '水平摇镜 / 度', min: -1080, max: 1080, default: 0 },
    tilt: { label: '俯仰摇镜 / 度', min: -1080, max: 1080, default: 0 },
    offsetX: { label: '机身左右偏移 / m', min: -1000, max: 1000, default: 0 },
    offsetY: { label: '机身升降偏移 / m', min: -1000, max: 1000, default: 0 },
    offsetZ: { label: '机身前后偏移 / m', min: -1000, max: 1000, default: 0 },
    frameX: { label: '主体横向位置', min: -.9, max: .9, default: 0 },
    frameY: { label: '主体纵向位置', min: -.9, max: .9, default: 0 },
    focusDistance: { label: '对焦距离 / m', min: .05, max: 2000, default: 5 },
    blur: { label: '景深虚化强度', min: 0, max: 1, default: 0 },
    bloom: { label: '高光泛光', min: 0, max: 2, default: 0 },
    distortion: { label: '畸变强度', min: 0, max: 1, default: 0 },
} as const;
export type CameraChannel = keyof typeof CAMERA_CHANNELS;
export const SHAKE_PRESETS = { breath: '呼吸浮动', walk: '行走手持', run: '奔跑追逐', impact: '短促冲击', pov: '第一视角奔跑' } as const;
export interface CameraEffects {
    channels?: Partial<Record<CameraChannel, AnimatedNumber>>;
    distortionType?: 'barrel' | 'pincushion' | 'fisheye';
    focusTargetId?: string;
    followLag?: number;
    shake?: { preset: keyof typeof SHAKE_PRESETS; amount: number; frequency: number; seed: number; start: number; end: number } | null;
    dollyZoom?: { distance: number; focal: number } | null;
}
export function assertCameraEffects(effects: CameraEffects | undefined, targetExists: (id: string) => boolean) {
    if (effects === undefined) return;
    if (!effects || typeof effects !== 'object' || Array.isArray(effects) || Object.keys(effects).some(k => !['channels', 'distortionType', 'focusTargetId', 'followLag', 'shake', 'dollyZoom'].includes(k))) throw Error('镜头效果结构错误');
    if (effects.channels !== undefined) {
        if (!effects.channels || typeof effects.channels !== 'object' || Array.isArray(effects.channels)) throw Error('镜头参数通道错误');
        for (const [key, value] of Object.entries(effects.channels)) {
            const spec = CAMERA_CHANNELS[key as CameraChannel]; if (!Object.hasOwn(CAMERA_CHANNELS, key)) throw Error('未知镜头通道：' + key);
            assertAnimated(value, spec.min, spec.max, spec.label);
        }
    }
    if (effects.distortionType !== undefined && !['barrel', 'pincushion', 'fisheye'].includes(effects.distortionType)) throw Error('未知镜头畸变');
    if (effects.focusTargetId !== undefined && (typeof effects.focusTargetId !== 'string' || effects.focusTargetId && !targetExists(effects.focusTargetId))) throw Error('对焦对象不存在');
    if (effects.followLag !== undefined && (!Number.isFinite(effects.followLag) || effects.followLag < 0 || effects.followLag > 5)) throw Error('跟随延迟需在 0 至 5 秒之间');
    const s = effects.shake;
    if (s != null && (Object.keys(s).some(k => !['preset', 'amount', 'frequency', 'seed', 'start', 'end'].includes(k)) || !Object.hasOwn(SHAKE_PRESETS, s.preset) || ![s.amount, s.frequency, s.seed, s.start, s.end].every(Number.isFinite) || s.amount < 0 || s.amount > 5 || s.frequency < .1 || s.frequency > 10 || !Number.isInteger(s.seed) || s.start < 0 || s.end <= s.start)) throw Error('手持晃动参数错误');
    const d = effects.dollyZoom;
    if (d != null && (Object.keys(d).some(k => !['distance', 'focal'].includes(k)) || !Number.isFinite(d.distance) || d.distance < .05 || !Number.isFinite(d.focal) || d.focal < 8 || d.focal > 300)) throw Error('希区柯克变焦参考距离或焦距错误');
}
export function cameraFocal(effects: CameraEffects | undefined, time: number, fallback: number, distance: number) {
    if (effects?.dollyZoom) return MathUtils.clamp(effects.dollyZoom.focal * distance / effects.dollyZoom.distance, 8, 300);
    return numberAt(effects?.channels?.focal, time, fallback);
}
export function applyCameraEffects(camera: PerspectiveCamera, effects: CameraEffects | undefined, time: number) {
    camera.userData.directorBasePose = { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() };
    setLensProjection(camera, effects, time);
    if (!effects) return;
    camera.translateX(numberAt(effects.channels?.offsetX, time)); camera.translateY(numberAt(effects.channels?.offsetY, time)); camera.translateZ(numberAt(effects.channels?.offsetZ, time));
    camera.quaternion.multiply(new Quaternion().setFromEuler(new Euler(MathUtils.degToRad(numberAt(effects.channels?.tilt, time)), MathUtils.degToRad(numberAt(effects.channels?.pan, time)), MathUtils.degToRad(numberAt(effects.channels?.roll, time)))));
    const s = effects.shake;
    if (s && time > s.start && time < s.end) {
        const t = time - s.start, duration = s.end - s.start;
        const envelope = Math.min(1, t / .12, (duration - t) / .12) * (s.preset === 'impact' ? Math.exp(-5 * t) : 1);
        const frequency = { breath: .28, walk: 1.65, run: 3.2, impact: 9, pov: 3.7 }[s.preset] * s.frequency;
        const magnitude = { breath: .15, walk: .45, run: 1, impact: 2.5, pov: 1.7 }[s.preset] * s.amount * envelope;
        const signal = (axis: number) => {
            const phase = Math.sin(s.seed * 12.9898 + axis * 78.233) * 6.283;
            return Math.sin(t * frequency * 6.283 + phase) * .7 + Math.sin(t * frequency * 10.137 + phase * 2) * .3;
        };
        camera.translateX(signal(1) * .025 * magnitude); camera.translateY(signal(2) * .035 * magnitude);
        camera.rotateX(MathUtils.degToRad(signal(3) * magnitude)); camera.rotateY(MathUtils.degToRad(signal(4) * magnitude * .65)); camera.rotateZ(MathUtils.degToRad(signal(5) * magnitude * .75));
    }
    // Principal-point shift expresses composition without changing world-space target or camera path.
    const frameX = numberAt(effects.channels?.frameX, time), frameY = numberAt(effects.channels?.frameY, time);
    camera.projectionMatrix.elements[8] -= frameX; camera.projectionMatrix.elements[9] -= frameY;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
export function cameraFocusDistance(camera: PerspectiveCamera, effects: CameraEffects | undefined, time: number, target?: Vector3) {
    return target ? Math.max(.05, -target.clone().applyMatrix4(camera.matrixWorldInverse).z) : numberAt(effects?.channels?.focusDistance, time, 5);
}
