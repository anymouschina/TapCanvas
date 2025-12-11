<script setup lang="ts">
import { NSplit } from 'naive-ui';
import WebCutProvider from '../provider/index.vue';
import WebCutPlayerScreen from '../player/screen.vue';
import WebCutPlayerButton from '../player/button.vue';
import WebCutManager from '../manager/index.vue';
import { useWebCutContext, useWebCutPlayer, useWebCutThemeColors, useWebCutDarkMode } from '../../hooks';
import ThemeSwitch from '../theme-switch/index.vue';
import LangSwitch from '../lang-switch/index.vue';
import WebCutSelectAspectRatio from '../select-aspect-ratio/index.vue';
import WebCutTimeClock from '../time-clock/index.vue';
import WebCutLibrary from '../library/index.vue';
import { ref } from 'vue';
import Panel from '../panel/index.vue';
import ExportButton from '../export-button/index.vue';
import { WebCutColors } from '../../types';
import { useWebCutLocale } from '../../hooks/i18n';

const darkMode = defineModel<boolean | null | undefined>('darkMode', { default: null });
const language = defineModel<string | null | undefined>('language', { default: null });
const props = defineProps<{
    projectId?: string;
    colors?: Partial<WebCutColors>;
    /** 是否禁用顶部右侧栏 */
    disableTopRightBar?: boolean;
}>();

useWebCutContext(() => props.projectId ? { id: props.projectId } : undefined);
useWebCutThemeColors(() => props.colors);
useWebCutDarkMode(darkMode);
useWebCutLocale(language);

const { resize } = useWebCutPlayer();

const manager = ref();
function handleResized() {
    manager.value?.resizeHeight();
}
</script>

<template>
    <WebCutProvider>
        <slot name="header"></slot>
        <div class="webcut-editor">
            <n-split direction="vertical" :default-size="0.8" min="400px" :max="0.8" @update:size="handleResized">
                <template #1>
                    <n-split default-size="300px" min="200px" max="400px" @update:size="resize">
                        <template #1>
                            <div class="webcut-editor-left-side">
                                <WebCutLibrary></WebCutLibrary>
                            </div>
                        </template>
                        <template #2>
                            <n-split :default-size="0.75" :min="0.6" :max="0.75" @update:size="resize">
                                <template #1>
                                    <div class="webcut-editor-video-player-container">
                                        <WebCutPlayerScreen class="webcut-editor-video-player"></WebCutPlayerScreen>
                                    </div>
                                    <div class="webcut-editor-video-player-buttons">
                                        <div class="webcut-editor-video-player-buttons-left">
                                            <WebCutTimeClock></WebCutTimeClock>
                                        </div>
                                        <WebCutPlayerButton></WebCutPlayerButton>
                                        <div class="webcut-editor-video-player-buttons-right">
                                            <WebCutSelectAspectRatio display-aspect></WebCutSelectAspectRatio>
                                        </div>
                                    </div>
                                </template>
                                <template #2>
                                    <div class="webcut-editor-right-side">
                                        <div class="webcut-editor-right-side-top-bar" v-if="!props.disableTopRightBar">
                                            <ThemeSwitch></ThemeSwitch>
                                            <span style="margin: auto;"></span>
                                            <LangSwitch></LangSwitch>
                                            <ExportButton></ExportButton>
                                        </div>
                                        <div class="webcut-editor-right-side-main">
                                            <Panel></Panel>
                                        </div>
                                    </div>
                                </template>
                                <template #resize-trigger>
                                    <div class="webcut-editor-split-resize-trigger--vertical"></div>
                                </template>
                            </n-split>
                        </template>
                        <template #resize-trigger>
                            <div class="webcut-editor-split-resize-trigger--vertical"></div>
                        </template>
                    </n-split>
                </template>
                <template #2>
                    <div class="webcut-editor-bottom-side">
                        <WebCutManager ref="manager" />
                    </div>
                </template>
                <template #resize-trigger>
                    <div class="webcut-editor-split-resize-trigger--horizontal"></div>
                </template>
            </n-split>
        </div>
        <slot name="footer"></slot>
    </WebCutProvider>
</template>

<style scoped lang="less">
.webcut-editor {
    position: relative;
    height: 100%;
    width: 100%;
}
.webcut-editor-split-resize-trigger--horizontal {
    width: 100%;
    height: 2px;
    background-color: var(--webcut-line-color);
}
.webcut-editor-split-resize-trigger--vertical {
    height: 100%;
    width: 2px;
    background-color: var(--webcut-line-color);
}
.webcut-editor-video-player-container {
    height: calc(100% - 56px);
    width: calc(100% - 32px);
    margin: 16px;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
}
.webcut-editor-video-player {
    height: 100%;
    width: 100%;
}
.webcut-editor-video-player-buttons {
    height: 24px;
    width: calc(100% - 32px);
    margin: 8px 16px;
    margin-top: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
}
.webcut-editor-video-player-buttons-right,
.webcut-editor-video-player-buttons-left {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    opacity: .6;
}
.webcut-editor-video-player-buttons-right {
    right: 0;
}
.webcut-editor-video-player-buttons-left {
    left: 0;
}
.webcut-editor-right-side {
    height: 100%;
    display: flex;
    flex-direction: column;
}
.webcut-editor-right-side-top-bar {
    display: flex;
    flex-direction: row;
    gap: 8px;
    align-items: center;
    justify-content: space-between;
    padding: 4px;
    border-bottom: 1px solid var(--webcut-line-color);
}
.webcut-editor-right-side-main {
    flex: 1;
    overflow: auto;
}
.webcut-editor-bottom-side {
    height: 100%;
}
.webcut-editor-left-side {
    height: 100%;
    overflow: hidden;
}
.webcut-editor-right-side-top-bar-export-button {
    height: 18px;
    font-size: .7em;
}
</style>