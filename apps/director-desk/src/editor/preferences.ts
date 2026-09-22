export const preferenceDefaults = {
    navigationSpeed: 3, navigationBoost: 3.333333, rotationSpeed: 1, zoomSpeed: 1, panSpeed: 1,
    viewDamping: true, gizmoSize: .78, showNavigationHint: true,
};
export type EditorPreferences = typeof preferenceDefaults;
export type PreferenceKey = keyof EditorPreferences;
export const preferenceRanges: Partial<Record<PreferenceKey,[number,number]>> = {
    navigationSpeed:[.2,30],navigationBoost:[1,10],rotationSpeed:[.1,3],zoomSpeed:[.1,3],panSpeed:[.1,3],gizmoSize:[.3,2],
};
const storageKey='director-editor-preferences-v1';
const values = {...preferenceDefaults};
const listeners = new Set<()=>void>();
function valid(key: PreferenceKey,value: unknown) {
    if (typeof preferenceDefaults[key]==='boolean') return typeof value==='boolean';
    const range=preferenceRanges[key]!;
    return typeof value==='number' && Number.isFinite(value) && value>=range[0] && value<=range[1];
}
try {
    const saved=JSON.parse(globalThis.localStorage?.getItem(storageKey)??'{}');
    for(const key of Object.keys(preferenceDefaults) as PreferenceKey[]) if(valid(key,saved?.[key])) Object.assign(values,{[key]:saved[key]});
} catch { /* Missing or invalid local preferences retain defaults. */ }
function publish() {
    try { globalThis.localStorage?.setItem(storageKey,JSON.stringify(values)); } catch { /* Current-session preferences still apply. */ }
    listeners.forEach(listener=>listener());
}
export const editorPreferences = {
    get current(): Readonly<EditorPreferences> { return values; },
    set(key: PreferenceKey,value: unknown) { if(!Object.hasOwn(preferenceDefaults,key)||!valid(key,value))return false; Object.assign(values,{[key]:value});publish();return true; },
    reset() { Object.assign(values,preferenceDefaults);publish(); },
    subscribe(listener:()=>void) { listeners.add(listener);return ()=>listeners.delete(listener); },
};
