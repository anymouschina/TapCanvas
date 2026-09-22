import './application-menu.css';

/** Move existing controls, preserving their handlers, state and unique IDs. */
export function mountApplicationMenu() {
    const bar = document.createElement('nav');
    bar.className = 'application-menu'; bar.setAttribute('aria-label', '应用菜单');
    document.querySelector('.topbar')!.prepend(bar);
    const header = document.querySelector('.header-actions')!;
    const status = document.querySelector<HTMLElement>('#save-status')!;
    status.hidden = false;
    document.querySelector('.statusbar')!.prepend(status);
    for (const [id, label] of [['ai-toggle', 'AI'], ['ai-changes-toggle', 'AI 最新改动']]) {
        const control = document.getElementById(id)!; control.textContent = label; header.append(control);
    }
    for (const id of ['aspect','fps']) header.insertBefore(document.getElementById(id)!,document.getElementById('ai-toggle'));
    for (const action of ['save','export']) {
        const control = document.querySelector<HTMLButtonElement>(`.header-actions [data-act="${action}"]`)!;
        const entry = control.cloneNode(true) as HTMLButtonElement; entry.removeAttribute('id'); entry.dataset.menuCopy=action;
        document.querySelector('.side-bottom')!.append(entry); header.append(control);
        control.textContent = action==='save' ? '保存' : '导出'; control.className=action==='export'?'primary':'subtle';
    }
    const camera = document.querySelector<HTMLElement>('[data-act="add-camera"]')!;
    camera.className='subtle';camera.textContent='添加摄影机'; document.querySelector('.key-tools')!.prepend(camera);
    const mode = document.getElementById('creation-mode')!;
    mode.querySelector('[data-creation-mode="full"]')!.textContent = '精细模型';
    mode.querySelector('[data-creation-mode="geometry"]')!.textContent = '几何体';
    document.querySelector('.sidebar .side-tabs')!.append(mode);
    const definitions: [string, string, [string, string?][]][] = [
        ['file', '文件', [['[data-act="project"]'], ['[data-act="scene-templates"]'], ['[data-act="open"]'], ['[data-menu-copy="save"]'], ['[data-menu-copy="export"]'], ['[data-act="model-import"]'], ['[data-act="user-motion-library"]'], ['[data-act="production-notes"]']]],
        ['edit', '编辑', [['[data-act="undo"]', '撤销'], ['[data-act="redo"]', '重做'], ['#settings-toggle', '设置'], ['#reset-layout', '重置面板布局']]],
        ['scene', '场景', [['[data-act="room"]'], ['[data-act="spatial-open"]']]],
        ['help', '帮助', [['[data-act="help"]', '操作与快捷键'], ['#update-toggle', '检查更新']]],
    ];
    const menus: { trigger: HTMLButtonElement; menu: HTMLDivElement }[] = [];
    for (const [id, title, entries] of definitions) {
        const trigger = document.createElement('button'), menu = document.createElement('div');
        trigger.type = 'button'; trigger.textContent = title; trigger.dataset.menu = id;
        menu.id = `application-menu-${id}`; menu.className = 'application-dropdown'; menu.popover = 'auto';
        menu.setAttribute('aria-label', title); trigger.setAttribute('popovertarget', menu.id);
        trigger.setAttribute('aria-haspopup', 'true'); trigger.setAttribute('aria-expanded', 'false');
        for (const [selector, label] of entries) {
            const control = document.querySelector<HTMLElement>(selector); if (!control) continue;
            if (control instanceof HTMLSelectElement) {
                const row = document.createElement('label'); row.className = 'menu-option';
                const text = document.createElement('span'); text.textContent = label!;
                row.append(text, control); menu.append(row);
            } else {
                if (label) {
                    const svg = control.querySelector('svg');
                    control.replaceChildren(...(svg ? [svg] : []), document.createTextNode(label));
                }
                if (control instanceof HTMLButtonElement) {
                    control.classList.remove('icon-button', 'subtle', 'wide', 'primary'); control.classList.add('menu-command');
                }
                menu.append(control);
            }
        }
        bar.append(trigger); document.body.append(menu); menus.push({ trigger, menu });
        const place = () => {
            if (!menu.matches(':popover-open')) return;
            const r = trigger.getBoundingClientRect();
            menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + 'px';
            menu.style.top = r.bottom + 5 + 'px';
        };
        menu.addEventListener('toggle', () => { trigger.setAttribute('aria-expanded', String(menu.matches(':popover-open'))); place(); });
        menu.addEventListener('click', event => {
            if ((event.target as HTMLElement).closest('button') && menu.matches(':popover-open')) menu.hidePopover();
        });
        trigger.addEventListener('keydown', event => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault(); menu.showPopover(); place(); menu.querySelector<HTMLElement>('button:not(:disabled),select')?.focus();
        });
        menu.addEventListener('keydown', event => {
            if (event.target instanceof HTMLSelectElement || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
            event.preventDefault();
            const items = [...menu.querySelectorAll<HTMLElement>('button:not(:disabled),select')];
            const index = items.indexOf(document.activeElement as HTMLElement);
            items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        });
        window.addEventListener('resize', place);
    }
    bar.addEventListener('pointerover', event => {
        const next = menus.find(m => m.trigger === event.target);
        if (next && menus.some(m => m.menu.matches(':popover-open')) && !next.menu.matches(':popover-open')) next.menu.showPopover();
    });
    const update = document.querySelector('#update-toggle');
    if (update) new MutationObserver(() => {
        bar.querySelector('[data-menu="help"]')?.classList.toggle('has-update', update.classList.contains('has-update'));
    }).observe(update, { attributes: true, attributeFilter: ['class'] });
    document.querySelector('.side-bottom')?.remove();
    document.querySelector('.header-actions .top-separator')?.remove();
}
