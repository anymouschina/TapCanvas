export interface Channel { id: string; name: string; protocol: 'chat' | 'responses' | 'anthropic'; baseUrl: string; model: string; hasKey: boolean; remembered: boolean; stream: boolean; maxTokens: number; maxRounds: number }
export interface DesktopResult<T = unknown> { ok: boolean; data?: T; error?: string }
export interface ConversationSnapshot { sessionId: string; profileId: string; transcript: string }
export interface SkillEntry { id: string; name: string; description: string; version: string; enabled: boolean; builtin: boolean; source: string; files: string[] }
export interface SkillResult { skills?: SkillEntry[]; instructions?: string; files?: string[]; version?: string }
export interface SkillRequest { action: 'list' | 'read' | 'enable' | 'remove' | 'import' | 'github' | 'open' | 'reload'; id?: string; enabled?: boolean; kind?: 'file' | 'folder'; path?: string; url?: string }
export interface AgentEvent { type: string; text?: string; name?: string; status?: string; model?: string; channel?: string; sessionId: string; summary?: unknown; usage?: unknown; timing?: { rounds: number; modelMs: number; toolMs: number; toolCalls: number; totalMs: number; firstTextMs?: number } }
declare global {
    interface Window { directorDesktop?: {
        skills?(data: SkillRequest): Promise<DesktopResult<SkillResult>>;
        files?(action: 'locations' | 'choose' | 'save-project' | 'save-export', data?: unknown): Promise<DesktopResult<{ projects?: string; exports?: string; saved?: boolean; filename?: string }>>;
        onSaveBeforeClose?(callback: () => Promise<boolean>): () => void;
        update(action: 'state' | 'save' | 'check' | 'download' | 'install' | 'page', data?: unknown): Promise<DesktopResult<import('../updates/types.ts').UpdateState>>;
        onUpdate(callback: (state: import('../updates/types.ts').UpdateState) => void): () => void;
        profiles(): Promise<DesktopResult<Channel[]>>;
        conversation(): Promise<DesktopResult<ConversationSnapshot>>;
        newConversation(): Promise<DesktopResult<ConversationSnapshot>>;
        configure(data: Record<string, unknown>): Promise<DesktopResult<Channel[]>>;
        test(id: string): Promise<DesktopResult>;
        run(data: Record<string, unknown>): Promise<DesktopResult>;
        stop(): Promise<DesktopResult>;
        mcp(enabled?: boolean): Promise<DesktopResult<{ enabled: boolean; url?: string; lanEnabled?: boolean; lanUrl?: string; lanIp?: string; lanPort?: number }>>;
        mcpLan(enabled?: boolean): Promise<DesktopResult<{ enabled: boolean; url?: string; lanEnabled?: boolean; lanUrl?: string; lanIp?: string; lanPort?: number }>>;
        copyMcp(client?: 'http' | 'claude-code' | 'claude-desktop' | 'stdio' | { client: string; useLan?: boolean }, useLan?: boolean): Promise<DesktopResult>;
        copyText?(text: string): Promise<DesktopResult>;
        resetMcp(): Promise<DesktopResult<{ enabled: boolean; url?: string; lanEnabled?: boolean; lanUrl?: string; lanIp?: string; lanPort?: number }>>;
        onEvent(callback: (event: AgentEvent) => void): () => void;
        onTool(callback: (name: string, args: Record<string, unknown>) => Promise<unknown>): () => void;
        /** 宿主自定义的导出交付文案；缺省沿用桌面版「默认导出目录」。 */
        exportLabel?: string;
        exportHelp?: string;
    } }
}
