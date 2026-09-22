import type { ProductionData, ProductionNote, Project } from '../model.ts';
export function productionData(project: Project): ProductionData { return project.production ?? { fixedPrompt: '', sceneReferenceIds: [], notes: [] }; }
export function notesText(project: Project): string {
    const data = productionData(project);
    return [`${project.name} · 剧情与表演备注`, `${project.duration} 秒 · ${project.aspect} · ${project.fps} fps`, '',
        ...[...data.notes].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)).flatMap(note => [
            `[${note.start.toFixed(3)}—${note.end.toFixed(3)} 秒]${note.end > project.duration ? '（部分或全部超出成片时长）' : ''}`,
            `人物：${project.entities.find(e => e.id === note.actorId)?.name ?? '未指定'}`,
            ...(['story', 'emotion', 'action', 'dialogue'] as const).filter(key => note[key]).map(key => `${({ story: '剧情', emotion: '情绪', action: '动作', dialogue: '台词' })[key]}：${note[key]}`), ''
        ])].join('\n');
}
export function putNote(project: Project, note: ProductionNote) {
    project.production ??= productionData(project);
    const index = project.production.notes.findIndex(n => n.id === note.id);
    if (index < 0) project.production.notes.push(note); else project.production.notes[index] = note;
}
export function safeFilename(name: string): string {
    const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100).replace(/[. ]+$/g, '') || '未命名';
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(cleaned) ? '_' + cleaned : cleaned;
}
