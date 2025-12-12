import { WebCutProjectHistoryData, WebCutProjectHistoryState } from '../types';
import { pushProjectHistory, getProjectHistory, clearProjectHistory, moveProjectHistoryTo, getProjectState, updateProjectState } from '../db';
import { aspectRatioMap } from '../constants';

// 历史记录管理器类
export class HistoryMachine {
    private currentHistoryId: string | null = null;
    private currentIndex: number = -1;
    private historyLength: number = 0;

    private projectId: string;
    private isInitializing: boolean = false;
    private isInitialized: boolean = false;
    private isReadyResolve: any = null;
    private isReady = new Promise<{ aspectRatio: keyof typeof aspectRatioMap, state: WebCutProjectHistoryState }>(r => this.isReadyResolve = r);

    constructor(projectId: string) {
        this.projectId = projectId;
    }

    private async updateCurrent(historyId: string | null) {
        this.currentHistoryId = historyId || null;
        const history = await this.getHistoryList();
        this.historyLength = history.length;
        const index = history.findIndex(item => item.id === historyId);
        this.currentIndex = index;
        return history[index];
    }

    private resetCurrent() {
        this.currentHistoryId = null;
        this.currentIndex = -1;
        this.historyLength = 0;
    }

    // 初始化，从数据库加载历史记录，并且在有存储的当前项目状态时，返回该状态
    async init(): Promise<Awaited<typeof this.isReady> | null> {
        if (this.isInitialized || this.isInitializing) {
            return await this.ready();
        }

        this.isInitializing = true;

        let currentHistory: WebCutProjectHistoryData | null = null;
        try {
            const savedState = await getProjectState(this.projectId);
            if (savedState) {
                const { aspectRatio, historyAt } = savedState;
                currentHistory = await this.updateCurrent(historyAt);
                const state = currentHistory.state;
                this.isReadyResolve({
                    aspectRatio,
                    state,
                });
            }
        }
        catch (error) {}

        // 即使失败了，也标记为已初始化
        if (!currentHistory) {
            this.resetCurrent();
            this.isReadyResolve(null);
        }

        this.isInitialized = true;
        return await this.isReady;
    }

    ready() {
        return this.isReady;
    }

    // 获取历史记录列表
    async getHistoryList(): Promise<WebCutProjectHistoryData[]> {
        return await getProjectHistory(this.projectId);
    }

    // 获取历史记录长度
    async getHistoryLength(): Promise<number> {
        await this.ready();
        return this.historyLength;
    }

    // 获取当前历史记录ID
    async getCurrentHistoryId() {
        return this.currentHistoryId;
    }

    // 保存当前状态到历史记录
    async push(state: WebCutProjectHistoryState): Promise<string> {
        await this.ready();
        // 保存到数据库
        const historyId = await pushProjectHistory(this.projectId, state);
        await this.updateCurrent(historyId);
        return historyId!;
    }

    // 跳转到指定历史记录
    async jumpTo(historyId: string): Promise<WebCutProjectHistoryData['state'] | null> {
        await this.ready();
        if (!historyId) {
            return null;
        }

        const history = await this.getHistoryList();
        const target = history.find(item => item.id === historyId);
        if (!target) {
            return null;
        }

        await updateProjectState(this.projectId, { historyAt: historyId });
        await this.updateCurrent(historyId);
        return target.state;
    }

    // 撤销操作
    async undo(): Promise<WebCutProjectHistoryData['state'] | null> {
        await this.ready();

        // 移动历史记录指针
        const historyData = await moveProjectHistoryTo(this.projectId, -1);
        if (!historyData) {
            return null;
        }

        const { id, state } = historyData;
        await this.updateCurrent(id);

        return state;
    }

    // 重做操作
    async redo(): Promise<WebCutProjectHistoryData['state'] | null> {
        await this.ready();

        // 移动历史记录指针
        const historyData = await moveProjectHistoryTo(this.projectId, 1);
        if (!historyData) {
            return null;
        }

        const { id, state } = historyData;
        await this.updateCurrent(id);

        return state;
    }

    // 清除历史记录
    async clear(): Promise<void> {
        await clearProjectHistory(this.projectId);
        this.currentHistoryId = null;
        this.currentIndex = -1;
        this.historyLength = 0;
    }

    // 检查是否可以撤销
    canUndo(): boolean {
        if (!this.isInitialized) {
            return false;
        }
        if (this.historyLength <= 1) {
            return false;
        }
        return this.currentIndex > 0;
    }

    // 检查是否可以重做
    canRedo(): boolean {
        if (!this.isInitialized) {
            return false;
        }
        if (this.historyLength <= 1) {
            return false;
        }

        return this.currentIndex < this.historyLength - 1;
    }
}
