import { useEffect, useMemo, useState } from 'react'
import { Button, Group, Modal, Select, Stack, Text } from '@mantine/core'
import { $ } from '../../canvas/i18n'
import {
  findModelOptionByIdentifier,
  getModelOptionRequestAlias,
  useModelOptionsState,
} from '../../config/useModelOptions'
import { loadGenerationPrefs, saveGenerationPrefs } from '../../config/generationPrefs'
import { resolveVideoGenerationPreferenceCatalog } from '../../config/generationPreferenceCatalog'
import type { UserGenerationPrefsDto } from '../../api/server'

// 账号生成偏好弹窗：保存用户最近明确选择的生图模型/视频模型/规格。
// 新账号由服务端返回完整初始值；每次执行仍以实时目录验证精确值，不做自动模型切换。

const IMAGE_SIZE_OPTIONS = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
]

export function GenerationPrefsModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const imageModels = useModelOptionsState('image', { enabled: opened })
  const videoModels = useModelOptionsState('video', { enabled: opened })
  const imageModelOptions = imageModels.options
  const videoModelOptions = videoModels.options
  const [imageModel, setImageModel] = useState('')
  const [imageSize, setImageSize] = useState('')
  const [videoModel, setVideoModel] = useState('')
  const [videoResolution, setVideoResolution] = useState('')
  const [videoAspect, setVideoAspect] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!opened) return
    let canceled = false
    ;(async () => {
      try {
        const prefs = await loadGenerationPrefs()
        if (canceled) return
        setImageModel(prefs?.imageModel ?? '')
        setImageSize(prefs?.imageSize ?? '')
        setVideoModel(prefs?.videoModel ?? '')
        setVideoResolution(prefs?.videoResolution ?? '')
        setVideoAspect(prefs?.videoAspect ?? '')
        setError(null)
      } catch (loadError) {
        if (!canceled) {
          setError(loadError instanceof Error ? loadError.message : String(loadError))
        }
      }
    })()
    return () => {
      canceled = true
    }
  }, [opened])

  // 存储值是 requestModelKey；目录加载后把它映射回对应下拉项的 value（显示名），保证回显命中
  useEffect(() => {
    if (!imageModel) return
    const matched = findModelOptionByIdentifier(imageModelOptions, imageModel)
    if (matched && matched.value !== imageModel) setImageModel(matched.value)
  }, [imageModelOptions, imageModel])
  useEffect(() => {
    if (!videoModel) return
    const matched = findModelOptionByIdentifier(videoModelOptions, videoModel)
    if (matched && matched.value !== videoModel) setVideoModel(matched.value)
  }, [videoModelOptions, videoModel])

  const imageModelUnavailable = Boolean(
    imageModel &&
      !imageModels.loading &&
      !imageModels.error &&
      !findModelOptionByIdentifier(imageModelOptions, imageModel),
  )
  const videoModelUnavailable = Boolean(
    videoModel &&
      !videoModels.loading &&
      !videoModels.error &&
      !findModelOptionByIdentifier(videoModelOptions, videoModel),
  )

  const imageSelectData = useMemo(() => {
    return imageModelOptions.map((o) => ({ value: o.value, label: o.label }))
  }, [imageModelOptions])

  const videoSelectData = useMemo(() => {
    return videoModelOptions.map((o) => ({ value: o.value, label: o.label }))
  }, [videoModelOptions])

  const selectedVideoOption = useMemo(
    () => findModelOptionByIdentifier(videoModelOptions, videoModel),
    [videoModelOptions, videoModel],
  )
  const videoPreferenceCatalog = useMemo(
    () => resolveVideoGenerationPreferenceCatalog(selectedVideoOption),
    [selectedVideoOption],
  )
  const videoResolutionUnavailable = Boolean(
    videoResolution &&
      videoPreferenceCatalog &&
      !videoPreferenceCatalog.resolutionOptions.some((option) => option.value === videoResolution),
  )
  const videoAspectUnavailable = Boolean(
    videoAspect &&
      videoPreferenceCatalog &&
      !videoPreferenceCatalog.aspectOptions.some((option) => option.value === videoAspect),
  )

  const handleVideoModelChange = (value: string | null) => {
    const nextModel = value ?? ''
    setVideoModel(nextModel)
    const nextCatalog = resolveVideoGenerationPreferenceCatalog(
      findModelOptionByIdentifier(videoModelOptions, nextModel),
    )
    setVideoResolution(nextCatalog?.defaultResolution ?? '')
    setVideoAspect(nextCatalog?.defaultAspect ?? '')
  }

  const handleSave = async () => {
    setError(null)
    if (imageModels.loading || videoModels.loading) {
      setError($('模型目录仍在读取，请稍后再保存。'))
      return
    }
    const catalogError = imageModels.error ?? videoModels.error
    if (catalogError) {
      setError(`${$('模型目录读取失败：')}${catalogError.message}`)
      return
    }
    if (imageModelUnavailable || videoModelUnavailable) {
      setError($('已保存的模型已不在当前可执行目录中，请重新选择。'))
      return
    }
    if (!videoPreferenceCatalog) {
      setError($('所选视频模型未声明可执行的视频规格，请在系统模型管理中补齐。'))
      return
    }
    if (videoResolutionUnavailable || videoAspectUnavailable) {
      setError($('所选视频分辨率或画幅不属于当前模型的实时目录，请重新选择。'))
      return
    }
    if (!imageModel || !imageSize || !videoModel || !videoResolution || !videoAspect) {
      setError($('生图模型、生图规格、视频模型、视频分辨率和视频画幅都必须明确选择。'))
      return
    }
    setSaving(true)
    try {
      const prefs: UserGenerationPrefsDto = {
        imageModel: getModelOptionRequestAlias(imageModelOptions, imageModel),
        imageSize,
        videoModel: getModelOptionRequestAlias(videoModelOptions, videoModel),
        videoResolution,
        videoAspect,
      }
      // 存生成链路认的真实模型键（requestModelKey），不存显示名/别名——
      // 选项显示名与上游请求 key 可能不同；提交时必须使用本次动态目录返回的精确 key。
      await saveGenerationPrefs(prefs)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      className="tc-generation-prefs-modal"
      opened={opened}
      onClose={onClose}
      title={$('生成偏好')}
      centered
      size="sm"
      zIndex={10100}
    >
      <Stack className="tc-generation-prefs-modal__content" gap="sm">
        <Text className="tc-generation-prefs-modal__description" size="xs" c="dimmed">
          {$('账号偏好会跟随你最近一次明确选择；本次任务显式规格优先。新账号初始使用 gpt-image-2 / 1K 与 minimax-h3 / 768p / 16:9，执行前仍按实时目录校验。')}
        </Text>
        <Select
          className="tc-generation-prefs-modal__image-model"
          label={$('生图模型')}
          data={imageSelectData}
          value={imageModelUnavailable ? null : imageModel}
          onChange={(v) => setImageModel(v ?? '')}
          placeholder={
            imageModels.loading
              ? $('读取图片模型…')
              : imageModelUnavailable
                ? $('原偏好已不可用，请重新选择')
                : $('选择图片模型')
          }
          disabled={imageModels.loading || Boolean(imageModels.error)}
          searchable
          comboboxProps={{ zIndex: 10110 }}
        />
        {imageModels.error || imageModelUnavailable ? (
          <Text className="tc-generation-prefs-modal__image-error" size="xs" c="red">
            {imageModels.error
              ? `${$('图片模型目录读取失败：')}${imageModels.error.message}`
              : `${$('原图片模型已停用：')}${imageModel}`}
          </Text>
        ) : null}
        <Select
          className="tc-generation-prefs-modal__image-size"
          label={$('生图规格')}
          data={IMAGE_SIZE_OPTIONS}
          value={imageSize}
          onChange={(v) => setImageSize(v ?? '')}
          comboboxProps={{ zIndex: 10110 }}
        />
        <Select
          className="tc-generation-prefs-modal__video-model"
          label={$('视频模型')}
          data={videoSelectData}
          value={videoModelUnavailable ? null : videoModel}
          onChange={handleVideoModelChange}
          placeholder={
            videoModels.loading
              ? $('读取视频模型…')
              : videoModelUnavailable
                ? $('原偏好已不可用，请重新选择')
                : $('选择视频模型')
          }
          disabled={videoModels.loading || Boolean(videoModels.error)}
          searchable
          comboboxProps={{ zIndex: 10110 }}
        />
        {videoModels.error || videoModelUnavailable ? (
          <Text className="tc-generation-prefs-modal__video-error" size="xs" c="red">
            {videoModels.error
              ? `${$('视频模型目录读取失败：')}${videoModels.error.message}`
              : `${$('原视频模型已停用：')}${videoModel}`}
          </Text>
        ) : null}
        <Group className="tc-generation-prefs-modal__video-specs" grow>
          <Select
            className="tc-generation-prefs-modal__video-resolution"
            label={$('视频分辨率')}
            data={videoPreferenceCatalog?.resolutionOptions ?? []}
            value={videoResolutionUnavailable ? null : videoResolution}
            onChange={(v) => setVideoResolution(v ?? '')}
            placeholder={videoPreferenceCatalog ? $('选择视频分辨率') : $('当前模型缺少分辨率规格')}
            disabled={!videoPreferenceCatalog}
            comboboxProps={{ zIndex: 10110 }}
          />
          <Select
            className="tc-generation-prefs-modal__video-aspect"
            label={$('视频画幅')}
            data={videoPreferenceCatalog?.aspectOptions ?? []}
            value={videoAspectUnavailable ? null : videoAspect}
            onChange={(v) => setVideoAspect(v ?? '')}
            placeholder={videoPreferenceCatalog ? $('选择视频画幅') : $('当前模型缺少画幅规格')}
            disabled={!videoPreferenceCatalog}
            comboboxProps={{ zIndex: 10110 }}
          />
        </Group>
        {error ? (
          <Text className="tc-generation-prefs-modal__save-error" size="xs" c="red">
            {error}
          </Text>
        ) : null}
        <Group className="tc-generation-prefs-modal__actions" justify="flex-end" gap="xs">
          <Button
            className="tc-generation-prefs-modal__cancel"
            variant="subtle"
            size="xs"
            onClick={onClose}
            disabled={saving}
          >
            {$('取消')}
          </Button>
          <Button
            className="tc-generation-prefs-modal__save"
            size="xs"
            onClick={handleSave}
            loading={saving}
            disabled={
              imageModels.loading ||
              videoModels.loading ||
              Boolean(imageModels.error) ||
              Boolean(videoModels.error) ||
              imageModelUnavailable ||
              videoModelUnavailable ||
              !videoPreferenceCatalog ||
              videoResolutionUnavailable ||
              videoAspectUnavailable
            }
          >
            {$('保存')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
