/** Stores window geometry only; conversation and credentials belong to the host. */
export function floatingPanel(panel: HTMLElement, header: HTMLElement, grip: HTMLElement, collapse: HTMLButtonElement, key: string) {
    let state = { x: innerWidth - 420, y: 76, width: 400, height: Math.min(720, innerHeight - 92), collapsed: false };
    try { const saved = JSON.parse(localStorage.getItem(key) || 'null');
        if (saved && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(saved[k])) && typeof saved.collapsed === 'boolean') state = saved;
    } catch { /* Local preferences are optional. */ }
    const save = () => { try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* Keep session layout. */ } };
    function render() {
        state.width = Math.max(Math.min(340, innerWidth - 16), Math.min(innerWidth - 16, state.width));
        state.height = Math.max(Math.min(620, innerHeight - 16), Math.min(innerHeight - 16, state.height));
        const width = state.collapsed ? Math.min(248, innerWidth - 16) : state.width, height = state.collapsed ? 58 : state.height;
        state.x = Math.max(8, Math.min(innerWidth - width - 8, state.x)); state.y = Math.max(8, Math.min(innerHeight - height - 8, state.y));
        Object.assign(panel.style, { left: state.x + 'px', top: state.y + 'px', width: width + 'px', height: height + 'px', right: 'auto', bottom: 'auto' });
        panel.classList.toggle('ai-collapsed', state.collapsed);
        collapse.textContent = state.collapsed ? '＋' : '−'; collapse.setAttribute('aria-expanded', String(!state.collapsed));
        collapse.setAttribute('aria-label', state.collapsed ? '展开导演助手' : '收起导演助手');
        collapse.title = state.collapsed ? '展开，继续对话' : '收起，任务继续运行';
    }
    collapse.onclick = () => { state.collapsed = !state.collapsed; render(); save(); };
    for (const [element, resize] of [[header, false], [grip, true]] as const) {
        let start: { x: number; y: number; state: typeof state; pointer: number } | undefined;
        element.addEventListener('pointerdown', e => {
            if (e.button !== 0 || (e.target as HTMLElement).closest('button,input,select,textarea')) return;
            start = { x: e.clientX, y: e.clientY, state: { ...state }, pointer: e.pointerId };
            element.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
        });
        element.addEventListener('pointermove', e => {
            if (!start || e.pointerId !== start.pointer) return;
            const dx = e.clientX - start.x, dy = e.clientY - start.y;
            if (resize) { state.width = start.state.width + dx; state.height = start.state.height + dy; }
            else { state.x = start.state.x + dx; state.y = start.state.y + dy; }
            render();
        });
        const finish = (cancel = false) => {
            if (!start) return;
            const previous = start; start = undefined;
            if (cancel) state = previous.state;
            if (element.hasPointerCapture(previous.pointer)) element.releasePointerCapture(previous.pointer);
            render(); save();
        };
        element.addEventListener('pointerup', () => finish()); element.addEventListener('pointercancel', () => finish(true));
        window.addEventListener('blur', () => finish(true));
    }
    grip.ondblclick = () => { state.width = 400; state.height = 720; render(); save(); };
    grip.onkeydown = e => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Home') { state.width = 400; state.height = 720; }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') state.width += e.key === 'ArrowLeft' ? -16 : 16;
        else state.height += e.key === 'ArrowUp' ? -16 : 16;
        render(); save();
    };
    window.addEventListener('resize', render); render();
    return { refresh: render };
}
