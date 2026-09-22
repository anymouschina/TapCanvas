import { actionPickerMarkup } from './action-picker.ts';
import { clipLabel, type Entity } from '../model.ts';
import { button, num, options, select } from './common.ts';
import type { InspectorNavigation } from './inspector-navigation.ts';
import { currentClipSelection } from './clip-controls.ts';

export function createActionInspector(navigation: InspectorNavigation, refresh: () => void) {
    let selected = '', lastTimeline = '';
    document.querySelector('#inspector-content')!.addEventListener('change', event => {
        const input = event.target as HTMLSelectElement;
        if (input.id !== 'basic-clip-choice') return;
        event.stopPropagation(); selected = input.value; refresh();
    });
    return { render(e: Entity, supported: [string, string][], animal: boolean) {
        const timeline = currentClipSelection();
        const timelineKey = timeline?.kind === 'action' ? `${timeline.entityId}:${timeline.id}` : '';
        if (timeline?.kind === 'action' && timeline.entityId === e.id && timelineKey !== lastTimeline) {
            selected = timeline.id; navigation.select(`${e.id}:actions`, 'clips');
        }
        lastTimeline = timelineKey;
        if (!e.clips.some(c => c.id === selected)) selected = e.clips[0]?.id ?? '';
        const clip = e.clips.find(c => c.id === selected);
        const presets = actionPickerMarkup(supported);
        const clips = !clip ? '<p class="action-empty">尚无动作，选择上方动作即可添加。</p>' : `<label class="field"><span>动作片段</span><select id="basic-clip-choice">${options(e.clips.map(c => [c.id, `${clipLabel(c)} · ${c.start.toFixed(2)}—${c.end.toFixed(2)} 秒`]), selected)}</select></label><div class="field-pair">${(['start', 'end'] as const).map(key => `<label class="field"><span>${key === 'start' ? '开始' : '结束'} / 秒</span><input data-clip="${clip.id}" data-prop="${key}" type="number" step=".1" min="0" value="${clip[key]}"/></label>`).join('')}</div><div class="clip-speed-row"><label class="field"><span>动作速度</span><input data-clip="${clip.id}" data-prop="speed" type="number" step=".1" min=".1" max="5" value="${clip.speed}"/></label>${button('remove-clip', '移除', 'trash', 'subtle', `data-id="${clip.id}"`)}</div>`;
        const settings = (animal ? '<p class="panel-help">动物提供静态姿态与路径位移。</p>' : e.kind === 'actor' ? select('脚底贴合表面', 'footContact', [['false', '关闭'], ['true', '开启 · 地面 / 台阶']], String(e.footContact ?? false)) : '')
            + num('基础动作衔接 / 秒', 'actionBlend', e.actionBlend ?? .2, '.05', 'min="0" max="2"');
        return navigation.render(`${e.id}:actions`, [{ id: 'presets', label: '添加动作', html: presets }, { id: 'clips', label: '编辑片段', html: clips }, { id: 'settings', label: '设置', html: settings }]);
    } };
}
