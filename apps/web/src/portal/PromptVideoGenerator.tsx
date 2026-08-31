import React from 'react'
import { Textarea } from '@mantine/core'
import { IconCopy, IconRefresh, IconSparkles } from '@tabler/icons-react'
import { useGenerationHistory } from '../ui/useGenerationHistory'
import { PromptGenerationHistory } from './PromptGenerationHistory'
import { PromptGenerationSelect } from './PromptGenerationSelect'
import { usePromptVideoGeneration, type PromptVideoSourceModel } from './usePromptVideoGeneration'
import './PromptGenerationPanel.css'

type PromptVideoGeneratorProps = Readonly<{
  entryId: string
  title: string
  initialPrompt: string
  sourceModels: readonly PromptVideoSourceModel[]
  onRequestLogin: () => void
  onCopyPrompt: (value: string) => void
}>

export function PromptVideoGenerator(props: PromptVideoGeneratorProps): JSX.Element {
  const generation = usePromptVideoGeneration(props)
  const history = useGenerationHistory(generation.authenticated)

  return (
    <section className="prompt-generation-panel" aria-label="修改提示词并重新生成视频">
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
          label="视频模型"
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

        {generation.selectedConfig?.durationOptions.length ? (
          <PromptGenerationSelect
            label="视频时长"
            value={generation.selection.durationSeconds}
            options={generation.selectedConfig.durationOptions.map((option) => ({ value: String(option.value), label: option.label }))}
            placeholder="选择时长"
            disabled={generation.busy}
            onChange={(value) => generation.setSelection((current) => ({ ...current, durationSeconds: value }))}
          />
        ) : null}

        {generation.selectedConfig?.resolutionOptions.length ? (
          <PromptGenerationSelect
            label="视频分辨率"
            value={generation.selection.resolution}
            options={generation.selectedConfig.resolutionOptions}
            placeholder="选择分辨率"
            disabled={generation.busy}
            onChange={(value) => generation.setSelection((current) => ({ ...current, resolution: value }))}
          />
        ) : null}

        {generation.selectedConfig?.sizeOptions.length ? (
          <PromptGenerationSelect
            label="视频画面比例"
            value={generation.selection.aspectRatio}
            options={generation.selectedConfig.sizeOptions}
            placeholder="选择比例"
            disabled={generation.busy}
            onChange={(value) => generation.setSelection((current) => ({ ...current, aspectRatio: value }))}
          />
        ) : null}
      </div>

      {generation.modelCatalog.error ? (
        <div className="prompt-generation-panel__message prompt-generation-panel__message--error" role="alert">
          <span className="prompt-generation-panel__message-text">视频模型目录读取失败：{generation.modelCatalog.error.message}</span>
          <button className="prompt-generation-panel__message-action" type="button" onClick={generation.modelCatalog.retry}>重试目录</button>
        </div>
      ) : generation.selectedOption && !generation.selectedConfig ? (
        <div className="prompt-generation-panel__message prompt-generation-panel__message--error" role="alert">
          <span className="prompt-generation-panel__message-text">该模型缺少可执行的视频参数合同，请选择其他模型。</span>
        </div>
      ) : generation.sourceModelUnavailable ? (
        <div className="prompt-generation-panel__message prompt-generation-panel__message--warning" role="status">
          <span className="prompt-generation-panel__message-text">
            当前提示词使用的模型“{generation.sourceModelLabel || '未命名模型'}”不在可用目录中，请手动选择视频模型；系统不会自动降级。
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
                  ? `生成临时视频 · ${generation.generationCost.toLocaleString('zh-CN')} 积分`
                  : '生成临时视频'}
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

      {generation.preview ? (
        <div className="prompt-generation-panel__preview">
          <div className="prompt-generation-panel__preview-heading">
            <span className="prompt-generation-panel__preview-title">临时预览</span>
            <span className="prompt-generation-panel__preview-meta">已保存在生成历史</span>
          </div>
          <video
            className="prompt-generation-panel__preview-video"
            src={generation.preview.url}
            poster={generation.preview.thumbnailUrl || undefined}
            controls
            playsInline
            preload="metadata"
            aria-label={generation.preview.title}
          />
        </div>
      ) : null}

      <PromptGenerationHistory
        kind="video"
        authenticated={generation.authenticated}
        items={history.items}
        loading={history.loading}
        error={history.error}
        reload={history.reload}
        onRequestLogin={props.onRequestLogin}
        onPreview={(item) => generation.setPreview({ url: item.url, thumbnailUrl: item.thumbnailUrl, title: item.title })}
      />
    </section>
  )
}
