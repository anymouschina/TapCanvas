import { escape } from './common.ts';
export interface InspectorSection { id: string; label: string; html: string }
/** Related fields are displayed together; item selectors still select a point/clip/key. */
export function createInspectorNavigation() {
    let requested: {key:string;section:string}|undefined;
    return {
        select(key: string, section: string) { requested={key,section}; },
        reveal() {
            const target=requested;requested=undefined;if(!target)return;
            queueMicrotask(()=>document.querySelector<HTMLElement>(`[data-section-owner="${CSS.escape(target.key)}"][data-section="${CSS.escape(target.section)}"]`)?.scrollIntoView({block:'nearest'}));
        },
        render(key: string, sections: InspectorSection[]) {
            return sections.map(section => `<section class="inspector-parameter-group" data-section-owner="${escape(key)}" data-section="${section.id}"><h3>${escape(section.label)}</h3><div class="inspector-page">${section.html}</div></section>`).join('');
        },
    };
}
export type InspectorNavigation = ReturnType<typeof createInspectorNavigation>;
