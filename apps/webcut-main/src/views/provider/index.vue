<script setup lang="ts">
import { WebCutContext, WebCutColors } from '../../types';
import { useWebCutContext, useWebCutThemeColors, useWebCutDarkMode } from '../../hooks';
import {
    NConfigProvider,
    darkTheme,
    NMessageProvider,
    NLoadingBarProvider,
    NModalProvider,
    NDialogProvider,
    NElement,
    NNotificationProvider,
    zhCN,
    dateZhCN,
    zhTW,
    dateZhTW,
    GlobalThemeOverrides,
} from 'naive-ui';
import { computed, inject, provide } from 'vue';
import { useWebCutLocale } from '../../hooks/i18n';

export interface WebCutProviderProps {
    data?: Partial<WebCutContext>;
    colors?: Partial<WebCutColors>;
}

const darkMode = defineModel<boolean | null>('isDarkMode', { default: null });
const language = defineModel<string | null>('language', { default: null });
const props = defineProps<WebCutProviderProps>();

const { themeColors, provide: provideThemeColors } = useWebCutThemeColors(() => props.colors);
const { provide: provideContext } = useWebCutContext(() => props.data);
const { isDarkMode, provide: provideDarkMode } = useWebCutDarkMode(darkMode);
const { locale: currentLanguage, provide: provideLanguage } = useWebCutLocale(language);

const darkOverrides = computed<GlobalThemeOverrides>  (() => ({
    common: {
        primaryColor: themeColors.value.primaryColor,
        primaryColorHover: themeColors.value.primaryColorHover,
        primaryColorPressed: themeColors.value.primaryColorPressed,
        primaryColorSuppl: themeColors.value.primaryColorSuppl,
    },
    Switch: {
        railColorActive: themeColors.value.primaryColor,
    },
    Message: {
        iconColorSuccess: themeColors.value.primaryColor,
    },
    Select: {
        peers: {
            InternalSelection: {
                textColor: themeColors.value.textColorDark,
                textColorHover: themeColors.value.textColorDarkHover,
            },
        },
    },
    Badge: {
        color: themeColors.value.primaryColorSuppl,
    },
}));
const lightOverrides = computed<GlobalThemeOverrides>(() => ({
    common: {
        primaryColor: themeColors.value.primaryColor,
        primaryColorHover: themeColors.value.primaryColorHover,
        primaryColorPressed: themeColors.value.primaryColorPressed,
        primaryColorSuppl: themeColors.value.primaryColorSuppl,
    },
    Switch: {
        railColorActive: themeColors.value.primaryColor,
    },
    Message: {
        iconColorSuccess: themeColors.value.primaryColor,
    },
    Select: {
        peers: {
            InternalSelection: {
                textColor: themeColors.value.textColor,
                // @ts-ignore
                textColorHover: themeColors.value.textColorHover,
            },
        },
    },
    Badge: {
        color: themeColors.value.primaryColorSuppl,
    },
}));
const theme = computed(() => isDarkMode.value ? darkTheme : undefined);
const overrides = computed(() => isDarkMode.value ? darkOverrides.value : lightOverrides.value);

const lang = computed(() => currentLanguage.value || navigator.language);
const lngPkg = computed(() => {
    if (['zh-HK', 'zh-TW'].includes(lang.value)) {
        return zhTW;
    }
    if (lang.value.indexOf('zh-') === 0) {
        return zhCN;
    }
});
const dateLngPkg = computed(() => {
    if (['zh-HK', 'zh-TW'].includes(lang.value)) {
        return dateZhTW;
    }
    if (lang.value.indexOf('zh-') === 0) {
        return dateZhCN;
    }
});

const isInProvider = inject('WEBCUT_IN_PROVIDER', false);
provide('WEBCUT_IN_PROVIDER', true);
provideContext();
provideThemeColors();
provideDarkMode();
provideLanguage();
</script>

<template>
    <div :class="{ 'webcut-root': !isInProvider, 'webcut-root--inside': isInProvider, [`webcut-root--lang-${lang?.split('-')?.[0]}`]: true }">
        <slot v-if="isInProvider"></slot>
        <n-config-provider :theme="theme" :theme-overrides="overrides" :locale="lngPkg" :date-locale="dateLngPkg" v-else>
            <n-loading-bar-provider>
                <n-modal-provider>
                    <n-dialog-provider>
                        <n-message-provider>
                            <n-element>
                                <n-notification-provider placement="bottom-right">
                                    <div class="webcut-container" :style="{
                                        '--webcut-background-color': isDarkMode ? themeColors.backgroundColorDark : themeColors.backgroundColor,
                                        '--webcut-grey-color': isDarkMode ? themeColors.greyColorDark : themeColors.greyColor,
                                        '--webcut-grey-deep-color': isDarkMode ? themeColors.greyDeepColorDark : themeColors.greyDeepColor,
                                        '--webcut-rail-bg-color': isDarkMode ? themeColors.railBgColorDark : themeColors.railBgColor,
                                        '--webcut-rail-hover-bg-color': isDarkMode ? themeColors.railHoverBgColorDark : themeColors.railHoverBgColor,
                                        '--webcut-line-color': isDarkMode ? themeColors.lineColorDark : themeColors.lineColor,
                                        '--webcut-thumb-color': isDarkMode ? themeColors.thumbColorDark : themeColors.thumbColor,
                                        '--webcut-manager-top-bar-color': isDarkMode ? themeColors.managerTopBarColorDark : themeColors.managerTopBarColor,
                                        '--webcut-close-icon-color': isDarkMode ? themeColors.closeIconColorDark : themeColors.closeIconColor,
                                        '--webcut-font-size-normal': '12px',
                                        '--webcut-font-size-small': '10px',
                                        '--webcut-font-size-tiny': '8px',
                                    }">
                                        <slot></slot>
                                    </div>
                                </n-notification-provider>
                            </n-element>
                        </n-message-provider>
                    </n-dialog-provider>
                </n-modal-provider>
            </n-loading-bar-provider>
        </n-config-provider>
    </div>
</template>

<style scoped>
.webcut-root--inside,
.webcut-root,
.webcut-root :deep(.n-config-provider),
.webcut-root :deep(.n-element) {
    display: contents;
}

.webcut-container {
    flex: 1;
    height: 100%;
    width: 100%;
    color: var(--text-color-base);
    background-color: var(--webcut-background-color);
    font-size: var(--webcut-font-size-normal);
}

.webcut-root :deep(.sprite-rect .ctrl-key-rotate) {
    cursor: url(../../img/rotate.svg) 20 20, crosshair !important;
}

/** override naiveui */

.webcut-root :deep(.n-form) {
  width: 100%;
}
.webcut-root :deep(.n-form .audio-player-wrapper) {
  justify-content: flex-start !important;
}
.webcut-root :deep(.n-form-item .n-input-number) {
  width: 100%;
}
.webcut-root :deep(.n-form-item .n-slider) {
  padding: 0 2px;
}
.webcut-root :deep(.n-form-item .n-form-item-feedback) {
  font-size: .8em;
  margin-bottom: 16px;
}
.webcut-root :deep(.n-form-item .n-input-group) {
  align-items: center;
}
.webcut-root :deep(.n-form-item .n-slider + .n-input-number) {
  width: 260px;
  margin-left: 16px !important;
}
.webcut-root :deep(.n-form-item.n-form-item--left-labelled .n-form-item-label) {
  word-break: break-all;
  white-space: wrap;
  max-width: 140px;
  align-items: center;
}
.webcut-root :deep(.n-form-item--flex-column .n-form-item-blank) {
  flex-direction: column !important;
  align-items: flex-start;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--flex-start .n-form-item-blank) {
  align-items: flex-start;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--flex-column.n-form-item--flex-start .n-form-item-blank) {
  justify-content: flex-start;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--between-space .n-form-item-blank) {
  justify-content: space-between;
}
.webcut-root :deep(.n-form-item--flex-column.n-form-item--flex-end .n-form-item-blank) {
  align-items: flex-end;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--flex-column.n-form-item--flex-end .n-input-group) {
  justify-content: flex-end;
}
.webcut-root :deep(.n-form-item--flex-end .n-form-item-blank) {
  justify-content: flex-end;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--flex-row .n-form-item-blank) {
  gap: 4px;
}
.webcut-root :deep(.n-form-item--flex-row .n-form-item-blank > .n-input-number) {
  flex: 1;
}
.webcut-root :deep(.n-form-item-message) {
  font-size: .8em;
  opacity: .8;
}
.webcut-root :deep(.n-form-item .n-input__input) {
  min-width: 60px;
  flex-grow: 1;
}
.webcut-root :deep(.n-form-item-row) {
  display: flex;
}
.webcut-root :deep(.n-form-item--inline) {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}
.webcut-root :deep(.n-form-item--inline > :first-child) {
  margin-right: auto;
}
.webcut-root :deep(.n-form-item--inline-between-space) {
  justify-content: space-between;
}
.webcut-root :deep(.n-form-item-actions--top-right) {
  position: absolute;
  right: 0;
  bottom: 100%;
  margin-bottom: 8px;
  display: flex;
  gap: 12px;
  align-items: center;
}
.webcut-root :deep(.n-form > .n-button + .n-button) {
  margin-left: 8px;
}
.webcut-root :deep(.n-form-gap > .n-button + .n-button) {
  margin-left: 0;
}
.webcut-root :deep(.n-form-item + .n-divider) {
    margin-top: 0;
}
.webcut-root :deep(.n-form-item--small-size),
.webcut-root :deep(.n-form-item--small-size .n-form-item-label__text) {
  font-size: var(--webcut-font-size-small) !important;
  --n-label-font-size: var(--webcut-font-size-small) !important;
}
.webcut-root :deep(.n-form-item-label__text) {
  word-break: keep-all;
}
.webcut-root--lang-zh :deep(.n-form-item-label__text),
.webcut-root--lang-ja :deep(.n-form-item-label__text),
.webcut-root--lang-kr :deep(.n-form-item-label__text) {
  word-break: break-all;
}
.webcut-root :deep(.n-color-picker-trigger__value) {
    opacity: 0;
}

.webcut-root :deep(.webcut-panel-form),
.webcut-root :deep(.webcut-panel-form .n-base-selection-input__content),
.webcut-root :deep(.webcut-panel-form .n-collapse-item__header-main),
.webcut-root :deep(.n-radio-button .n-radio__label),
.webcut-root :deep(.n-alert-body__content) {
    font-size: var(--webcut-font-size-normal) !important;
}
.webcut-root :deep(.n-form-item--small-size .n-button),
.webcut-root :deep(.n-form-item--small-size .n-input__textarea-el) {
    font-size: var(--webcut-font-size-small);
}
.webcut-root :deep(.n-form-item--small-size .n-form-item-feedback) {
  font-size: var(--webcut-font-size-tiny);
}
.webcut-root :deep(.webcut-tool-button) {
    padding: 0;
    width: 24px;
    height: 24px;
}

:global(.webcut-tooltip) {
  padding: 4px 8px !important;
}
</style>