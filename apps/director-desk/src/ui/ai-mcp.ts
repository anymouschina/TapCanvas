import type { DesktopResult } from '../automation/desktop-types.ts';

/** Client configuration only; every transport uses the same running MCP service. */
export function mountAIMcp(panel: HTMLElement, status: (message: string) => void) {
    const bridge = window.directorDesktop;
    // MCP 服务由桌面版主进程托管；网页嵌入没有该能力，整块置为不可用而不是点了报错。
    if (!bridge?.mcp) {
        panel.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('#ai-mcp input,#ai-mcp select,#ai-mcp button')
            .forEach(control => { control.disabled = true; });
        const state = panel.querySelector<HTMLElement>('#ai-mcp-status');
        if (state) state.textContent = '桌面版提供';
        return () => { /* 无 MCP 状态可刷新 */ };
    }
    const enabled = panel.querySelector<HTMLInputElement>('#ai-mcp-enabled')!;
    const lanEnabled = panel.querySelector<HTMLInputElement>('#ai-mcp-lan-enabled')!;
    const lanRow = panel.querySelector<HTMLElement>('#ai-mcp-lan-row')!;
    const lanStatus = panel.querySelector<HTMLElement>('#ai-mcp-lan-status')!;
    const copy = panel.querySelector<HTMLButtonElement>('#ai-mcp-copy')!;
    const lanCopy = panel.querySelector<HTMLButtonElement>('#ai-mcp-lan-copy')!;
    const reset = panel.querySelector<HTMLButtonElement>('#ai-mcp-reset')!;
    const client = panel.querySelector<HTMLSelectElement>('#ai-mcp-client')!;
    const help = panel.querySelector<HTMLElement>('#ai-mcp-client-help')!;
    const descriptions = {
        http: '适合支持 Streamable HTTP 和请求头认证的本地或局域网 Agent。复制后合并到客户端的 MCP 配置。',
        'claude-code': '适合 Claude Code CLI 与桌面 Code 的本地或局域网会话。配置含 type: http，可合并到 .mcp.json。',
        'claude-desktop': '合并到 Claude Desktop 的 claude_desktop_config.json 后重启客户端。使用软件自带的本地桥接，无需安装 Node.js。不要填到云端远程连接器。',
        stdio: '适合支持 command / args / env 的本地 Agent。软件自带 stdio 桥接，无需另装依赖；保持导演台开启并启用 MCP。',
    };
    type Client = keyof typeof descriptions;
    client.onchange = () => { help.textContent = descriptions[client.value as Client]; };
    client.onchange(new Event('change'));
    const check = <T>(result: DesktopResult<T>) => { if (!result.ok) throw Error(result.error || '操作失败'); return result.data!; };
    const safe = (task: () => Promise<unknown>) => { void task().catch(error => status(error.message)); };
    const refresh = (state: { enabled: boolean; url?: string; lanEnabled?: boolean; lanUrl?: string }) => {
        enabled.checked = state.enabled;
        panel.querySelector('#ai-mcp-status')!.textContent = state.url || '关闭';
        lanEnabled.disabled = !state.enabled;
        lanEnabled.checked = Boolean(state.enabled && state.lanEnabled);
        if (lanRow) lanRow.hidden = !lanEnabled.checked;
        if (lanStatus) lanStatus.textContent = state.lanUrl || '关闭';
        if (lanCopy) {
            lanCopy.hidden = !lanEnabled.checked;
            lanCopy.disabled = !lanEnabled.checked;
        }
        reset.disabled = copy.disabled = !state.enabled;
    };
    enabled.onchange = () => { if (bridge) safe(async () => {
        enabled.disabled = true;
        try { refresh(check(await bridge.mcp(enabled.checked))); }
        catch (error) { refresh(check(await bridge.mcp())); throw error; }
        finally { enabled.disabled = false; }
    }); };
    lanEnabled.onchange = () => { if (bridge) safe(async () => {
        lanEnabled.disabled = true;
        try { refresh(check(await bridge.mcpLan(lanEnabled.checked))); }
        catch (error) { refresh(check(await bridge.mcp())); throw error; }
        finally { lanEnabled.disabled = !enabled.checked; }
    }); };
    reset.onclick = () => {
        if (bridge && confirm('重置后，旧配置将无法发起新调用，需要向客户端重新复制配置。正在执行的调用不会撤销。确定重置？')) safe(async () => {
            reset.disabled = true;
            try { refresh(check(await bridge.resetMcp())); status('访问令牌已重置，地址保持不变。请重新复制连接配置。'); }
            finally { refresh(check(await bridge.mcp())); }
        });
    };
    copy.onclick = () => { if (bridge) safe(async () => {
        check(await bridge.copyMcp(client.value as Client, false));
        status('本机连接配置已复制，包含访问凭据，请只交给要连接的客户端。');
    }); };
    if (lanCopy) {
        lanCopy.onclick = () => { if (bridge) safe(async () => {
            check(await bridge.copyMcp(client.value as Client, true));
            status('局域网连接配置已复制（含局域网 IP），同 WiFi 下的 Agent 可直接填入使用。');
        }); };
    }
    // 初始状态由本区块自己加载：调用方不再把 MCP 与渠道并列 await。
    safe(async () => { refresh(check(await bridge.mcp())); });
}
