import React from 'react'
import { Modal } from '@mantine/core'
import { IconFolder, IconPhoto, IconUpload } from '@tabler/icons-react'
import { uploadServerAssetFile, type UserContextAssetDto } from '../../api/server'
import { ManagedImage } from '../../domain/resource-runtime/components/ManagedImage'
import type { SkillAssetDraft } from './useSkillLibraryData'

type SkillEditorInitialValue = {
	skill: UserContextAssetDto
	content: string
}

type SkillEditorDialogProps = {
	opened: boolean
	initialValue: SkillEditorInitialValue | null
	submitting: boolean
	onClose: () => void
	onSubmit: (draft: SkillAssetDraft) => Promise<boolean>
}

type SelectedSkillSource = {
	fileName: string
	content: string
	name: string
}

function readAssetUrl(data: unknown): string {
	if (!data || typeof data !== 'object') return ''
	const url = (data as Record<string, unknown>).url
	return typeof url === 'string' ? url.trim() : ''
}

function deriveSkillName(fileName: string, content: string): string {
	const lines = content.split('\r\n').join('\n').split('\n')
	let inFrontmatter = lines[0] === '---'
	for (let index = inFrontmatter ? 1 : 0; index < lines.length; index += 1) {
		const line = lines[index]
		if (inFrontmatter && line === '---') {
			inFrontmatter = false
			continue
		}
		if (inFrontmatter && line.startsWith('name:')) {
			const value = line.slice('name:'.length).trim().replace(/^['"]|['"]$/g, '')
			if (value) return value
		}
		if (!inFrontmatter && line.startsWith('# ') && line.slice(2).trim()) return line.slice(2).trim()
	}
	return fileName.replace(/\.md$/i, '').trim()
}

export async function readSingleMarkdown(file: File): Promise<SelectedSkillSource> {
	if (!file.name.toLocaleLowerCase('en-US').endsWith('.md')) throw new Error('仅支持上传 .md 文件')
	const content = await file.text()
	if (!content.trim()) throw new Error('Markdown 文件不能为空')
	if (content.length > 200_000) throw new Error('Markdown 文件不能超过 200,000 字符')
	return { fileName: file.name, content, name: deriveSkillName(file.name, content) }
}

export async function readSkillFolder(files: readonly File[]): Promise<SelectedSkillSource> {
	const markdownFiles = files
		.filter((file) => file.name.toLocaleLowerCase('en-US').endsWith('.md'))
		.sort((left, right) => left.webkitRelativePath.localeCompare(right.webkitRelativePath))
	const skillFile = markdownFiles
		.filter((file) => file.name.toLocaleLowerCase('en-US') === 'skill.md')
		.sort((left, right) => left.webkitRelativePath.split('/').length - right.webkitRelativePath.split('/').length)[0]
	if (!skillFile) throw new Error('所选文件夹缺少 SKILL.md')
	const rootPath = skillFile.webkitRelativePath
	const folderName = rootPath.split('/')[0]?.trim() || 'Skill'
	const parts: string[] = []
	for (const file of [skillFile, ...markdownFiles.filter((candidate) => candidate !== skillFile)]) {
		const content = await file.text()
		if (!content.trim()) continue
		parts.push(file === skillFile ? content : `\n\n<!-- reference: ${file.webkitRelativePath} -->\n\n${content}`)
	}
	const content = parts.join('')
	if (!content.trim()) throw new Error('Skill 文件夹中的 Markdown 内容为空')
	if (content.length > 200_000) throw new Error('Skill 文件夹中的 Markdown 总内容不能超过 200,000 字符')
	const fileName = `${folderName}.md`
	return { fileName, content, name: deriveSkillName(skillFile.name, content) }
}

export function SkillEditorDialog({
	opened,
	initialValue,
	submitting,
	onClose,
	onSubmit,
}: SkillEditorDialogProps): JSX.Element {
	const fileInputRef = React.useRef<HTMLInputElement | null>(null)
	const folderInputRef = React.useRef<HTMLInputElement | null>(null)
	const coverInputRef = React.useRef<HTMLInputElement | null>(null)
	const [fileName, setFileName] = React.useState('')
	const [content, setContent] = React.useState('')
	const [name, setName] = React.useState('')
	const [description, setDescription] = React.useState('')
	const [overwrite, setOverwrite] = React.useState(false)
	const [coverFile, setCoverFile] = React.useState<File | null>(null)
	const [coverUrl, setCoverUrl] = React.useState('')
	const [localCoverUrl, setLocalCoverUrl] = React.useState('')
	const [reading, setReading] = React.useState(false)
	const [error, setError] = React.useState('')

	React.useEffect(() => {
		folderInputRef.current?.setAttribute('webkitdirectory', '')
	}, [])

	React.useEffect(() => {
		if (!opened) return
		setFileName(initialValue?.skill.fileName ?? '')
		setContent(initialValue?.content ?? '')
		setName(initialValue?.skill.name ?? '')
		setDescription(initialValue?.skill.description ?? '')
		setCoverUrl(initialValue?.skill.logoUrl ?? '')
		setCoverFile(null)
		setOverwrite(false)
		setError('')
	}, [initialValue, opened])

	React.useEffect(() => {
		if (!coverFile) {
			setLocalCoverUrl('')
			return
		}
		const objectUrl = URL.createObjectURL(coverFile)
		setLocalCoverUrl(objectUrl)
		return () => URL.revokeObjectURL(objectUrl)
	}, [coverFile])

	const applySource = React.useCallback((source: SelectedSkillSource): void => {
		setFileName(source.fileName)
		setContent(source.content)
		setName(source.name)
		setError('')
	}, [])

	const chooseSingleFile = React.useCallback(async (files: FileList | null): Promise<void> => {
		const file = files?.[0]
		if (!file) return
		setReading(true)
		try { applySource(await readSingleMarkdown(file)) }
		catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '读取 Skill 文件失败') }
		finally { setReading(false) }
	}, [applySource])

	const chooseFolder = React.useCallback(async (files: FileList | null): Promise<void> => {
		if (!files?.length) return
		setReading(true)
		try { applySource(await readSkillFolder(Array.from(files))) }
		catch (reason: unknown) { setError(reason instanceof Error ? reason.message : '读取 Skill 文件夹失败') }
		finally { setReading(false) }
	}, [applySource])

	const chooseCover = React.useCallback((files: FileList | null): void => {
		const file = files?.[0]
		if (!file) return
		if (!file.type.startsWith('image/')) {
			setError('Skill Logo 必须是图片文件')
			return
		}
		if (file.size > 10 * 1024 * 1024) {
			setError('Skill Logo 不能超过 10 MB')
			return
		}
		setCoverFile(file)
		setError('')
	}, [])

	const submit = React.useCallback(async (): Promise<void> => {
		if (!fileName || !content.trim()) { setError('请选择 Skill 文件或文件夹'); return }
		if (!name.trim()) { setError('请输入标题'); return }
		if (!coverFile && !coverUrl) { setError('请上传 Skill Logo'); return }
		setError('')
		let uploadedCoverUrl = coverUrl
		if (coverFile) {
			try {
				const uploaded = await uploadServerAssetFile(coverFile, `Skill封面-${name.trim()}`, { taskKind: 'user_skill_cover' })
				uploadedCoverUrl = readAssetUrl(uploaded.data)
				if (!uploadedCoverUrl) throw new Error('OSS 未返回可访问的封面 URL')
			} catch (reason: unknown) {
				setError(reason instanceof Error ? reason.message : 'Skill 封面上传失败')
				return
			}
		}
		if (!uploadedCoverUrl) { setError('请上传 Skill Logo'); return }
		const saved = await onSubmit({
			fileName,
			content,
			name: name.trim(),
			description: description.trim(),
			logoUrl: uploadedCoverUrl,
			overwrite,
		})
		if (saved) onClose()
	}, [content, coverFile, coverUrl, description, fileName, name, onClose, onSubmit, overwrite])

	const previewUrl = localCoverUrl || coverUrl
	const editing = Boolean(initialValue)
	return (
		<Modal className="tc-skill-editor" opened={opened} onClose={onClose} title={editing ? '编辑技能' : '上传技能'} centered size="min(920px, calc(100vw - 32px))" zIndex={10200}>
			<div className="tc-skill-editor__layout">
				<input ref={fileInputRef} className="tc-skill-editor__hidden-input" type="file" accept=".md,text/markdown" onChange={(event) => { void chooseSingleFile(event.currentTarget.files); event.currentTarget.value = '' }} />
				<input ref={folderInputRef} className="tc-skill-editor__hidden-input" type="file" multiple onChange={(event) => { void chooseFolder(event.currentTarget.files); event.currentTarget.value = '' }} />
				<input ref={coverInputRef} className="tc-skill-editor__hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={(event) => { chooseCover(event.currentTarget.files); event.currentTarget.value = '' }} />
				<section className="tc-skill-editor__form" aria-label="技能信息">
					<div className="tc-skill-editor__source-actions">
						<button className="tc-skill-editor__source-button" type="button" disabled={reading || submitting || editing} onClick={() => fileInputRef.current?.click()}><IconUpload className="tc-skill-editor__source-icon" size={15} /><span className="tc-skill-editor__source-label">选择 .md 文件</span></button>
						<button className="tc-skill-editor__source-button" type="button" disabled={reading || submitting || editing} onClick={() => folderInputRef.current?.click()}><IconFolder className="tc-skill-editor__source-icon" size={15} /><span className="tc-skill-editor__source-label">选择文件夹</span></button>
						<span className="tc-skill-editor__source-name">{fileName || '单个 .md，或含 SKILL.md 的文件夹'}</span>
					</div>
					<button className="tc-skill-editor__cover" type="button" disabled={submitting} aria-label="选择 Skill Logo" onClick={() => coverInputRef.current?.click()}>
						{previewUrl ? <ManagedImage className="tc-skill-editor__cover-image" src={previewUrl} alt={`${name || 'Skill'} Logo`} priority="visible" /> : <span className="tc-skill-editor__cover-empty"><IconPhoto className="tc-skill-editor__cover-icon" size={22} /><span className="tc-skill-editor__cover-label">Logo *</span></span>}
					</button>
					<label className="tc-skill-editor__field"><span className="tc-skill-editor__field-label">标题 *</span><input className="tc-skill-editor__input" value={name} maxLength={120} onChange={(event) => setName(event.currentTarget.value)} placeholder="展示给用户的标题" /></label>
					<label className="tc-skill-editor__field"><span className="tc-skill-editor__field-label">描述</span><textarea className="tc-skill-editor__textarea" value={description} maxLength={4000} rows={4} onChange={(event) => setDescription(event.currentTarget.value)} placeholder="简单描述这个技能的用途" /></label>
					{!editing ? <label className="tc-skill-editor__overwrite"><input className="tc-skill-editor__overwrite-input" type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.currentTarget.checked)} /><span className="tc-skill-editor__overwrite-label">同名技能存在时覆盖</span></label> : null}
				</section>
				<section className="tc-skill-editor__preview" aria-label="指令预览">
					<strong className="tc-skill-editor__preview-title">指令</strong>
					<textarea className="tc-skill-editor__preview-content" value={content} readOnly placeholder="选择文件后在此预览" />
				</section>
			</div>
			{error ? <div className="tc-skill-editor__error" role="alert">{error}</div> : null}
			<footer className="tc-skill-editor__footer"><button className="tc-skill-editor__cancel" type="button" disabled={submitting} onClick={onClose}>取消</button><button className="tc-skill-editor__submit" type="button" disabled={submitting || reading || !content.trim() || !name.trim() || (!coverFile && !coverUrl)} onClick={() => void submit()}>{submitting ? '保存中' : editing ? '保存' : '上传'}</button></footer>
		</Modal>
	)
}
