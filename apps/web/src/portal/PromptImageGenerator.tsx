import React from 'react'
import { Textarea } from '@mantine/core'
import { IconCopy, IconRefresh, IconSparkles } from '@tabler/icons-react'
import { ManagedImage } from '../domain/resource-runtime/components/ManagedImage'
import { useGenerationHistory } from '../ui/useGenerationHistory'
import { PromptGenerationHistory } from './PromptGenerationHistory'
import { PromptGenerationSelect } from './PromptGenerationSelect'
import { usePromptImageGeneration } from './usePromptImageGeneration'
import type { PromptSourceModel } from './promptGenerationModelMatching'
import './PromptGenerationPanel.css'

type PromptImageGeneratorProps = Readonly<{
  entryId: string
  title: string
  initialPrompt: string
  sourceModels: readonly PromptSourceModel[]
  onRequestLogin: () => void
  onCopyPrompt: (value: string) => void
}>

export function PromptImageGenerator(props: PromptImageGeneratorProps): JSX.Element {
  const generation = usePromptImageGeneration(props)
  const history = useGenerationHistory(generation.authenticated)
  const visibleBindings = generation.controlState.visibleBindings

  return (
    <section className="prompt-generation-panel prompt-generation-panel--image" aria-label="修改提示词并重新生成图片">
      <div className="prompt-generation-panel__heading">
        <div className="prompt-generation-panel__title-group">
          <span className="prompt-generation-panel__kicker">REMIX</span>
          <h2 className="prompt-generation-panel__title">修改提示词，再生成</h2>
          <p className="prompt-generation-panel__description">结果仅保存到你的生成历史，不会写入项目或画布。</p>
        </div>
        <button className="prompt-generation-panel__copy" type="button" onClick={() => props.onCopyPrompt(generation.prompt)}>
          <IconCopy className="prompt-generation-panel__copy-icon" size={15} />
          <span className="prompt-generation-panel__copy-label">复制</span>
        </button>
      </div>

      <div className="prompt-generation-panel__prompt-field">
        <Textarea
          className="prompt-generation-panel__textarea-control"
          classNames={{ label: 'prompt-generation-panel__field-label', input: 'prompt-generation-panel__textarea' }}
          label="提示词"
          value={generation.prompt}
          onChange={(event) => generation.setPrompt(event.currentTarget.value)}
          rows={8}
          maxLength={20_000}
          aria-label="可编辑提示词"
        />
        <span className="prompt-generation-panel__prompt-count">{generation.prompt.length.toLocaleString('zh-CN')} / 20,000</span>
      </div>

      <div className="prompt-generation-panel__controls">
        <PromptGenerationSelect
          label="图片模型"
          value={generation.selection.modelValue}
          options={generation.modelCatalog.options}
          placeholder={generation.modelCatalog.loading ? '正在读取模型目录…' : '选择可用模型'}
          disabled={!generation.authenticated || generation.modelCatalog.loading || Boolean(generation.modelCatalog.error) || generation.busy}
          loading={generation.modelCatalog.loading}
          searchable
          nothingFoundMessage="没有匹配的可用模型"
          primary
          onChange={generation.selectModel}
        />

        {generation.selectedConfig && visibleBindings.has('aspectRatio') && generation.controlState.aspectRatioOptions.length ? (
          <PromptGenerationSelect
            label="画面比例"
            value={generation.selection.aspectRatio}
            options={generation.controlState.aspectRatioOptions}
            placeholder="选择比例"
            disabled={generation.busy}
            onChange={(value) => generation.setControl('aspectRatio', value)}
          />
        ) : null}

        {generation.selectedConfig && visibleBindings.has('imageSize') && generation.selectedConfig.imageSizeOptions.length ? (
          <PromptGenerationSelect
            label="图片尺寸"
            value={generation.selection.imageSize}
            options={generation.selectedConfig.imageSizeOptions}
            placeholder="选择尺寸"
            disabled={generation.busy}
            onChange={(value) => generation.setControl('imageSize', value)}
          />
        ) : null}

        {generation.selectedConfig && visibleBindings.has('resolution') && generation.selectedConfig.resolutionOptions.length ? (
          <PromptGenerationSelect
            label="分辨率"
            value={generation.selection.resolution}
            options={generation.selectedConfig.resolutionOptions}
            placeholder="选择分辨率"
            disabled={generation.busy}
            onChange={(value) => generation.setControl('resolution', value)}
          />
        ) : null}

        {generation.selectedConfig && visibleBindings.has('quality') && generation.selectedConfig.qualityOptions.length ? (
          <PromptGenerationSelect
            label="画质"
            value={generation.selection.quality}
            options={generation.selectedConfig.qualityOptions}
            placeholder="选择画质"
            disabled={generation.busy}
            onChange={(value) => generation.setControl('quality', value)}
          />
        ) : null}
      </div>

      {generation.modelCatalog.error ? (
        <div className="prompt-generation-panel__message prompt-generation-panel__message--error" role="alert">
          <span className="prompt-generation-panel__message-text">图片模型目录读取失败：{generation.modelCatalog.error.message}</span>
          <button className="prompt-generation-panel__message-action" type="button" onClick={generation.modelCatalog.retry}>重试目录</button>
        </div>
      ) : generation.selectedOption && !generation.selectedConfig ? (
        <div className="prompt-generation-panel__message prompt-generation-panel__message--error" role="alert">
          <span className="prompt-generation-panel__message-text">该模型缺少可执行的图片参数合同，请选择其他模型。</span>
        </div>
      ) : generation.selectedConfig?.supportsTextToImage === false ? (
        <div className="prompt-generation-panel__message prompt-generation-panel__message--error" role="alert">
          <span className="prompt-generation-panel__message-text">该图片模型不支持仅使用文本生成，请选择支持文生图的模型。</span>
        </div>
      ) : generation.sourceModelUnavailable ? (
        <div className="prompt-generation-panel__message prompt-generation-panel__message--warning" role="status">
          <span className="prompt-generation-panel__message-text">
            当前提示词使用的模型“{generation.sourceModelLabel || '未命名模型'}”不在可用目录中，请手动选择图片模型；系统不会自动降级。
          </span>
        </div>
      ) : null}

      <div className="prompt-generation-panel__submit-row">
        <span className="prompt-generation-panel__submit-note">
          {generation.authenticated ? '真实生成会消耗账户积分' : '登录后可提交真实生成任务'}
        </span>
        <button
          className="prompt-generation-panel__submit"
          type="button"
          disabled={generation.authenticated && (generation.busy || !generation.prompt.trim() || !generation.executableSelection || Boolean(generation.modelCatalog.error))}
          onClick={() => void generation.generate()}
        >
          <IconSparkles className="prompt-generation-panel__submit-icon" size={16} />
          <span className="prompt-generation-panel__submit-label">
            {!generation.authenticated
              ? '登录后生成'
              : generation.busy
                ? '生成中…'
                : typeof generation.generationCost === 'number'
                  ? `生成临时图片 · ${generation.generationCost.toLocaleString('zh-CN')} 积分`
                  : '生成临时图片'}
          </span>
        </button>
      </div>

      {generation.status !== 'idle' ? (
        <div className={`prompt-generation-panel__status prompt-generation-panel__status--${generation.status}`} role="status">
          <span className="prompt-generation-panel__status-dot" aria-hidden="true" />
          <span className="prompt-generation-panel__status-text">{generation.statusLabel}</span>
          {generation.canRefreshAcceptedTask ? (
            <button className="prompt-generation-panel__status-action" type="button" onClick={generation.refreshAcceptedTask}>
              <IconRefresh className="prompt-generation-panel__status-action-icon" size={14} />
              <span className="prompt-generation-panel__status-action-label">刷新状态</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {generation.error ? <p className="prompt-generation-panel__error" role="alert">{generation.error}</p> : null}

      {generation.preview.length > 0 ? (
        <div className="prompt-generation-panel__preview">
          <div className="prompt-generation-panel__preview-heading">
            <span className="prompt-generation-panel__preview-title">临时预览</span>
            <span className="prompt-generation-panel__preview-meta">已保存在生成历史</span>
          </div>
          <div className="prompt-generation-panel__preview-images">
            {generation.preview.map((image, index) => (
              <figure className="prompt-generation-panel__preview-image-item" key={`${image.url}-${index}`}>
                <ManagedImage
                  className="prompt-generation-panel__preview-image"
                  src={image.url}
                  alt={image.title}
                  priority={index === 0 ? 'visible' : 'prefetch'}
                />
              </figure>
            ))}
          </div>
        </div>
      ) : null}

      <PromptGenerationHistory
        kind="image"
        authenticated={generation.authenticated}
        items={history.items}
        loading={history.loading}
        error={history.error}
        reload={history.reload}
        onRequestLogin={props.onRequestLogin}
        onPreview={(item) => generation.setPreview([{ url: item.url, title: item.title }])}
      />
    </section>
  )
}
