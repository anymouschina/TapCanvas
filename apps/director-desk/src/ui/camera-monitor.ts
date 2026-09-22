import type { Entity } from '../model.ts';
import { escape, icon, options } from './common.ts';

/** Keep monitoring controls bounded when a scene contains many cameras. */
export function cameraMonitor(cameras: Entity[], preview: string) {
    const program = `<button data-preview="program" class="${preview === 'program' ? 'active' : ''}">${icon('play')}成片</button>`;
    if (cameras.length > 3) return program + `<select id="monitor-camera" aria-label="选择监看机位" title="切换监看不会记录切镜">${options([['program', `选择机位 · ${cameras.length} 台`], ...cameras.map(e => [e.id, e.name] as [string, string])], preview)}</select>`;
    return program + cameras.map(e => `<button data-preview="${e.id}" title="${escape(e.name)}" class="${preview === e.id ? 'active' : ''}">${icon('camera')}<span>${escape(e.name)}</span></button>`).join('');
}
