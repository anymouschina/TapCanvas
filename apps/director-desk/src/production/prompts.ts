import type { Project } from '../model.ts';
import type { ZipEntry } from './zip.ts';
import { safeFilename } from './notes.ts';

/** Export authored text verbatim; notes alone are not a finished generation prompt. */
export function scenePromptFile(project: Pick<Project, 'name' | 'production'>, sceneName = project.name): ZipEntry | undefined {
    const text = project.production?.promptText;
    if (!text?.trim()) return undefined;
    return { name: `${safeFilename(sceneName)}-视频提示词.txt`, data: new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }) };
}
