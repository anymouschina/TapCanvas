import React from 'react'
import { ActionIcon, Alert, Button, Collapse, CopyButton, Group, Stack, Text, Textarea, Tooltip } from '@mantine/core'
import { IconCheck, IconChevronDown, IconChevronRight, IconCopy } from '@tabler/icons-react'
import type { ModelCatalogImportResultDto } from './deps'
import { toast } from './deps'
import { DOC_TO_MODEL_CATALOG_ACTIVATION_PROMPT_ZH } from './modelCatalog.constants'
import { readFileAsText } from './modelCatalog.utils'

export function ModelCatalogImportSection({
  importText,
  setImportText,
  importSubmitting,
  lastImportResult,
  onFillTemplate,
  onSubmitImport,
}: {
  importText: string
  setImportText: (next: string) => void
  importSubmitting: boolean
  lastImportResult: ModelCatalogImportResultDto | null
  onFillTemplate: () => void
  onSubmitImport: () => void
}): JSX.Element {
  const [opened, setOpened] = React.useState(false)

  const handleImportFile = React.useCallback(
    async (file: File | null) => {
      if (!file) return
      try {
        const text = await readFileAsText(file)
        setOpened(true)
        setImportText(text || '')
      } catch {
        toast('读取文件失败', 'error')
      }
    },
    [setImportText],
  )

  return (
    <Stack className="stats-model-catalog-import-shell" gap="xs">
      <Group className="stats-model-catalog-import-header" justify="space-between" align="center" wrap="nowrap" gap="xs">
        <div className="stats-model-catalog-import-header-text">
          <Text className="stats-model-catalog-import-header-title" size="sm" fw={700}>一键导入</Text>
          <Text className="stats-model-catalog-import-header-desc" size="xs" c="dimmed">
            默认折叠；需要时再展开粘贴 JSON 或载入文件，避免顶部长表单把列表挤出视野。
          </Text>
        </div>
        <Button
          className="stats-model-catalog-import-toggle"
          size="xs"
          variant="subtle"
          leftSection={opened ? <IconChevronDown className="stats-model-catalog-import-toggle-icon" size={14} /> : <IconChevronRight className="stats-model-catalog-import-toggle-icon" size={14} />}
          onClick={() => setOpened((current) => !current)}
        >
          {opened ? '收起' : '展开'}
        </Button>
      </Group>

      <Collapse className="stats-model-catalog-import-collapse" in={opened}>
        <Stack className="stats-model-catalog-import" gap="xs">
        <Group className="stats-model-catalog-import-actions" gap="xs" wrap="wrap" align="flex-end">
          <div className="stats-model-catalog-import-file">
            <Text className="stats-model-catalog-import-file-label" size="xs" c="dimmed">选择 JSON 文件</Text>
            <input
              className="stats-model-catalog-import-file-input"
              type="file"
              accept=".json,application/json"
              onChange={(e) => void handleImportFile(e.currentTarget.files?.[0] || null)}
            />
          </div>
          <Button className="stats-model-catalog-import-template" size="xs" variant="light" onClick={onFillTemplate}>
            填充模板
          </Button>
          <Button className="stats-model-catalog-import-submit" size="xs" leftSection={<IconCheck className="stats-model-catalog-import-submit-icon" size={14} />} onClick={onSubmitImport} loading={importSubmitting}>
            导入
          </Button>
        </Group>

        <Group className="stats-model-catalog-import-panels" gap="sm" align="flex-start" wrap="wrap">
          <div className="stats-model-catalog-import-prompt" style={{ flex: '1 1 380px', minWidth: 320 }}>
            <Group className="stats-model-catalog-import-prompt-header" justify="space-between" align="center" wrap="nowrap" gap="xs">
              <Text className="stats-model-catalog-import-prompt-title" size="xs" fw={700}>激活提示词（文档 -&gt; 可导入 JSON）</Text>
              <CopyButton value={DOC_TO_MODEL_CATALOG_ACTIVATION_PROMPT_ZH} timeout={1200}>
                {({ copied, copy }) => (
                  <Tooltip className="stats-model-catalog-import-prompt-copy-tooltip" label={copied ? '已复制' : '复制'} withArrow>
                    <ActionIcon className="stats-model-catalog-import-prompt-copy" variant="light" size="sm" onClick={copy} aria-label="copy-doc-to-model-catalog-prompt">
                      {copied ? <IconCheck className="stats-model-catalog-import-prompt-copy-icon" size={14} /> : <IconCopy className="stats-model-catalog-import-prompt-copy-icon" size={14} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
            <Text className="stats-model-catalog-import-prompt-desc" size="xs" c="dimmed">
              把接口文档粘贴给任意大模型 + 这段提示词，即可生成可导入 JSON（不包含任何密钥）。
            </Text>
            <Textarea
              className="stats-model-catalog-import-prompt-text"
              value={DOC_TO_MODEL_CATALOG_ACTIVATION_PROMPT_ZH}
              readOnly
              autosize
              minRows={12}
            />
          </div>
          <div className="stats-model-catalog-import-json" style={{ flex: '2 1 520px', minWidth: 320 }}>
            <Textarea
              className="stats-model-catalog-import-text"
              label="导入 JSON"
              value={importText}
              onChange={(e) => setImportText(e.currentTarget.value)}
              placeholder="粘贴导入 JSON（支持 vendors / models.pricing / mappings.requestProfile / apiKey）"
              minRows={12}
              autosize
            />
          </div>
        </Group>

        {lastImportResult && (
          <Alert className="stats-model-catalog-import-result" color={lastImportResult.errors?.length ? 'yellow' : 'green'} variant="light" title="最近一次导入结果">
            <Text className="stats-model-catalog-import-result-summary" size="sm">
              vendors={lastImportResult.imported.vendors} models={lastImportResult.imported.models} mappings={lastImportResult.imported.mappings}
            </Text>
            {lastImportResult.errors?.length ? (
              <pre className="stats-model-catalog-import-result-errors" style={{ margin: 0, marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(0,0,0,0.14)', overflowX: 'auto' }}>
                <code className="stats-model-catalog-import-result-errors-code">
                  {lastImportResult.errors.join('\n')}
                </code>
              </pre>
            ) : (
              <Text className="stats-model-catalog-import-result-ok" size="xs" c="dimmed" mt={6}>
                无错误
              </Text>
            )}
          </Alert>
        )}
        </Stack>
      </Collapse>
    </Stack>
  )
}
