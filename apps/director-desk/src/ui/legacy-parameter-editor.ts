import type { Entity } from '../model.ts';
import { propParameters } from '../parametric-props.ts';
import { num, select } from './common.ts';

export function createLegacyParameterEditor() {
    return { render(e: Entity) {
        const p = propParameters(e);
        const choices: [Exclude<keyof typeof p, 'layout'>, string][] = e.asset === 'stairs'
            ? [['steps', '每段级数'], ['rise', '单级高度 / 米'], ['tread', '踏步深度 / 米'], ['width', '梯宽 / 米'], ...(p.layout !== 'straight' ? [['landing', '平台进深 / 米'] as [Exclude<keyof typeof p, 'layout'>, string]] : [])]
            : [['length', '长度 / 米'], ['width', e.asset === 'wall' ? '厚度 / 米' : '宽度 / 米'], ['height', e.asset === 'wall' ? '高度 / 米' : '厚度 / 米']];
        return (e.asset === 'stairs' ? select('楼梯结构', 'parameters.layout', [['straight', '直梯'], ['crest', '上平台后下行'], ['return', '折返上行']], p.layout) : '')
            + '<div class="shape-parameter-grid">' + choices.map(([key,label])=>num(label, `parameters.${key}`, p[key], key === 'steps' ? '1' : '.01', key === 'steps' ? 'min="1" max="128"' : 'min=".02" max="500"')).join('') + '</div>';
    } };
}
