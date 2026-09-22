type Boundary = 'sidebar' | 'inspector' | 'timeline' | 'split';
type Layout = Record<Boundary, number>;
const defaults: Layout = { sidebar: 228, inspector: 320, timeline: 210, split: 51.2 };
const storageKey = 'director-layout-v1';

export function bindResizableLayout() {
    const root = document.documentElement;
    let layout = { ...defaults };
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
        for (const key of Object.keys(defaults) as Boundary[]) if (Number.isFinite(saved[key])) layout[key] = saved[key];
    } catch { /* Layout is optional; project data uses a separate store. */ }
    const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(x, Math.max(low, high)));
    const limits = (key: Boundary): [number, number] => {
        const width = document.querySelector('.workspace')!.clientWidth;
        if (key === 'sidebar') return [180, Math.min(500, width - layout.inspector - 420)];
        if (key === 'inspector') return [260, Math.min(520, width - layout.sidebar - 420)];
        if (key === 'timeline') return [150, document.querySelector('#app')!.clientHeight - 89 - 420];
        return [20, 80];
    };
    const apply = () => {
        for (const key of Object.keys(defaults) as Boundary[]) layout[key] = clamp(layout[key], ...limits(key));
        root.style.setProperty('--sidebar-width', layout.sidebar + 'px');
        root.style.setProperty('--inspector-width', layout.inspector + 'px');
        root.style.setProperty('--timeline-height', layout.timeline + 'px');
        root.style.setProperty('--stage-share', String(layout.split));
        root.style.setProperty('--shot-share', String(100 - layout.split));
        document.querySelectorAll<HTMLElement>('[data-boundary]').forEach(el => {
            const key = el.dataset.boundary as Boundary, [min, max] = limits(key);
            el.setAttribute('aria-valuenow', String(Math.round(layout[key])));
            el.setAttribute('aria-valuemin', String(min)); el.setAttribute('aria-valuemax', String(max));
        });
    };
    const save = () => { try { localStorage.setItem(storageKey, JSON.stringify(layout)); } catch { } };
    const boundaries: [Boundary, string, string][] = [
        ['sidebar', '.sidebar', '左侧资源栏宽度'], ['inspector', '.inspector', '右侧属性栏宽度'],
        ['timeline', '.timeline', '时间轴高度'], ['split', '.stage-panel', '布景与拍摄画面比例']
    ];
    for (const [key, parent, label] of boundaries) {
        const handle = document.createElement('div');
        handle.className = 'layout-boundary boundary-' + key; handle.dataset.boundary = key;
        handle.tabIndex = 0; handle.setAttribute('role', 'separator'); handle.setAttribute('aria-label', label);
        handle.setAttribute('aria-orientation', key === 'timeline' ? 'horizontal' : 'vertical');
        handle.title = `拖动调整${label} · 双击复位 · 方向键微调`;
        document.querySelector(parent)!.append(handle);
        handle.addEventListener('dblclick', () => { layout[key] = defaults[key]; apply(); save(); });
        handle.addEventListener('keydown', event => {
            const step = key === 'split' ? 2 : 10;
            if (['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home'].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                const grow = key === 'inspector' ? ['ArrowLeft', 'ArrowUp'] : ['ArrowRight', 'ArrowUp'];
                layout[key] = event.key === 'Home' ? defaults[key] : layout[key] + (grow.includes(event.key) ? step : -step);
                apply(); save();
            }
        });
        handle.addEventListener('pointerdown', event => {
            if (event.button !== 0) return;
            event.preventDefault(); event.stopPropagation();
            const original = layout[key], x = event.clientX, y = event.clientY;
            handle.setPointerCapture(event.pointerId); root.classList.add('resizing-layout');
            const move = (ev: PointerEvent) => {
                if (ev.pointerId !== event.pointerId) return;
                const delta = key === 'timeline' ? y - ev.clientY : key === 'inspector' ? x - ev.clientX : key === 'split' ? (ev.clientX - x) / document.querySelector('#viewports')!.clientWidth * 100 : ev.clientX - x;
                layout[key] = original + delta; apply();
            };
            const finish = (ev?: PointerEvent) => {
                if (ev && ev.pointerId !== event.pointerId) return;
                if (!ev || ev.type === 'pointercancel') { layout[key] = original; apply(); }
                handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', finish); handle.removeEventListener('pointercancel', finish);
                window.removeEventListener('blur', cancel);
                if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
                root.classList.remove('resizing-layout'); save();
            };
            const cancel = () => finish();
            handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', finish); handle.addEventListener('pointercancel', finish);
            window.addEventListener('blur', cancel);
        });
    }
    document.querySelector('#reset-layout')!.addEventListener('click', () => { layout = { ...defaults }; apply(); save(); });
    window.addEventListener('resize', apply);
    apply();
}
