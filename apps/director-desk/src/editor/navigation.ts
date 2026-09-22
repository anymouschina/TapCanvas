import { editorPreferences } from './preferences.ts';
import { Vector3 } from 'three';
import type { AppContext } from '../app-context.ts';

/** Keyboard movement changes only the editor viewpoint, never a filming camera. */
export function bindNavigation(ctx: AppContext) {
    const canvas = ctx.engine.editorRenderer.domElement;
    const keys = new Set<string>();
    const navigationKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ShiftLeft', 'ShiftRight']);
    canvas.tabIndex = 0;
    canvas.title = '点击布景后：WASD 移动 · Q/E 转向 · R/F 升降 · Shift 加速';
    canvas.addEventListener('pointerdown', () => canvas.focus({ preventScroll: true }));
    const enabled = () => document.activeElement === canvas && ctx.mode !== 'shot' && !ctx.busy && !ctx.engine.exporting && !ctx.engine.dragging && !document.querySelector('#modal-root')!.children.length;
    document.addEventListener('keydown', event => {
        if (!enabled() || event.ctrlKey || event.metaKey || event.altKey || !navigationKeys.has(event.code)) return;
        event.preventDefault();
        keys.add(event.code);
    });
    document.addEventListener('keyup', event => keys.delete(event.code));
    canvas.addEventListener('blur', () => keys.clear());
    window.addEventListener('blur', () => keys.clear());
    document.addEventListener('visibilitychange', () => keys.clear());
    return {
        update(delta: number) {
            if (!enabled()) { keys.clear(); return; }
            if (!keys.size) return;
            const camera = ctx.engine.editorCamera, orbit = ctx.engine.orbit;
            const axis = (positive: string, negative: string) => Number(keys.has(positive)) - Number(keys.has(negative));
            const yaw = axis('KeyQ', 'KeyE') * delta * 1.25 * editorPreferences.current.rotationSpeed;
            if (yaw) {
                const direction = orbit.target.clone().sub(camera.position).applyAxisAngle(new Vector3(0, 1, 0), yaw);
                orbit.target.copy(camera.position).add(direction);
            }
            const forward = orbit.target.clone().sub(camera.position).setY(0).normalize();
            if (forward.lengthSq() < .001) forward.set(0, 0, -1);
            const right = forward.clone().cross(new Vector3(0, 1, 0));
            const movement = forward.multiplyScalar(axis('KeyW', 'KeyS')).addScaledVector(right, axis('KeyD', 'KeyA'));
            movement.y = axis('KeyR', 'KeyF');
            movement.normalize().multiplyScalar(delta * editorPreferences.current.navigationSpeed * (keys.has('ShiftLeft') || keys.has('ShiftRight') ? editorPreferences.current.navigationBoost : 1));
            camera.position.add(movement);
            orbit.target.add(movement);
            orbit.update();
        }
    };
}
