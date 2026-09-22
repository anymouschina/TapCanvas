import skill from './builtin-skill.json' with { type: 'json' };

export const BUILTIN_SKILL = skill;
/** The caller only supplies a version whose instructions are still in its context. */
export function readBuiltinSkill(knownVersion?: string, path?: string) {
    const { name, version, instructions } = skill;
    const references: Record<string, string> = skill.references;
    const files = ['SKILL.md', ...Object.keys(references)];
    if (path !== undefined && !files.includes(path)) throw Error('技能中没有这个文件');
    const unchanged = knownVersion === version && path === undefined;
    return { name, version, unchanged, files, ...(unchanged ? {} : {
        path: path ?? 'SKILL.md', instructions: path === undefined || path === 'SKILL.md' ? instructions : references[path],
    }) };
}
