import React from 'react'
import { Loader, Modal } from '@mantine/core'
import { IconPhoto, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react'
import { agentsChat, uploadServerAssetFile, uploadUserContextAsset } from '../api/server'
import { useAuth } from '../auth/store'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'

type GeneratedSkillDraft = {
  name: string
  description: string
  fileName: string
  content: string
}

type SkillMakerDialogProps = {
  opened: boolean
  onClose: () => void
  onCreated: () => void
}

type UploadedVideo = {
  name: string
  url: string
}

function readAssetUrl(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const url = (data as Record<string, unknown>).url
  return typeof url === 'string' ? url.trim() : ''
}

function isGeneratedSkillDraft(value: unknown): value is GeneratedSkillDraft {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return ['name', 'description', 'fileName', 'content'].every((key) => typeof record[key] === 'string' && record[key].trim().length > 0)
}

function parseGeneratedSkill(text: string): GeneratedSkillDraft {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Agents 未返回合法的 Skill JSON，请重试')
  }
  if (!isGeneratedSkillDraft(parsed)) throw new Error('Agents 返回的 Skill 缺少 name、description、fileName 或 content')
  if (!parsed.fileName.toLocaleLowerCase('en-US').endsWith('.md')) throw new Error('Agents 返回的 Skill 文件名不是 .md')
  if (!parsed.content.startsWith('---')) throw new Error('Agents 返回的 Skill 缺少 YAML frontmatter')
  return parsed
}

function validateVideoFiles(files: readonly File[]): string {
  if (files.length < 3 || files.length > 5) return '请上传 3–5 个参考视频'
  const invalidType = files.find((file) => !['video/mp4', 'video/quicktime'].includes(file.type))
  if (invalidType) return `“${invalidType.name}”不是 MP4 或 MOV 视频`
  const oversized = files.find((file) => file.size > 500 * 1024 * 1024)
  if (oversized) return `“${oversized.name}”超过 500 MB`
  return ''
}

function buildSkillGenerationPrompt(videos: readonly UploadedVideo[]): string {
  return [
    '请创建一个可复用的 TapCanvas Skill。你必须先逐个分析下列真实参考视频，再综合它们共同的内容模式和表现方式。',
    '',
    ...videos.map((video, index) => `${index + 1}. ${video.name}: ${video.url}`),
    '',
    '分析维度必须覆盖：叙事结构、开场钩子、角色或主体、场景、镜头尺度、机位与运动、动作设计、剪辑节奏、转场、光影色彩、声音与对白、重复母题、输入变量、适用边界和失败模式。',
    '随后生成完整 SKILL.md。Skill 必须包含 Identity/Mission、Success Definition、Workflow、Decision Rules、Required Inputs、Boundaries、Forbidden Moves、Failure Semantics、Quality Review Loop。',
    '不要复制或声称获得任何第三方隐藏提示词；只根据本轮真实视频证据归纳可迁移的方法。',
    '只返回一个合法 JSON 对象，禁止 Markdown 代码围栏和额外说明。JSON 必须严格包含四个字符串字段：name、description、fileName、content。',
    'fileName 必须以 .md 结尾；content 必须是完整 SKILL.md，且以包含 name 和 description 的 YAML frontmatter 开头。',
  ].join('\n')
}

export function SkillMakerDialog({ opened, onClose, onCreated }: SkillMakerDialogProps): JSX.Element {
  const auth = useAuth()
  const videoInputRef = React.useRef<HTMLInputElement | null>(null)
  const coverInputRef = React.useRef<HTMLInputElement | null>(null)
  const [videos, setVideos] = React.useState<File[]>([])
  const [draft, setDraft] = React.useState<GeneratedSkillDraft | null>(null)
  const [coverFile, setCoverFile] = React.useState<File | null>(null)
  const [coverPreviewUrl, setCoverPreviewUrl] = React.useState('')
  const [stage, setStage] = React.useState<'idle' | 'uploading' | 'analyzing' | 'saving'>('idle')
  const [progressText, setProgressText] = React.useState('')
  const [error, setError] = React.useState('')

  React.useEffect(() => {
    if (!coverFile) {
      setCoverPreviewUrl('')
      return
    }
    const objectUrl = URL.createObjectURL(coverFile)
    setCoverPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [coverFile])

  React.useEffect(() => {
    if (opened) return
    setVideos([])
    setDraft(null)
    setCoverFile(null)
    setStage('idle')
    setProgressText('')
    setError('')
  }, [opened])

  const busy = stage !== 'idle'

  const chooseVideos = (files: FileList | null): void => {
    if (!files?.length) return
    const selected = Array.from(files)
    const validationError = validateVideoFiles(selected)
    if (validationError) {
      setError(validationError)
      return
    }
    setVideos(selected)
    setDraft(null)
    setError('')
  }

  const chooseCover = (files: FileList | null): void => {
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
  }

  const generate = async (): Promise<void> => {
    if (!auth.token) {
      setError('请先登录，再创建 Skill')
      return
    }
    const validationError = validateVideoFiles(videos)
    if (validationError) {
      setError(validationError)
      return
    }
    setError('')
    setDraft(null)
    setStage('uploading')
    try {
      const uploadedVideos: UploadedVideo[] = []
      for (let index = 0; index < videos.length; index += 1) {
        const video = videos[index]
        setProgressText(`正在上传 ${index + 1}/${videos.length}：${video.name}`)
        const uploaded = await uploadServerAssetFile(video, `Skill参考视频-${video.name}`, { taskKind: 'skill_reference_video' })
        const url = readAssetUrl(uploaded.data)
        if (!url) throw new Error(`“${video.name}”上传成功，但 OSS 未返回真实资产 URL`)
        uploadedVideos.push({ name: video.name, url })
      }
      setStage('analyzing')
      setProgressText('Agents 正在分析参考视频并生成 Skill…')
      const response = await agentsChat({
        prompt: buildSkillGenerationPrompt(uploadedVideos),
        displayPrompt: `根据 ${uploadedVideos.length} 个参考视频创建 Skill`,
        mode: 'auto',
        planOnly: false,
        forceAssetGeneration: false,
      })
      const generated = parseGeneratedSkill(response.text.trim())
      setDraft(generated)
      setProgressText('')
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Skill 生成失败')
    } finally {
      setStage('idle')
    }
  }

  const save = async (): Promise<void> => {
    if (!draft) {
      setError('请先生成 Skill')
      return
    }
    if (!coverFile) {
      setError('请上传 Skill Logo')
      return
    }
    setStage('saving')
    setProgressText('正在上传 Logo 并保存 Skill…')
    setError('')
    try {
      const uploadedCover = await uploadServerAssetFile(coverFile, `Skill封面-${draft.name}`, { taskKind: 'user_skill_cover' })
      const logoUrl = readAssetUrl(uploadedCover.data)
      if (!logoUrl) throw new Error('Logo 上传成功，但 OSS 未返回真实资产 URL')
      await uploadUserContextAsset({
        fileName: draft.fileName,
        content: draft.content,
        name: draft.name,
        description: draft.description,
        logoUrl,
        overwrite: false,
      })
      onCreated()
      onClose()
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Skill 保存失败')
    } finally {
      setStage('idle')
      setProgressText('')
    }
  }

  return (
    <Modal className="skill-maker" opened={opened} onClose={onClose} centered size={860} title="SKILL 技能制造机" closeOnClickOutside={!busy} closeOnEscape={!busy} withCloseButton={!busy} overlayProps={{ backgroundOpacity: 0.72, blur: 6 }}>
      <div className="skill-maker__body">
        <input ref={videoInputRef} className="skill-maker__hidden-input" type="file" multiple accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(event) => { chooseVideos(event.currentTarget.files); event.currentTarget.value = '' }} />
        <input ref={coverInputRef} className="skill-maker__hidden-input" type="file" accept="image/png,image/jpeg,image/webp,image/avif" onChange={(event) => { chooseCover(event.currentTarget.files); event.currentTarget.value = '' }} />
        <span className="skill-maker__eyebrow">SKILL 技能制造机</span>
        <h2 className="skill-maker__title">上传视频，获得能制作同类视频的技能</h2>
        <p className="skill-maker__description">上传 3–5 个 MP4 或 MOV 参考视频。视频会先上传至自有 OSS，再由 Agents 分析共同的内容与表现方式。</p>

        {!draft ? (
          <>
            <button
              className="skill-maker__upload"
              type="button"
              disabled={busy}
              onClick={() => videoInputRef.current?.click()}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }}
              onDrop={(event) => { event.preventDefault(); if (!busy) chooseVideos(event.dataTransfer.files) }}
            >
              <IconPlus className="skill-maker__upload-icon" size={24} />
              <strong className="skill-maker__upload-title">{videos.length ? `已选择 ${videos.length} 个视频` : '上传视频'}</strong>
              <span className="skill-maker__upload-hint">点击或拖拽上传。必须选择 3–5 个视频，支持 MP4 / MOV，单个不超过 500 MB。</span>
            </button>
            {videos.length ? <div className="skill-maker__video-list">{videos.map((video) => <div className="skill-maker__video-row" key={`${video.name}-${video.lastModified}`}><span className="skill-maker__video-name">{video.name}</span><span className="skill-maker__video-size">{(video.size / 1024 / 1024).toFixed(1)} MB</span></div>)}</div> : null}
            <button className="skill-maker__generate" type="button" disabled={busy || videos.length < 3 || videos.length > 5} onClick={() => void generate()}>{stage === 'uploading' || stage === 'analyzing' ? <Loader className="skill-maker__loader" size={15} color="dark" /> : <IconUpload className="skill-maker__generate-icon" size={16} />}<span className="skill-maker__generate-label">{stage === 'uploading' ? '上传中' : stage === 'analyzing' ? '分析中' : '生成 Skill'}</span></button>
          </>
        ) : (
          <div className="skill-maker__draft">
            <button className="skill-maker__restart" type="button" disabled={busy} onClick={() => { setDraft(null); setCoverFile(null) }}>重新选择视频</button>
            <div className="skill-maker__draft-grid">
              <button className="skill-maker__cover" type="button" disabled={busy} onClick={() => coverInputRef.current?.click()}>
                {coverPreviewUrl ? <ManagedImage className="skill-maker__cover-image" src={coverPreviewUrl} alt={`${draft.name} Logo`} priority="visible" /> : <span className="skill-maker__cover-empty"><IconPhoto className="skill-maker__cover-icon" size={24} /><span className="skill-maker__cover-label">上传 Logo *</span></span>}
              </button>
              <div className="skill-maker__fields">
                <label className="skill-maker__field"><span className="skill-maker__field-label">名称</span><input className="skill-maker__input" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
                <label className="skill-maker__field"><span className="skill-maker__field-label">描述</span><textarea className="skill-maker__textarea" rows={3} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })} /></label>
              </div>
            </div>
            <label className="skill-maker__field"><span className="skill-maker__field-label">SKILL.md</span><textarea className="skill-maker__content" rows={15} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.currentTarget.value })} /></label>
            <div className="skill-maker__draft-actions"><button className="skill-maker__discard" type="button" disabled={busy} onClick={() => setDraft(null)}><IconTrash className="skill-maker__discard-icon" size={15} />放弃草稿</button><button className="skill-maker__save" type="button" disabled={busy || !coverFile || !draft.name.trim() || !draft.description.trim() || !draft.content.trim()} onClick={() => void save()}>{stage === 'saving' ? <Loader className="skill-maker__loader" size={15} color="dark" /> : null}<span className="skill-maker__save-label">{stage === 'saving' ? '保存中' : '保存到我的技能'}</span></button></div>
          </div>
        )}
        {progressText ? <div className="skill-maker__progress" role="status">{progressText}</div> : null}
        {error ? <div className="skill-maker__error" role="alert">{error}</div> : null}
      </div>
    </Modal>
  )
}
