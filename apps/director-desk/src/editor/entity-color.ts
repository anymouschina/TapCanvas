import type { Entity } from '../model.ts';

export function normalizedColor(value: string) {
    let hex = value.trim().replace(/^#/, '');
    if (/^[\da-f]{3}$/i.test(hex)) hex = [...hex].map(c => c + c).join('');
    if (!/^[\da-f]{6}$/i.test(hex)) throw Error('请输入有效的颜色，例如 #78A6D4');
    return '#' + hex.toLowerCase();
}

/** A chosen colour becomes visible immediately, including on imported instances. */
export function setEntityColor(entity: Entity, value: string, appearance?: 'original' | 'white' | 'color') {
    if (entity.locked) throw Error('对象已锁定');
    const color = normalizedColor(value);
    entity.color = color;
    if (entity.external) entity.external.appearance = appearance ?? 'color';
}
