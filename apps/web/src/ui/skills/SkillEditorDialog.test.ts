import { describe, expect, it } from 'vitest'
import { readSingleMarkdown, readSkillFolder } from './SkillEditorDialog'

function folderFile(path: string, content: string): File {
	const segments = path.split('/')
	const name = segments[segments.length - 1] || path
	return {
		name,
		webkitRelativePath: path,
		text: async () => content,
	} as unknown as File
}

describe('Skill upload sources', () => {
	it('reads one Markdown Skill and derives its frontmatter name', async () => {
		const source = await readSingleMarkdown(folderFile('camera.md', '---\nname: camera-director\n---\n# Camera\n'))
		expect(source).toMatchObject({ fileName: 'camera.md', name: 'camera-director' })
	})

	it('requires a SKILL.md at folder upload time', async () => {
		await expect(readSkillFolder([folderFile('demo/references/notes.md', '# Notes')]))
			.rejects.toThrow('所选文件夹缺少 SKILL.md')
	})

	it('combines Markdown references with traceable source markers', async () => {
		const source = await readSkillFolder([
			folderFile('demo/SKILL.md', '---\nname: demo\n---\n# Demo'),
			folderFile('demo/references/rules.md', '# Rules'),
			folderFile('demo/assets/ignored.png', 'binary'),
		])
		expect(source.fileName).toBe('demo.md')
		expect(source.content).toContain('<!-- reference: demo/references/rules.md -->')
		expect(source.content).not.toContain('ignored.png')
	})

	it('rejects folder Markdown beyond the server character contract', async () => {
		await expect(readSkillFolder([
			folderFile('large/SKILL.md', '---\nname: large\n---\n'),
			folderFile('large/references/large.md', 'x'.repeat(200_001)),
		])).rejects.toThrow('200,000')
	})
})
