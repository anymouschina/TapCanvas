import { Vector3 } from 'three';
import type { Project, Vec3 } from '../model.ts';
import { entityPosition, entityYaw } from '../timeline.ts';
import { assertEasing, eased, type Easing } from '../animation/channels.ts';
import { cameraLookAt } from '../animation/camera-look.ts';
export const CAMERA_PRESETS = {
    push: '推近', pull: '拉远', truck: '横移', rise: '升高', descend: '下降', arc: '环绕',
    'arc-push': '弧线推进', 'crane-reveal': '后拉升高揭示', 'ground-rise': '贴地前进抬升',
    'whip-pan': '快速甩向另一侧', 'push-pause': '推进 · 停顿 · 再推进',
    'dolly-zoom': '希区柯克变焦', 'roll-recover': '倾斜后恢复', 'reframe': '构图左右换边',
} as const;
export type CameraPreset = keyof typeof CAMERA_PRESETS;
export interface CameraMotionOptions { amplitude?: number; angle?: number; side?: number; easing?: Easing }
/** Presets write ordinary editable paths/channels. UI, MCP and offline share this implementation. */
export function applyCameraMotion(project: Project, id: string, preset: string, start: number, duration: number, options: CameraMotionOptions = {}) {
    const e = project.entities.find(e => e.id === id), c = e?.camera;
    if (!e || !c) throw Error('运镜目标必须是摄影机');
    if (e.locked) throw Error('摄影机已锁定');
    if (!Object.hasOwn(CAMERA_PRESETS, preset)) throw Error('未知运镜预设');
    if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0) throw Error('运镜时间无效');
    if (!options || Object.keys(options).some(k => !['amplitude', 'angle', 'side', 'easing'].includes(k))) throw Error('运镜参数仅支持 amplitude、angle、side、easing');
    const amplitude = options.amplitude ?? 2, angle = options.angle ?? 70, side = options.side ?? 1, easing = options.easing ?? 'smooth';
    if (!Number.isFinite(amplitude) || amplitude <= 0 || amplitude > 1000 || !Number.isFinite(angle) || Math.abs(angle) > 720 || ![-1, 1].includes(side)) throw Error('运镜幅度、角度或方向错误');
    assertEasing(easing);
    if (c.mode === 'pov' && !['roll-recover', 'reframe'].includes(preset)) throw Error('请先把 POV 切换为独立机位，再应用路径运镜；POV 晃动可直接编辑镜头效果');
    const subject = project.entities.find(e => e.id === c.targetId);
    const target = c.targetPath ? cameraLookAt(c.targetPath, start) : subject ? entityPosition(subject, start).add(new Vector3(0, c.targetHeight, 0)) : new Vector3(...c.target);
    const origin = entityPosition(e, start);
    if (c.mode === 'follow' && subject) {
        const offset = new Vector3(...c.offset);
        if (c.inheritRotation) offset.applyAxisAngle(new Vector3(0, 1, 0), entityYaw(subject, start, project));
        origin.copy(entityPosition(subject, start)).add(offset);
    }
    if (preset === 'ground-rise') origin.y = (project.floors?.find(f => f.id === e.floorId)?.elevation ?? 0) + .25;
    const direction = target.clone().sub(origin).normalize(), right = new Vector3().crossVectors(direction, new Vector3(0, 1, 0));
    if (preset === 'ground-rise') { direction.y = 0; if (direction.lengthSq() < 1e-8) direction.set(0, 0, -1); else direction.normalize(); }
    if (right.lengthSq() < 1e-8) right.set(1, 0, 0); else right.normalize();
    const offset = origin.clone().sub(target), end = start + duration;
    const points: { time: number; position: Vec3; easing?: Easing }[] = [];
    const add = (u: number, position: Vector3, transition = easing) => points.push({ time: start + duration * u, position: position.toArray() as Vec3, easing: transition });
    const moved = (forward: number, lateral = 0, up = 0) => origin.clone().addScaledVector(direction, forward).addScaledVector(right, lateral).add(new Vector3(0, up, 0));
    const effects = c.effects ??= {}, channels = effects.channels ??= {};
    const curve = (a: number, b: number) => ({ keys: [{ time: start, value: a }, { time: end, value: b, easing }] });
    if (preset === 'roll-recover') channels.roll = { keys: [{ time: start, value: 0 }, { time: start + duration * .4, value: angle * side, easing }, { time: end, value: 0, easing }] };
    else if (preset === 'reframe') channels.frameX = curve(-side / 3, side / 3);
    else if (preset === 'whip-pan') {
        c.targetId = ''; c.target = target.toArray(); c.aim = 'target';
        c.targetPath = { smooth: false, points: [{ time: start, position: target.toArray() }, { time: end, position: origin.clone().add(target.clone().sub(origin).applyAxisAngle(new Vector3(0, 1, 0), angle * side * Math.PI / 180)).toArray(), easing: 'whip' }] };
    } else {
        add(0, origin);
        if (preset === 'arc' || preset === 'arc-push') {
            // Dense geometric samples use a single eased angular progression to avoid stopping at each intermediate point.
            for (let i = 1; i <= 24; i++) {
                const u = i / 24;
                const delta = offset.clone().applyAxisAngle(new Vector3(0, 1, 0), angle * side * u * Math.PI / 180);
                if (preset === 'arc-push') delta.multiplyScalar(Math.max(.15, 1 - amplitude * u / Math.max(.1, offset.length())));
                add(u, target.clone().add(delta), 'linear');
            }
            // The editable point times express the global acceleration; never bake per-frame samples.
            if (easing === 'hold') { const last = points.at(-1)!; last.easing = 'hold'; points.splice(1, points.length - 1, last); }
            else if (easing !== 'linear') for (let i = 1; i < points.length - 1; i++) {
                const u = i / 24;
                const inverse = (goal: number) => { let lo = 0, hi = 1; for (let n = 0; n < 24; n++) { const m = (lo + hi) / 2; if (eased(m, easing) < goal) lo = m; else hi = m; } return (lo + hi) / 2; };
                points[i].time = start + duration * inverse(u);
            }
        } else if (preset === 'push-pause') { add(.35, moved(amplitude * .5)); add(.6, moved(amplitude * .5), 'linear'); add(1, moved(amplitude)); }
        else if (preset === 'ground-rise') { add(.55, moved(amplitude * .6)); add(1, moved(amplitude, 0, Math.max(.5, target.y + .2 - origin.y))); }
        else if (preset === 'push') add(1, moved(Math.min(amplitude, offset.length() * .8)));
        else if (preset === 'pull' || preset === 'dolly-zoom') add(1, moved(-amplitude));
        else if (preset === 'truck') add(1, moved(0, amplitude * side));
        else if (preset === 'rise' || preset === 'descend') add(1, moved(0, 0, amplitude * (preset === 'rise' ? 1 : -1)));
        else if (preset === 'crane-reveal') add(1, moved(-amplitude, 0, amplitude * .6));
        e.position = origin.toArray(); e.path = { smooth: ['arc', 'arc-push', 'ground-rise'].includes(preset), points };
        c.mode = 'free'; c.aim = 'target';
        if (preset === 'dolly-zoom') effects.dollyZoom = { distance: Math.max(.05, offset.length()), focal: c.focal };
    }
    project.duration = Math.max(project.duration, Math.ceil(end * project.fps) / project.fps);
}
