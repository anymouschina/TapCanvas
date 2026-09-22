import type { Project } from '../model.ts';
import { notesText, productionData, safeFilename } from './notes.ts';
import type { ZipEntry } from './zip.ts';
import type { SceneDocument } from '../scenes/sequence-project.ts';
import { scenePromptFile } from './prompts.ts';
export async function productionEntries(project: Project, video?: Blob, document?: SceneDocument): Promise<ZipEntry[]> {
    const data = productionData(project), entries: ZipEntry[] = [];
    const text = (name: string, value: string) => entries.push({ name, data: new Blob(['\uFEFF', value], { type: 'text/plain;charset=utf-8' }) });
    const json = (name: string, value: unknown) => entries.push({ name, data: new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }) });
    json(`${safeFilename(project.name)}.director`, document ?? project);
    const promptFiles: { sceneId: string | null; sceneName: string; file: string | null }[] = [];
    const scenes = document?.scenes.map(scene => ({ id: scene.id, name: scene.name, project: scene.id === document.activeSceneId ? project : { name: scene.name, production: scene.state.production } }))
        ?? [{ id: null, name: project.name, project }];
    for (const [index, scene] of scenes.entries()) {
        const prompt = scenePromptFile(scene.project, scene.name);
        const file = prompt ? `逐场提示词/${String(index + 1).padStart(4, '0')}-${prompt.name}` : null;
        if (prompt && file) entries.push({ ...prompt, name: file });
        promptFiles.push({ sceneId: scene.id, sceneName: scene.name, file });
    }
    const images = new Map<string, string>();
    for (const [index, reference] of project.references.entries()) {
        const ext = /^data:image\/(png|jpeg|webp);/.exec(reference.data)?.[1];
        if (!ext) throw new Error('参考图类型无效');
        const file = `参考图/${String(index + 1).padStart(4, '0')}-${safeFilename(reference.id)}-${safeFilename(reference.name.replace(/\.(png|jpe?g|webp)$/i, ''))}.${ext === 'jpeg' ? 'jpg' : ext}`;
        images.set(reference.id, file); entries.push({ name: file, data: await (await fetch(reference.data)).blob() });
    }
    const manifest = { format: 'director-production-manifest', version: 1, projectName: project.name, duration: project.duration, fps: project.fps, aspect: project.aspect,
        ...(document ? { sceneId: document.activeSceneId, sceneName: document.scenes.find(s => s.id === document.activeSceneId)!.name, scope: '媒体与剧情素材为当前戏段；director 工程包含全部戏段' } : {}),
        video: video ? '参考视频.mp4' : null, promptFiles, sceneReferences: data.sceneReferenceIds.map(id => ({ id, file: images.get(id) })),
        characters: project.entities.filter(e => e.kind === 'actor').map(e => ({ id: e.id, name: e.name, color: e.color, referenceId: e.reference || null, file: images.get(e.reference) ?? null })),
        references: project.references.map(r => ({ id: r.id, name: r.name, file: images.get(r.id) })),
        cuts: project.cuts.map((c, i) => ({ start: c.time, end: project.cuts[i + 1]?.time ?? project.duration, cameraId: c.cameraId, cameraName: project.entities.find(e => e.id === c.cameraId)!.name })) };
    json('素材对应关系.json', manifest); json('剧情备注.json', data.notes); text('剧情与台词.txt', notesText(project));
    text('提示词素材.txt', ['以下是当前戏段的写作素材，不是已完成的视频生成提示词。完整提示词如已保存，见“逐场提示词”目录。', '', data.fixedPrompt || '（本工程尚未填写固定提示词头）', '',
        '参考《参考视频.mp4》的取景、运镜、切镜、场景布局、人物站位和行走路线。人物身份与参考图对应见《素材对应关系.json》。',
        '白模动作表达行为意图，人物表演自然完成，避免逐帧复刻僵硬的关节运动。', '', notesText(project)].join('\n'));
    text('使用说明.txt', `工程：${project.name}\n${document ? "工程文件包含全部独立戏段；视频、参考图、角色对应关系、切镜及剧情备注属于当前戏段。" : "本包包含可编辑工程、参考图、角色对应关系、切镜时间和剧情备注。"}\n逐场提示词目录包含各戏段已保存的完整提示词；未填写的戏段不生成空文件，具体见素材对应关系.json 的 promptFiles。提示词是保存的文稿，修改编排后需同步更新。其他戏段的参考视频与图片需分别导出，不能共用当前段视频。\n${video ? '参考视频由同一工程按切镜逐帧导出，为无声白模参考。' : '本次未包含视频，请另外导出参考视频。'}\n剧情备注和提示词素材不会自动烧录为字幕或配音。跨时间段的台词仅在原始备注中保存一次，由后续提示词工作流分配。\n`);
    if (video) entries.push({ name: '参考视频.mp4', data: video });
    return entries;
}
