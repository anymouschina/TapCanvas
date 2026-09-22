import type { AppContext } from '../app-context.ts';
import { button } from './common.ts';

export function createSceneProperties(ctx: AppContext) {
    document.querySelector('#inspector-content')!.addEventListener('change', event => {
        const input = event.target as HTMLInputElement, key = input.dataset.sceneRoom;
        if (!key || ctx.busy || ctx.history.pending || ctx.draft) return;
        event.stopPropagation();
        ctx.change(() => {
            if (key === 'enabled') ctx.project.room.enabled = input.checked;
            else if (['width','depth','height'].includes(key)) ctx.project.room[key as 'width'] = Number(input.value);
        },false);
    });
    return { render() {
        return `<section class="inspector-parameter-group"><h3>场景空间</h3><div class="scene-room-fields"><label class="check"><input data-scene-room="enabled" type="checkbox" ${ctx.project.room.enabled?'checked':''}/>显示房间结构</label><div class="triple">${(['width','depth','height'] as const).map((key,i)=>`<label class="field"><span>${['宽度','进深','净高'][i]} / 米</span><input data-scene-room="${key}" type="number" min="2.3" step=".1" value="${ctx.project.room[key]}"/></label>`).join('')}</div>${button('spatial-open','空间检查','','wide subtle')}</div></section>`;
    } };
}
