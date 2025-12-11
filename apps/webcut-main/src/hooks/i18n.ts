// 简化版国际化支持
// 移除了对 vue-i18n 的依赖，只保留基本功能
// 中文作为默认语言，直接使用 key 作为显示内容，无需翻译
// 只保留英文翻译包，当语言不支持时自动使用 key（中文原文）

import { computed, inject, ref, provide, type WritableComputedRef, type ModelRef } from 'vue';
import enUS from '../locales/en-US';
import frFR from '../locales/fr-FR';
import jaJP from '../locales/ja-JP';
import deDE from '../locales/de-DE';
import esES from '../locales/es-ES';
import zhHK from '../locales/zh-HK';
import zhTW from '../locales/zh-TW';
import { useWebCutContext } from '.';

// 语言包映射
const langPkgs: Record<string, Record<string, string>> = {
  'en-US': enUS,
  'en': enUS,
  'fr-FR': frFR,
  'fr': frFR,
  'ja-JP': jaJP,
  'ja': jaJP,
  'de-DE': deDE,
  'de': deDE,
  'es-ES': esES,
  'es': esES,
  'zh-HK': zhHK,
  'zh-TW': zhTW,
};

/**
 * 获取语言包
 */
function getLangPkg(lang?: string): Record<string, string> | null {
  const language = lang || navigator.language || 'zh-CN';

  // 如果是简体中文，返回 null，表示使用 key 作为显示内容
// 香港繁体和台湾繁体返回对应的语言包
if (language === 'zh-CN' || (language === 'zh' && !language.startsWith('zh-HK') && !language.startsWith('zh-TW'))) {
  return null;
}

  // 尝试精确匹配
  if (langPkgs[language]) {
    return langPkgs[language];
  }

  // 尝试匹配语言前缀（如 en-US -> en）
  const langPrefix = language.split('-')[0];
  if (langPkgs[langPrefix]) {
    return langPkgs[langPrefix];
  }

  // 不支持的语言，返回 null，使用 key 作为显示内容
  return null;
}

export function useWebCutLocale(language?: ModelRef<string | null | undefined>) {
    const { id } = useWebCutContext();
    const parentLanguage = inject<ModelRef<string | null | undefined> | WritableComputedRef<string | null | undefined> | null>('WEBCUT_LANGUAGE', null);
    const cachedLanguage = computed(() => localStorage.getItem('WEBCUT_LANGUAGE:' + id.value));
    const languageState = ref<string>();
    const currentLanguage = computed({
        get: () => {
            // 受控模式
            if (language?.value !== null && language?.value !== undefined) {
                return language.value;
            }

            // 覆盖模式
            if (parentLanguage?.value !== null && parentLanguage?.value !== undefined) {
                return parentLanguage.value;
            }

            // 非受控模式
            if (languageState.value) {
                return languageState.value;
            }
            if (cachedLanguage.value) {
                return cachedLanguage.value;
            }
            return navigator.language || 'zh-CN';
        },
        set: (v) => {
            // 受控模式
            if (language?.value !== null && language?.value !== undefined) {
                language.value = v;
                return;
            }

            // 覆盖模式
            if (parentLanguage?.value !== null && parentLanguage?.value !== undefined) {
                parentLanguage.value = v;
                return;
            }

            // 非受控模式
            localStorage.setItem('WEBCUT_LANGUAGE:' + id.value, v);
            languageState.value = v;
        },
    });

    provide('WEBCUT_LANGUAGE', currentLanguage);

    return {
        locale: currentLanguage,
        provide: () => provide('WEBCUT_LANGUAGE', currentLanguage),
    };
}

/**
 * 简化版翻译函数
 * @param key 翻译键
 * @param args 插值参数
 * @returns 翻译后的文本
 */
export function useT() {
  const { locale } = useWebCutLocale();
  return (key: string, args?: any): string => {
    if (!key) {
      return '';
    }

    const lngPkg = getLangPkg(locale.value);

    const parse = (result: string) => {
      // 简单的插值替换
      if (args && typeof args === 'object') {
        Object.keys(args).forEach(argKey => {
          result = result.replace(new RegExp(`\\{${argKey}\\}`, 'g'), String(args[argKey]));
        });
      }
      return result;
    };

    // 获取翻译文本，如果没有找到则返回原始key（中文原文）
    let result = lngPkg?.[key] || key;
    result = parse(result);
    return result;
  };
}

