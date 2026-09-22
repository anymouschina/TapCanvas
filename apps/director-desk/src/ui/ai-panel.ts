import { mountAIMcp } from './ai-mcp.ts';
import { mountAISelection } from './ai-selection.ts';
import type { AppContext } from '../app-context.ts';
import type { AgentEvent, Channel, DesktopResult, ConversationSnapshot } from '../automation/desktop-types.ts';
import { escape } from './common.ts';
import './ai-panel.css';
import { createAIPanel } from './ai-panel-view.ts';
import { mountAISkills } from './ai-skills-panel.ts';
export function mountAI(ctx: AppContext) {
    const bridge = window.directorDesktop;
    const { panel, find, open } = createAIPanel(Boolean(bridge));
    const scope = mountAISelection(ctx, panel, open);
    find('ai-context').textContent = '默认编辑当前戏段；图片不自动上传。';
    find('ai-new').title = '仅重置 AI 对话，不新建或清空工程';
    find('ai-send').title = '发送任务 · Ctrl / Cmd + Enter';
    find('ai-scene-prompt').onclick = () => { void ctx.act('production-prompt', find('ai-scene-prompt')); };
    find('ai-changes').onclick = () => { open(false); void ctx.act('ai-changes-open', find('ai-changes')); };
    panel.querySelector('#ai-mcp > p')!.textContent = '让外部 Agent 操作当前工程。技能随软件内置，按版本读取，无需另装。';
    let profiles: Channel[] = [], sessionId = '', active = false;
    const status = (text: string) => { find('ai-status').textContent = text; };
    mountAISkills(panel, status);
    const check = <T>(result: DesktopResult<T>) => { if (!result.ok) throw new Error(result.error || '操作失败'); return result.data!; };
    const log = (text: string) => { const box = find<HTMLTextAreaElement>('ai-transcript'); const follow = box.scrollHeight - box.scrollTop - box.clientHeight < 32; box.value += text; if (follow) box.scrollTop = box.scrollHeight; };
    const restoreConversation = (data: ConversationSnapshot) => { sessionId = data.sessionId; find('ai-transcript').value = data.transcript; };
    function refresh() {
        const selected = find('ai-channel').value;
        const options = profiles.map(p => `<option value="${escape(p.id)}">${escape(p.name)} · ${escape(p.model)}</option>`).join('');
        find('ai-channel').innerHTML = options || '<option value="">请先配置渠道</option>';
        if (profiles.some(p => p.id === selected)) find('ai-channel').value = selected;
        find('ai-edit-channel').innerHTML = '<option value="">新建</option>' + options;
    }
    function editing() {
        const p = profiles.find(p => p.id === find('ai-edit-channel').value);
        for (const [id, value] of Object.entries({ 'ai-name': p?.name || '', 'ai-protocol': p?.protocol || 'chat', 'ai-url': p?.baseUrl || 'https://api.deepseek.com/v1', 'ai-model': p?.model || 'deepseek-v4-flash', 'ai-key': '' })) find(id).value = value;
        find('ai-remember').checked = p?.remembered ?? false; find('ai-stream').checked = p?.stream ?? true;
        find('ai-max-tokens').value = String(p?.maxTokens ?? 0); find('ai-max-rounds').value = String(p?.maxRounds ?? 64);
    }
    const safe = (fn: () => Promise<unknown>) => { void fn().catch(e => status(e.message)); };
    find('ai-edit-channel').onchange = editing;
    find('ai-settings').onsubmit = event => { event.preventDefault(); if (!bridge) return; safe(async () => {
        const id = find('ai-edit-channel').value;
        profiles = check(await bridge.configure({ id, name: find('ai-name').value, protocol: find('ai-protocol').value, baseUrl: find('ai-url').value, model: find('ai-model').value,
            key: find('ai-key').value, remember: find('ai-remember').checked, stream: find('ai-stream').checked,
            maxTokens: Number(find('ai-max-tokens').value), maxRounds: Number(find('ai-max-rounds').value) }));
        find('ai-key').value = ''; refresh(); find('ai-channel').value = id || profiles.at(-1)!.id; find('ai-edit-channel').value = find('ai-channel').value; status('渠道已保存；密钥不进入工程。');
    }); };
    find('ai-remove').onclick = () => { if (bridge && find('ai-edit-channel').value) safe(async () => { profiles = check(await bridge.configure({ removeId: find('ai-edit-channel').value })); refresh(); editing(); }); };
    find('ai-test').onclick = () => { if (bridge && !active) safe(async () => { busy(true); try { status('正在进行小规模连通测试…'); check(await bridge.test(find('ai-edit-channel').value || find('ai-channel').value)); status('连通测试通过；工具能力仍需任务验证。'); } finally { busy(false); } }); };
    function busy(value: boolean) { active = value; panel.dataset.running = String(value); find('ai-background-stop').hidden = !value; find('ai-send').disabled = value; find('ai-test').disabled = value; find('ai-stop').disabled = !value; find('ai-channel').disabled = value; find('ai-mode').disabled = value; find('ai-new').disabled = value; }
    find('ai-send').onclick = () => { if (!bridge || active) return; const prompt = find('ai-prompt').value.trim(); if (!prompt) return;
        const profile = profiles.find(p => p.id === find('ai-channel').value); if (!profile) { status('请先保存渠道'); return; }
        busy(true); log('\n你：' + prompt + '\nAI：'); find('ai-prompt').value = '';
        safe(async () => { try { check(await bridge.run({ profileId: profile.id, sessionId, prompt, useSelection: scope.useSelection(), mode: find('ai-mode').value })); }
            catch (error) { if (!find('ai-prompt').value) find('ai-prompt').value = prompt; throw error; }
            finally { scope.endTask(); busy(false); } });
    };
    find('ai-prompt').addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); find<HTMLButtonElement>('ai-send').click(); }
    });
    find('ai-stop').onclick = () => { if (bridge) safe(() => bridge.stop()); };
    find('ai-background-stop').onclick = () => { if (bridge) safe(() => bridge.stop()); };
    find('ai-new').onclick = () => { if (bridge && !active) safe(async () => { busy(true); try { restoreConversation(check(await bridge.newConversation())); status('已手动开始新对话'); } finally { busy(false); } }); };
    find('ai-undo').onclick = () => { if (!active) void ctx.act('undo', document.createElement('button')); else status('请先停止任务，再撤销'); };
    find('ai-channel').onchange = () => { status('已切换渠道，保留当前对话上下文。'); };
    mountAIMcp(panel, status);
    function event(data: AgentEvent) {
        sessionId = data.sessionId;
        if (data.type === 'text') log(data.text || '');
        if (data.type === 'status' || data.type === 'error') status(data.text || '');
        if (data.type === 'tool') { status(`${data.name} · ${data.status}`); if (data.status !== 'running') log(`\n[${data.name}：${data.status}]${data.summary ? JSON.stringify(data.summary) : ''}\n`); }
        if (data.type === 'usage') status('本轮用量：' + JSON.stringify(data.usage));
        if (data.type === 'done') { status('任务完成，可检查场景或撤销一步。' + (data.timing ? ` ${data.timing.rounds} 轮 · 模型 ${(data.timing.modelMs / 1000).toFixed(1)}s · 工具 ${(data.timing.toolMs / 1000).toFixed(1)}s` : '')); busy(false); }
        if (data.type === 'error') { log('\n' + data.text + '\n'); busy(false); }
    }
    bridge?.onEvent(event); if (bridge) safe(async () => {
        // MCP 区块自己负责初始状态：该能力在部分宿主（如网页嵌入）中不存在，
        // 在这里联同渠道一起 await 会让整段初始化跟着失败。
        const channels = await bridge.profiles();
        profiles = check(channels); refresh(); editing();
        const conversation = check(await bridge.conversation()); restoreConversation(conversation);
        if (profiles.some(p => p.id === conversation.profileId)) find('ai-channel').value = conversation.profileId;
        if (conversation.transcript) status('已恢复本机对话，可继续；点击新对话才清空。');
    });
    else panel.querySelectorAll<HTMLButtonElement | HTMLInputElement>('input,select,textarea,button').forEach(e => { if (!['ai-close', 'ai-collapse', 'ai-scene-prompt', 'ai-scope-toggle'].includes(e.id) && !e.dataset.aiView) e.disabled = true; });
}
