import React from 'react'
import {
  Badge,
  Button,
  Group,
  Image,
  Modal,
  Paper,
  ScrollArea,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core'
import { IconUpload } from '@tabler/icons-react'
import type { ProjectDto } from '../../api/server'

export type TemplateSaveMode = 'create' | 'update'
export type TemplateVisibility = 'public' | 'private'

type GroupTemplateModalProps = {
  opened: boolean
  loading: boolean
  coverUploading: boolean
  previewUrl: string | null
  coverUrl: string
  saveMode: TemplateSaveMode
  visibility: TemplateVisibility
  name: string
  description: string
  templateProjects: ProjectDto[]
  selectedTemplateProjectId: string
  onClose: () => void
  onSubmit: () => void
  onSaveModeChange: (value: TemplateSaveMode) => void
  onVisibilityChange: (value: TemplateVisibility) => void
  onNameChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onSelectedTemplateProjectIdChange: (value: string) => void
  onTriggerCoverUpload: () => void
}

const buildPlaceholderSvg = (): string => encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#3a3a45"/>
        <stop offset="100%" stop-color="#1a1a20"/>
      </linearGradient>
    </defs>
    <rect width="320" height="320" rx="28" fill="url(#g)"/>
    <rect x="18" y="18" width="284" height="284" rx="22" fill="none" stroke="#8c8c96" stroke-dasharray="9 7" stroke-width="4" />
    <text x="160" y="160" font-size="22" text-anchor="middle" fill="#f3f3f6" font-family="Arial, sans-serif">Template Cover</text>
  </svg>
`)

function TemplatePreview({ previewUrl }: { previewUrl: string | null }): JSX.Element {
  if (previewUrl) {
    return (
      <Image
        className="group-template-modal__preview-image"
        src={previewUrl}
        alt="模板预览"
        radius={24}
        h={190}
      />
    )
  }
  return (
    <Image
      className="group-template-modal__preview-image"
      src={`data:image/svg+xml;charset=UTF-8,${buildPlaceholderSvg()}`}
      alt="模板预览占位"
      radius={24}
      h={190}
    />
  )
}

export function GroupTemplateModal({
  opened,
  loading,
  coverUploading,
  previewUrl,
  coverUrl,
  saveMode,
  visibility,
  name,
  description,
  templateProjects,
  selectedTemplateProjectId,
  onClose,
  onSubmit,
  onSaveModeChange,
  onVisibilityChange,
  onNameChange,
  onDescriptionChange,
  onSelectedTemplateProjectIdChange,
  onTriggerCoverUpload,
}: GroupTemplateModalProps): JSX.Element {
  const resolvedPreviewUrl = coverUrl.trim() || previewUrl
  const [previewHovered, setPreviewHovered] = React.useState(false)

  return (
    <Modal
      className="group-template-modal"
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      centered
      radius={32}
      size={760}
      padding={0}
      overlayProps={{ blur: 14, opacity: 0.45 }}
      styles={{
        content: {
          background: 'linear-gradient(180deg, rgba(31,31,36,0.98) 0%, rgba(24,24,29,0.98) 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 42px 96px rgba(0,0,0,0.42)',
          color: '#f5f5f7',
          overflow: 'hidden',
        },
        header: { display: 'none' },
        body: { padding: 0 },
      }}
    >
      <div className="group-template-modal__shell">
        <Tabs
          className="group-template-modal__tabs"
          value={saveMode}
          onChange={(value) => {
            if (value === 'create' || value === 'update') onSaveModeChange(value)
          }}
          styles={{
            root: { padding: '22px 28px 28px' },
            list: { gap: 28, borderBottom: '1px solid rgba(255,255,255,0.16)', marginBottom: 24 },
            tab: {
              padding: '0 0 14px',
              color: 'rgba(255,255,255,0.66)',
              fontSize: 15,
              fontWeight: 700,
              borderBottom: '2px solid transparent',
            },
            tabLabel: { lineHeight: 1.2 },
          }}
        >
          <Tabs.List className="group-template-modal__tab-list">
            <Tabs.Tab className="group-template-modal__tab" value="create">创建新模板</Tabs.Tab>
            <Tabs.Tab className="group-template-modal__tab" value="update">更新历史模板</Tabs.Tab>
          </Tabs.List>

          <div className="group-template-modal__content">
            <div
              className="group-template-modal__grid"
              style={{
                display: 'grid',
                gap: 22,
                gridTemplateColumns: saveMode === 'update' ? '196px 160px minmax(0, 1fr)' : '160px minmax(0, 1fr)',
                alignItems: 'start',
              }}
            >
              {saveMode === 'update' && (
                <Paper
                  className="group-template-modal__history-panel"
                  radius={24}
                  p="sm"
                  style={{
                    background: 'rgba(255,255,255,0.035)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    minHeight: 360,
                  }}
                >
                  <Text className="group-template-modal__history-title" size="sm" fw={700} mb="sm" c="#f3f3f6">
                    历史模板
                  </Text>
                  <ScrollArea className="group-template-modal__history-scroll" h={332} scrollbarSize={6}>
                    <Stack className="group-template-modal__history-list" gap="xs">
                      {templateProjects.length === 0 ? (
                        <Text className="group-template-modal__history-empty" size="sm" c="dimmed">
                          当前没有可更新的模板项目
                        </Text>
                      ) : templateProjects.map((project) => {
                        const active = project.id === selectedTemplateProjectId
                        return (
                          <Paper
                            className="group-template-modal__history-card"
                            key={project.id}
                            radius={18}
                            p="sm"
                            onClick={() => onSelectedTemplateProjectIdChange(project.id)}
                            style={{
                              cursor: 'pointer',
                              background: active ? 'rgba(157, 209, 255, 0.14)' : 'rgba(255,255,255,0.04)',
                              border: active ? '1px solid rgba(157, 209, 255, 0.55)' : '1px solid rgba(255,255,255,0.06)',
                            }}
                          >
                            <Stack className="group-template-modal__history-card-stack" gap={4}>
                              <Text className="group-template-modal__history-card-title" size="sm" fw={700} c="#f5f5f7" lineClamp={1}>
                                {project.templateTitle || project.name}
                              </Text>
                              {project.templateDescription ? (
                                <Text className="group-template-modal__history-card-description" size="xs" c="rgba(255,255,255,0.62)" lineClamp={2}>
                                  {project.templateDescription}
                                </Text>
                              ) : null}
                              <Badge
                                className="group-template-modal__history-card-badge"
                                variant="light"
                                radius="md"
                                color={project.isPublic ? 'blue' : 'gray'}
                                style={{ width: 'fit-content' }}
                              >
                                {project.isPublic ? '公共' : '私有'}
                              </Badge>
                            </Stack>
                          </Paper>
                        )
                      })}
                    </Stack>
                  </ScrollArea>
                </Paper>
              )}

              <div className="group-template-modal__preview-column">
                <div
                  className="group-template-modal__preview-card"
                  style={{
                    position: 'relative',
                    borderRadius: 24,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    boxShadow: '0 18px 40px rgba(0,0,0,0.24)',
                  }}
                  onMouseEnter={() => setPreviewHovered(true)}
                  onMouseLeave={() => setPreviewHovered(false)}
                  onFocus={() => setPreviewHovered(true)}
                  onBlur={() => setPreviewHovered(false)}
                  onClick={onTriggerCoverUpload}
                >
                  <TemplatePreview previewUrl={resolvedPreviewUrl} />
                  <div
                    className="group-template-modal__preview-overlay"
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'flex-end',
                      justifyContent: 'center',
                      padding: 14,
                      background: 'linear-gradient(180deg, rgba(4,6,12,0.04) 0%, rgba(4,6,12,0.82) 100%)',
                      opacity: previewHovered ? 1 : 0,
                      transition: 'opacity 140ms ease',
                      pointerEvents: previewHovered ? 'auto' : 'none',
                    }}
                  >
                    <Button
                      className="group-template-modal__cover-upload"
                      radius="md"
                      variant="light"
                      leftSection={<IconUpload className="group-template-modal__cover-upload-icon" size={14} />}
                      loading={coverUploading}
                      onClick={(event) => {
                        event.stopPropagation()
                        onTriggerCoverUpload()
                      }}
                      styles={{
                        root: {
                          background: 'rgba(164, 214, 255, 0.18)',
                          color: '#f4fbff',
                          border: '1px solid rgba(164, 214, 255, 0.34)',
                          backdropFilter: 'blur(10px)',
                        },
                      }}
                    >
                      {resolvedPreviewUrl ? '更换封面' : '上传封面'}
                    </Button>
                  </div>
                </div>
              </div>

              <Stack className="group-template-modal__form" gap="lg">
                <Stack className="group-template-modal__field-group" gap={8}>
                  <Text className="group-template-modal__label" size="md" fw={700} c="#f5f5f7">名称</Text>
                  <TextInput
                    className="group-template-modal__name-input"
                    value={name}
                    onChange={(event) => onNameChange(event.currentTarget.value)}
                    placeholder="模板"
                    maxLength={200}
                    styles={{
                      input: {
                        height: 50,
                        borderRadius: 18,
                        background: 'rgba(89,89,98,0.65)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        color: '#ffffff',
                        fontSize: 16,
                        fontWeight: 600,
                      },
                    }}
                  />
                </Stack>

                <Stack className="group-template-modal__field-group" gap={8}>
                  <Group className="group-template-modal__label-row" justify="space-between" align="center">
                    <Text className="group-template-modal__label" size="md" fw={700} c="#f5f5f7">可见范围</Text>
                    <Badge className="group-template-modal__visibility-badge" radius="md" color="gray" variant="light">
                      {visibility === 'public' ? '公共模板' : '私有模板'}
                    </Badge>
                  </Group>
                  <SegmentedControl
                    className="group-template-modal__visibility-control"
                    fullWidth
                    radius="md"
                    value={visibility}
                    onChange={(value) => {
                      if (value === 'public' || value === 'private') onVisibilityChange(value)
                    }}
                    data={[
                      { label: '公共模板', value: 'public' },
                      { label: '私有模板', value: 'private' },
                    ]}
                    styles={{
                      root: {
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        padding: 4,
                      },
                      indicator: {
                        background: 'linear-gradient(180deg, #aad8ff 0%, #87b7ff 100%)',
                      },
                      label: {
                        color: '#f3f3f6',
                        fontWeight: 700,
                      },
                    }}
                  />
                </Stack>

                <Stack className="group-template-modal__field-group" gap={8}>
                  <Text className="group-template-modal__label" size="md" fw={700} c="#f5f5f7">备注</Text>
                  <Textarea
                    className="group-template-modal__description-input"
                    value={description}
                    onChange={(event) => onDescriptionChange(event.currentTarget.value)}
                    placeholder="请介绍您的模板，比如使用场景、操作步骤以及独特价值"
                    minRows={5}
                    maxRows={7}
                    maxLength={1000}
                    styles={{
                      input: {
                        borderRadius: 22,
                        background: 'rgba(38, 42, 52, 0.88)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        color: '#f5f5f7',
                        fontSize: 15,
                        lineHeight: 1.6,
                        paddingTop: 16,
                        paddingBottom: 16,
                      },
                    }}
                  />
                </Stack>
              </Stack>
            </div>
          </div>
        </Tabs>

        <Group className="group-template-modal__footer" justify="flex-end" p="0 28px 28px">
          <Button
            className="group-template-modal__submit"
            radius="md"
            size="md"
            px={28}
            loading={loading}
            onClick={onSubmit}
            styles={{
              root: {
                background: 'linear-gradient(180deg, #9fd3ff 0%, #8cb7ff 100%)',
                color: '#ffffff',
                fontWeight: 700,
                boxShadow: '0 16px 40px rgba(140, 183, 255, 0.35)',
              },
            }}
          >
            确认
          </Button>
        </Group>
      </div>
    </Modal>
  )
}
