import type { AppContext } from '../app-context.ts';

export function mountFileLocations(ctx: AppContext) {
    const bridge = window.directorDesktop;
    if (!bridge?.files) return;
    const button = document.createElement('button'); button.id = 'file-locations-open'; button.className = 'subtle'; button.textContent = '文件位置';
    document.querySelector('.header-actions')!.prepend(button);
    button.onclick = async () => {
        if (ctx.busy) return;
        const result = await bridge.files!('locations');
        if (!result.ok) { ctx.toast(result.error || '读取目录失败', true); return; }
        ctx.showModal('默认文件位置', `<p class="panel-help">新工程首次保存使用工程目录；视频、截图、提示词和素材包使用导出目录。保存时仍可选择其他位置。</p><div class="native-editor" id="file-locations"><label>默认工程目录<input id="location-projects" readonly/></label><button data-location="projects">选择工程目录…</button><label>默认导出目录<input id="location-exports" readonly/></label><button data-location="exports">选择导出目录…</button><p class="panel-help">设置仅保存在本机，重启后沿用；不会写入工程或分享给 Agent。</p></div>`, '<button data-act="close-modal">完成</button>');
        const root = document.querySelector<HTMLElement>('#file-locations')!;
        const render = (data: { projects?: string; exports?: string }) => {
            for (const key of ['projects','exports'] as const) root.querySelector<HTMLInputElement>('#location-' + key)!.value = data[key] ?? '';
        };
        render(result.data!);
        root.onclick = async event => {
            const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-location]'); if (!target || target.disabled) return;
            const buttons = root.querySelectorAll<HTMLButtonElement>('button'); buttons.forEach(b => b.disabled = true);
            try { const changed = await bridge.files!('choose', target.dataset.location); if (!changed.ok) throw Error(changed.error); if (root.isConnected) render(changed.data!); }
            catch (error) { ctx.toast((error as Error).message, true); }
            finally { buttons.forEach(b => b.disabled = false); }
        };
    };
    bridge.onSaveBeforeClose?.(async () => {
        const saved = await ctx.saveProject();
        if (saved) ctx.busy = true; // Keep edits blocked until the main process closes this window.
        return saved;
    });
}
