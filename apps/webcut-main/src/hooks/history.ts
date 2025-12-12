import { onMounted, ref } from 'vue';
import { useWebCutContext } from './index';
import { useWebCutPlayer } from './index';
import { HistoryMachine } from '../libs/history-machine';
import { WebCutSourceData, WebCutSource, WebCutSegment, WebCutProjectHistoryState } from '../types';
import { clone, isEqual } from 'ts-fns';

const historyMachines = new Map<string, HistoryMachine>();

export function useWebCutHistory() {
    const { id: projectId, rails, sources, canUndo, canRedo, canRecover, canvas, selected, current, clips, sprites, updateByAspectRatio, loading } = useWebCutContext();
    const { push: pushToPlayer } = useWebCutPlayer();

    // 创建历史记录管理器实例
    let historyMachine = historyMachines.get(projectId.value)!;
    if (!historyMachine) {
        historyMachine = new HistoryMachine(projectId.value);
        historyMachines.set(projectId.value, historyMachine);
    }

    // 历史记录列表与当前指针
    const historyList = ref<Awaited<ReturnType<HistoryMachine['getHistoryList']>>>([]);
    const currentHistoryId = ref<string | null>(null);

    async function refreshHistoryList() {
        await historyMachine.ready();
        historyList.value = await historyMachine.getHistoryList();
        currentHistoryId.value = await historyMachine.getCurrentHistoryId();
        canUndo.value = historyMachine.canUndo();
        canRedo.value = historyMachine.canRedo();
    }

    // 是否有项目状态可以恢复
    const dataToRecover = ref<Awaited<ReturnType<HistoryMachine['init']>> | null>(null);

    // 初始化历史记录
    onMounted(async () => {
        const savedData = await historyMachine.init();
        await historyMachine.ready();
        if (savedData?.state) {
            dataToRecover.value = savedData;
            canRecover.value = true;
            // 恢复一些视频基础配置
            const { aspectRatio } = savedData;
            if (aspectRatio) {
                updateByAspectRatio(aspectRatio);
            }
        }

        await refreshHistoryList();
    });

    // 将source转换为source meta便于存储
    function convertSource(source: WebCutSource): WebCutSourceData {
        return {
            ...source,
            meta: clone(source.meta),
            clip: {
                meta: { ...source.clip.meta },
            },
            sprite: {
                time: { ...source.sprite.time },
                rect: {
                    x: source.sprite.rect.x,
                    y: source.sprite.rect.y,
                    w: source.sprite.rect.w,
                    h: source.sprite.rect.h,
                    angle: source.sprite.rect.angle,
                },
                zIndex: source.sprite.zIndex,
                opacity: source.sprite.opacity,
                flip: source.sprite.flip,
                visible: source.sprite.visible,
                interactable: source.sprite.interactable,
            },
        };
    }

    async function recoverSegment(source: WebCutSourceData, segment: WebCutSegment, railId: string) {
        const { sourceKey } = segment;
        const { type, fileId, url, text, sprite, meta } = source;
        const src = fileId ? `file:${fileId}` : url || text || '';
        await pushToPlayer(type as any, src, {
            id: sourceKey,
            rect: clone(meta.rect), // 使用meta.rect，因为animation可能改变sprite.rect
            time: {
                start: sprite.time.offset,
                duration: sprite.time.duration,
                playbackRate: sprite.time.playbackRate,
            },
            zIndex: sprite.zIndex,
            opacity: sprite.opacity,
            flip: sprite.flip,
            visible: sprite.visible,
            interactable: sprite.interactable,
            audio: clone(meta.audio),
            video: clone(meta.video),
            // TODO text的处理比较复杂，需进一步研究，可能需要从seg上获取
            text: clone(meta.text),
            animation: clone(meta.animation),
            autoFitRect: meta.autoFitRect,
            withRailId: railId,
            withSegmentId: segment.id,
        });
    }

    // 比较两个 source 的属性是否相同（排除 clip 和 sprite 对象本身）
    function isSameSourceData(current: WebCutSource, target: WebCutSourceData): boolean {
        // 比较 sprite 属性
        const currentSprite = current.sprite;
        const targetSprite = target.sprite;

        if (currentSprite.time.offset !== targetSprite.time.offset ||
            currentSprite.time.duration !== targetSprite.time.duration ||
            currentSprite.time.playbackRate !== targetSprite.time.playbackRate) {
            return false;
        }

        if (currentSprite.rect.x !== targetSprite.rect.x ||
            currentSprite.rect.y !== targetSprite.rect.y ||
            currentSprite.rect.w !== targetSprite.rect.w ||
            currentSprite.rect.h !== targetSprite.rect.h ||
            currentSprite.rect.angle !== targetSprite.rect.angle) {
            return false;
        }

        if (currentSprite.zIndex !== targetSprite.zIndex ||
            currentSprite.opacity !== targetSprite.opacity ||
            currentSprite.flip !== targetSprite.flip ||
            currentSprite.visible !== targetSprite.visible ||
            currentSprite.interactable !== targetSprite.interactable) {
            return false;
        }

        // 比较 meta 属性
        if (!isEqual(current.meta, target.meta)) {
            return false;
        }

        // 比较文本内容
        if (current.text !== target.text) {
            return false;
        }

        return true;
    }

    // 更新现有 source 的属性（避免重建）
    function updateSourceProperties(current: WebCutSource, target: WebCutSourceData) {
        const { sprite } = current;
        const targetSprite = target.sprite;

        // 更新 sprite 的 time 属性
        sprite.time.offset = targetSprite.time.offset;
        sprite.time.duration = targetSprite.time.duration;
        sprite.time.playbackRate = targetSprite.time.playbackRate;

        // 更新 sprite 的 rect 属性
        sprite.rect.x = targetSprite.rect.x;
        sprite.rect.y = targetSprite.rect.y;
        sprite.rect.w = targetSprite.rect.w;
        sprite.rect.h = targetSprite.rect.h;
        sprite.rect.angle = targetSprite.rect.angle;

        // 更新 sprite 的其他属性
        sprite.zIndex = targetSprite.zIndex;
        sprite.opacity = targetSprite.opacity;
        sprite.flip = targetSprite.flip;
        sprite.visible = targetSprite.visible;
        sprite.interactable = targetSprite.interactable;

        // 更新 meta 属性
        current.meta = clone(target.meta);
    }

    async function recoverHistory(historyState: WebCutProjectHistoryState) {
        const targetSourcesMap = historyState.sources;
        const currentSourceKeys = new Set(sources.value.keys());
        const targetSourceKeys = new Set(Object.keys(targetSourcesMap));

        // 1. 找出需要删除的 sources（在当前但不在目标中）
        const toDelete = new Set<string>();
        for (const key of currentSourceKeys) {
            if (!targetSourceKeys.has(key)) {
                toDelete.add(key);
            }
        }

        // 2. 找出需要添加的 sources（在目标但不在当前中）
        const toAdd = new Set<string>();
        for (const key of targetSourceKeys) {
            if (!currentSourceKeys.has(key)) {
                toAdd.add(key);
            }
        }

        // 3. 找出可能需要更新的 sources（在两者都存在）
        const toUpdate = new Set<string>();
        for (const key of currentSourceKeys) {
            if (targetSourceKeys.has(key)) {
                toUpdate.add(key);
            }
        }

        // 4. 删除不需要的 sources
        for (const key of toDelete) {
            const source = sources.value.get(key);
            if (source) {
                const { clip, sprite } = source;
                canvas.value?.removeSprite(sprite);
                sprite.destroy();
                clip.destroy();

                const sprIdx = sprites.value.indexOf(sprite);
                if (sprIdx !== -1) {
                    sprites.value.splice(sprIdx, 1);
                }

                const clipIdx = clips.value.indexOf(clip);
                if (clipIdx !== -1) {
                    clips.value.splice(clipIdx, 1);
                }

                sources.value.delete(key);
            }
        }

        // 5. 更新现有的 sources
        for (const key of toUpdate) {
            const current = sources.value.get(key)!;
            const target = targetSourcesMap[key];

            // 如果属性相同，跳过更新
            if (isSameSourceData(current, target)) {
                continue;
            }

            // 对于文本类型，如果文本内容或样式变化，需要重新生成
            if (current.type === 'text' &&
                (current.text !== target.text || !isEqual(current.meta.text, target.meta.text))) {
                // 文本内容变化，需要重建
                toDelete.add(key);
                toAdd.add(key);

                // 先删除旧的
                const { clip, sprite } = current;
                canvas.value?.removeSprite(sprite);
                sprite.destroy();
                clip.destroy();

                const sprIdx = sprites.value.indexOf(sprite);
                if (sprIdx !== -1) {
                    sprites.value.splice(sprIdx, 1);
                }

                const clipIdx = clips.value.indexOf(clip);
                if (clipIdx !== -1) {
                    clips.value.splice(clipIdx, 1);
                }

                sources.value.delete(key);
            } else {
                // 非文本或文本内容未变化，只更新属性
                updateSourceProperties(current, target);
            }
        }

        // 6. 添加新的 sources
        for (const rail of historyState.rails) {
            const { segments } = rail;
            for (const seg of segments) {
                const { sourceKey } = seg;
                if (toAdd.has(sourceKey)) {
                    const source = targetSourcesMap[sourceKey];
                    if (source) {
                        await recoverSegment(source, seg, rail.id);
                    }
                }
            }
        }

        // 7. 更新 rails（rails 是轻量级数据，直接替换）
        rails.value = clone(historyState.rails);

        // 8. 清除选中状态
        selected.value = [];
        current.value = null;

        canUndo.value = historyMachine.canUndo();
        canRedo.value = historyMachine.canRedo();
    }

    // 整个组件只能执行一次，避免重复执行
    let isRecovered = false;
    async function recover() {
        loading.value = true;
        try {
            if (isRecovered) {
                return;
            }
            isRecovered = true;

            const projectState = dataToRecover.value;
            if (!projectState) {
                return;
            }

            const { aspectRatio, state } = projectState;
            if (aspectRatio) {
                updateByAspectRatio(aspectRatio);
            }
            await recoverHistory(state);

            dataToRecover.value = null;
            canRecover.value = false;
            canUndo.value = historyMachine.canUndo();
            canRedo.value = historyMachine.canRedo();
            currentHistoryId.value = await historyMachine.getCurrentHistoryId();
        } finally {
            loading.value = false;
        }
    }

    // 撤销操作
    async function undo() {
        loading.value = true;
        try {
            const state = await historyMachine.undo();
            if (!state) {
                return;
            }
            await recoverHistory(state);
            await refreshHistoryList();
        } finally {
            loading.value = false;
        }
    }

    // 重做操作
    async function redo() {
        loading.value = true;
        try {
            const state = await historyMachine.redo();
            if (!state) {
                return;
            }
            await recoverHistory(state);
            await refreshHistoryList();
        } finally {
            loading.value = false;
        }
    }

    // 清除历史记录
    async function clear() {
        await historyMachine.clear();
        await refreshHistoryList();
        canRecover.value = false;
        dataToRecover.value = null;
    }

    async function push() {
        await historyMachine.ready();

        // 如果有项目状态可以恢复，先清除历史记录
        if (canRecover.value) {
            await historyMachine.clear();
        }

        const railsData = clone(rails.value);
        const sourcesData: any = {};
        for (const [key, source] of sources.value.entries()) {
            const meta = convertSource(source);
            sourcesData[key] = meta;
        }
        await historyMachine.push({ rails: railsData, sources: sourcesData });
        await refreshHistoryList();
        canRecover.value = false;
        dataToRecover.value = null;
    }

    // 保存当前进度（手动创建一个历史记录）
    async function saveProgress() {
        await push();
    }

    // 跳转到指定历史记录
    async function jumpTo(historyId: string) {
        loading.value = true;
        try {
            const state = await historyMachine.jumpTo(historyId);
            if (!state) {
                return;
            }
            await recoverHistory(state);
            await refreshHistoryList();
        } finally {
            loading.value = false;
        }
    }

    return {
        push,
        saveProgress,
        undo,
        redo,
        clear,
        canUndo,
        canRedo,
        canRecover,
        recover,
        historyList,
        currentHistoryId,
        refreshHistoryList,
        jumpTo,
    };
}
