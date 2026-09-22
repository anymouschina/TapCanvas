// Explicit public skill payload; never discover files by scanning a user's skills directory.
const referenceFiles = [
    'references/online-workflow.md',
    'references/prompt-writing.md',
    'references/camera.md',
    'references/media.md',
    'references/editing.md',
    'references/project-format.md',
];
const publicFiles = ['SKILL.md', 'LICENSE', ...referenceFiles, 'scripts/project-tool.mjs', 'assets/minimal.director'];

module.exports = { referenceFiles, publicFiles };
