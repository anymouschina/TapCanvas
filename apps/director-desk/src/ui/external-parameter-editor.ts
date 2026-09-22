import type { AppContext } from '../app-context.ts';
import type { Entity } from '../model.ts';
import { escape, options } from './common.ts';
export function createExternalParameterEditor(ctx: AppContext, refresh: () => void) {
    let key = 'appearance'; const content = document.querySelector<HTMLElement>('#inspector-content')!;
    content.addEventListener('change', event => {
        const target = event.target as HTMLSelectElement; if (target.id !== 'external-parameter-key') return;
        event.stopPropagation(); key = target.value; refresh(); content.querySelector<HTMLElement>('#external-parameter-key')?.focus({ preventScroll: true });
    });
    return { render(e: Entity) {
        const data = e.external!, resource = ctx.project.resources!.find(r => r.id === data.resourceId)!;
        const info = ctx.engine.externalModels.inspection(resource);
        const fields: [string, string][] = [['appearance', '显示方式'], ['unitScale', resource.package.format === 'fbx' ? '额外尺寸倍率' : '源单位换算到米'], ['orientation.0', '模型 X 校正／度'], ['orientation.1', '模型 Y 校正／度'], ['orientation.2', '模型 Z 校正／度'], ...(e.kind === 'actor' ? [['height', '身高／米']] as [string, string][] : [])];
        if (!fields.some(([id]) => id === key)) key = 'appearance';
        const label = fields.find(([id]) => id === key)![1];
        const value = key === 'height' ? e.height : key === 'unitScale' ? data.unitScale : key.startsWith('orientation.') ? data.orientation[Number(key.split('.')[1])] * 180 / Math.PI : 0;
        const attributes = `data-field="${key === 'height' ? 'height' : 'external.' + key}" aria-label="${escape(label)}"`;
        const control = key === 'appearance' ? `<select ${attributes}>${options([['original', '原材质'], ['white', '白模'], ['color', '识别色']], data.appearance)}</select>`
            : `<input type="number" ${attributes} value="${value}" step="${key === 'height' ? '.01' : key === 'unitScale' ? '.001' : '90'}"/>`;
        return `<div class="asset-parameter-editor"><select id="external-parameter-key" aria-label="模型参数">${options(fields, key)}</select>${control}`
            + `<p class="parameter-hint" title="${info.meshes} 个网格，${info.bones.length} 个骨骼，${info.animations.length} 段原生动画；自带动画可编排；完整人形映射可使用素材适配动作，实例位置和颜色独立。">源模型随工程保存</p></div>`;
    } };
}
