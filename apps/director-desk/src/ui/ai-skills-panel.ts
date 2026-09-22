import type { DesktopResult, SkillEntry, SkillResult, SkillRequest } from '../automation/desktop-types.ts';
import { escape } from './common.ts';
import './ai-skills-panel.css';

export function mountAISkills(panel: HTMLElement, status: (message: string) => void) {
    const section = panel.querySelector<HTMLElement>('#ai-skills')!;
    const bridge = window.directorDesktop;
    section.innerHTML = `<div class="skill-import-buttons"><button data-skill-import="file">导入文件</button><button data-skill-import="folder">导入文件夹</button></div>
<div class="skill-download"><input id="skill-url" type="url" aria-label="GitHub 技能链接" placeholder="GitHub 技能目录链接"/><button id="skill-download">下载</button></div>
<label>已安装技能<select id="skill-select" aria-label="已安装技能"></select></label>
<textarea id="skill-meta" readonly aria-label="技能来源和简介"></textarea>
<div class="skill-actions"><label class="ai-check"><input id="skill-enabled" type="checkbox"/>启用</label><button id="skill-reload">重新加载</button><button id="skill-folder">打开目录</button><button id="skill-remove">移除</button></div>
<label>技能说明与附件<select id="skill-file" aria-label="技能文件"></select></label>
<textarea id="skill-content" readonly aria-label="技能说明内容" placeholder="选择技能后查看说明。"></textarea>
<p>带附件的技能请导入整个文件夹。修改目录后点重新加载；停用从下一次任务生效，已有对话保留。附属脚本保留在包内，当前助手不会执行脚本。</p>`;
    const find = <T extends HTMLElement = HTMLInputElement>(id: string) => section.querySelector<T>('#' + id)!;
    let entries: SkillEntry[] = [], working = false, reading = 0;
    const selected = () => entries.find(e => e.id === find('skill-select').value);
    const check = (result: DesktopResult<SkillResult>) => { if (!result.ok) throw Error(result.error || '技能操作失败'); return result.data!; };
    function disabled() {
        const blocked = working || !bridge?.skills || panel.dataset.running === 'true';
        section.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button,input').forEach(node => node.disabled = blocked);
        const entry = selected();
        for (const id of ['skill-reload', 'skill-folder', 'skill-remove']) find<HTMLButtonElement>(id).disabled = blocked || !entry || entry.builtin;
        find('skill-enabled').disabled = blocked || !entry;
    }
    const observer = new MutationObserver(disabled); observer.observe(panel, { attributes: true, attributeFilter: ['data-running'] });
    async function read() {
        const entry = selected(), request = ++reading; if (!entry || !bridge?.skills) return;
        find('skill-content').value = '正在读取…';
        try {
            const data = check(await bridge.skills({ action: 'read', id: entry.id, path: find('skill-file').value || undefined }));
            if (request === reading) find('skill-content').value = data.instructions || '';
        } catch (error) { if (request === reading) find('skill-content').value = (error as Error).message; }
    }
    function show() {
        const entry = selected();
        find('skill-enabled').checked = entry?.enabled ?? false;
        find('skill-meta').value = entry ? `${entry.builtin ? '内置' : '自定义'} · ${entry.version} · ${entry.source}\n${entry.description}` : '还没有技能';
        find('skill-reload').textContent = entry?.source.startsWith('https://github.com/') ? '更新' : '重新加载';
        find('skill-file').innerHTML = (entry?.files || []).map(file => `<option value="${escape(file)}">${escape(file)}</option>`).join('');
        const main = entry?.files.find(file => file.toLowerCase() === 'skill.md'); if (main) find('skill-file').value = main;
        disabled(); void read();
    }
    function refresh(data: SkillResult, prefer?: string) {
        const id = prefer || find('skill-select').value; entries = data.skills || [];
        find('skill-select').innerHTML = entries.map(entry => `<option value="${escape(entry.id)}">${entry.enabled ? '●' : '○'} ${escape(entry.name)}</option>`).join('');
        if (entries.some(entry => entry.id === id)) find('skill-select').value = id;
        show();
    }
    async function run(data: SkillRequest) {
        if (!bridge?.skills || working) return;
        working = true; disabled(); status('正在处理技能…');
        try {
            const previous = new Set(entries.map(e => e.id)), result = check(await bridge.skills(data));
            refresh(result, result.skills?.find(e => !previous.has(e.id))?.id);
            status(data.action === 'enable' ? '技能开关已保存，从下一次任务生效；对话历史保留。' : '技能操作完成。');
        } catch (error) { status((error as Error).message); find('skill-enabled').checked = selected()?.enabled ?? false; }
        finally { working = false; disabled(); }
    }
    section.querySelectorAll<HTMLElement>('[data-skill-import]').forEach(button => button.onclick = () => { void run({ action: 'import', kind: button.dataset.skillImport as 'file' | 'folder' }); });
    find('skill-download').onclick = () => { const url = find('skill-url').value.trim(); if (url) void run({ action: 'github', url }); else status('请粘贴包含 SKILL.md 的 GitHub 技能目录链接'); };
    find('skill-select').onchange = show; find('skill-file').onchange = () => { void read(); };
    find('skill-enabled').onchange = () => { const entry = selected(); if (entry) void run({ action: 'enable', id: entry.id, enabled: find('skill-enabled').checked }); };
    find('skill-reload').onclick = () => { const entry = selected(); if (entry) void run(entry.source.startsWith('https://github.com/') ? { action: 'github', id: entry.id, url: entry.source } : { action: 'reload', id: entry.id }); };
    find('skill-folder').onclick = () => { const entry = selected(); if (entry) void run({ action: 'open', id: entry.id }); };
    find('skill-remove').onclick = () => { const entry = selected(); if (entry) void run({ action: 'remove', id: entry.id }); };
    if (bridge?.skills) void bridge.skills({ action: 'list' }).then(result => refresh(check(result))).catch(error => status(error.message));
    else { find('skill-content').value = '自定义技能管理在桌面版使用。网页版可导入外部 AI 按技能生成的工程。'; disabled(); }
}
