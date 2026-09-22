export const $ = <E extends HTMLElement = HTMLInputElement>(s: string) => document.querySelector<E>(s)!;
export const escape = (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const paths: Record<string, string> = { arrowLeft:'M19 12H5 M11 6l-6 6 6 6', zoomIn:'M16 16l5 5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M7 10h6 M10 7v6', zoomOut:'M16 16l5 5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M7 10h6', chevronDown:'M6 9l6 6 6-6', settings:'M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6', camera: 'M3 6h12v12H3z M15 10l6-3v10l-6-3', play: 'M7 4l13 8-13 8z', pause: 'M8 5v14 M16 5v14', move: 'M12 2v20 M2 12h20 M8 6l4-4 4 4 M8 18l4 4 4-4 M6 8l-4 4 4 4 M18 8l4 4-4 4', rotate: 'M20 8a9 9 0 1 0 1 8 M20 2v6h-6', scale: 'M3 15v6h6 M21 9V3h-6 M3 21l7-7 M21 3l-7 7', select: 'M4 3l6 18 3-8 8-3z', plus: 'M12 4v16 M4 12h16', save: 'M5 3h12l4 4v14H3V3z M7 3v7h10V3 M7 21v-7h10v7', folder: 'M3 6h7l2 3h9v11H3z', undo: 'M8 4L3 9l5 5 M3 9h12a5 5 0 0 1 0 10', redo: 'M16 4l5 5-5 5 M21 9H9a5 5 0 0 0 0 10', download: 'M12 3v12 M7 10l5 5 5-5 M3 16v5h18v-5', close: 'M5 5l14 14 M19 5L5 19', eye: 'M2 12q10-15 20 0-10 15-20 0 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6', trash: 'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7', copy: 'M8 8h13v13H8z M16 8V3H3v13h5', search: 'M16 16l5 5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14', home: 'M3 11l9-8 9 8 M5 10v11h14V10', grid: 'M3 3h18v18H3z M9 3v18 M15 3v18 M3 9h18 M3 15h18', step: 'M5 5l10 7-10 7z M19 5v14', back: 'M19 5L9 12l10 7z M5 5v14', image: 'M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 5 M16 7h.01', info: 'M12 16v-5 M12 7h.01 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20' };
export const icon = (name: string) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] ?? paths.camera}"/></svg>`;
export const button = (act: string, label: string, ico = '', classes = '', extra = '') => `<button type="button" data-act="${act}" class="${classes}" ${extra}>${ico ? icon(ico) : ''}${label}</button>`;
export const options = (values: Array<[
    string,
    string
]>, selected: string) => values.map(([v, l]) => `<option value="${escape(v)}" ${v === selected ? 'selected' : ''}>${escape(l)}</option>`).join('');
export const field = (label: string, key: string, value: string | number, extra = '') => `<label class="field"><span>${label}</span><input data-field="${key}" value="${escape(value)}" ${extra}/></label>`;
export const num = (label: string, key: string, value: number, step = '.01', extra = '') => field(label, key, Number(value.toFixed(3)), `type="number" step="${step}" ${extra}`);
export const select = (label: string, key: string, values: Array<[
    string,
    string
]>, value: string) => `<label class="field"><span>${label}</span><select data-field="${key}">${options(values, value)}</select></label>`;
