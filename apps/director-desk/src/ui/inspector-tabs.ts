export interface InspectorCategory { key: string; label: string; members: string[] }
const categories: InspectorCategory[] = [
    {key:'base',label:'属性',members:['base','structure','rig','visual']},
    {key:'camera',label:'镜头',members:['camera']},
    {key:'light',label:'照明',members:['light']},
    {key:'actions',label:'动作',members:['actions','retarget','pose']},
    {key:'path',label:'走位',members:['path','effects']},
    {key:'surface',label:'外观',members:['surface','deform']},
    {key:'hand',label:'绑定',members:['hand','contacts']},
];
export function inspectorCategories(tabs: string[][]) {
    return categories.map(group => ({...group,label:group.key==='path' && tabs.some(([key])=>key==='camera')?'运镜':group.label,members:group.members.filter(key=>tabs.some(([tab])=>key===tab))})).filter(group=>group.members.length);
}
export function inspectorTabs(groups: InspectorCategory[], current: string) {
    return groups.map(group=>`<button data-inspect="${group.members[0]}" class="${group.members.includes(current)?'active':''}">${group.label}</button>`).join('');
}
