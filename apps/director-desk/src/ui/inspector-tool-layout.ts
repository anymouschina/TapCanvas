import { escape } from './common.ts';

/** Keep settings beside the viewport and their actions in the inspector's always-visible footer. */
export function inspectorToolLayout(html: string) {
    let footer = '', help = '';
    const body = html.replace(/<button\b[^>]*data-act="(?:cinema|lighting)-[^>]*>[\s\S]*?<\/button>/g, button => { footer += button; return ''; })
        .replace(/<p>([\s\S]*?)<\/p>/g, (_match, text: string) => { help += text + ' '; return ''; })
        .replace(/<div class="cinema-pair">\s*<\/div>/g, '');
    return { body, footer, help: help ? `<span class="cinema-help" tabindex="0" title="${escape(help.trim())}" aria-label="${escape(help.trim())}">ⓘ</span>` : '' };
}
